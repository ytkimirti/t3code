#!/usr/bin/env bash
# Fork: ship apps/web changes to the Mac app without an app update.
# Builds this checkout's web app for the installed app version, uploads it to
# ~/.t3/fork-ui/builds on the Mac and points ~/.t3/fork-ui/current at it; the app serves
# it and reloads (apps/desktop/src/window/forkUiOverlay.ts). The next app update drops it.
#
#   scripts/fork-ui-overlay.sh           build and push (refuses changes outside apps/web)
#   scripts/fork-ui-overlay.sh --force   push the web part even when other code changed
#   scripts/fork-ui-overlay.sh --clear   go back to the app's bundled UI
set -euo pipefail

host=${T3_OVERLAY_HOST:-mac}
app='/Applications/T3 Code (Beta).app'
cd "$(git rev-parse --show-toplevel)"

case "${1:-}" in
  "" | --force) ;;
  --clear)
    ssh "$host" 'cd ~/.t3/fork-ui 2>/dev/null || exit 0; rm -f current'
    echo "Overlay removed; the Mac app is back on its bundled UI."
    exit 0
    ;;
  *) sed -n '2,9s/^# \{0,1\}//p' "$0" >&2; exit 2 ;;
esac

version=$(ssh "$host" "plutil -extract CFBundleShortVersionString raw '$app/Contents/Info.plist'")
commit=$(gh release view "v$version" -R ytkimirti/t3code --json body -q .body | sed -n 's/^Commit: //p')
[ -n "$commit" ] || { echo "Release v$version has no Commit: line." >&2; exit 1; }
git cat-file -e "$commit^{commit}" 2>/dev/null || git fetch -q origin "$commit"
if ! git cat-file -e "$commit:apps/desktop/src/window/forkUiOverlay.ts" 2>/dev/null; then
  echo "The Mac app ($version) predates overlay support; update the app once." >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$commit" HEAD; then
  echo "This checkout lacks ${commit:0:9}, which the Mac app $version was built from; merge origin/yusuf first." >&2
  exit 1
fi

# Docs, tests, and this script cannot change what the web build or the app run.
outside=$({ git diff --name-only "$commit"; git ls-files --others --exclude-standard -- . ':!.claude'; } | sort -u |
  grep -v -E '^apps/web/|^docs/|\.md$|\.test\.tsx?$|^scripts/fork-ui-overlay\.sh$' || true)
if [ -n "$outside" ] && [ "${1:-}" != --force ]; then
  echo "Changes since the Mac app's build ($version) reach beyond apps/web and need an app update:" >&2
  echo "$outside" | sed 's/^/  /' >&2
  echo "Rerun with --force to ship the web build anyway (shared packages go in with it; the app itself stays old)." >&2
  exit 1
fi

# Public config of the nightly bundle job in fork-build.yml; sourcemaps are stripped from the app anyway.
export T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudDMuY29kZXMk T3CODE_CLERK_JWT_TEMPLATE=t3-relay \
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=hzxSgY2cH10sDU2r T3CODE_RELAY_URL=https://relay.t3.codes \
  T3CODE_TELEMETRY_CHANNEL=dev T3CODE_WEB_SOURCEMAP=false APP_VERSION=$version \
  T3CODE_DESKTOP_UPDATE_REPOSITORY=ytkimirti/t3code
export PATH=$HOME/.local/share/vite-plus/bin:$PATH
nice vp install --frozen-lockfile --prefer-offline > /dev/null
(cd apps/web && nice vp build)

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -a apps/web/dist/. "$stage/"
node scripts/apply-web-brand-assets.ts production "$stage"
head=$(git rev-parse HEAD)
dirty=$([ -n "$(git status --porcelain -- . ':!.claude')" ] && echo true || echo false)
printf '{"appVersion":"%s","commit":"%s","dirty":%s,"builtAt":"%s"}\n' \
  "$version" "$head" "$dirty" "$(date -u +%FT%TZ)" > "$stage/overlay.json"

# Builds sort by name; the app may still serve the previous one until it reloads, so keep two.
build=$(date -u +%Y%m%dT%H%M%SZ)-${head:0:9}
previous=$(ssh "$host" 'mkdir -p ~/.t3/fork-ui/builds && cd ~/.t3/fork-ui/builds && ls | sort | tail -1')
rsync -a --checksum ${previous:+--link-dest="../$previous"} "$stage/" "$host:.t3/fork-ui/builds/$build/"
ssh "$host" "cd ~/.t3/fork-ui && ln -sfn 'builds/$build' current.tmp && mv -fh current.tmp current &&
  cd builds && ls | sort -r | tail -n +3 | while read -r old; do rm -rf \"\$old\"; done"
echo "Pushed ${head:0:9}$([ "$dirty" = true ] && echo ' + local edits') to the Mac app $version; its windows reload now."
