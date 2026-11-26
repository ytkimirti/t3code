// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- Runs synchronously before protocol registration, outside any Effect fiber.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";

// Fork: web-only patches ship without an app update. scripts/fork-ui-overlay.sh uploads an
// apps/web build and points the <baseDir>/fork-ui/current symlink at it; while its overlay.json
// names this exact app version, the app serves that build and reloads its windows on each swap.
// The resolved build stays in use until the reload, so open windows never mix two builds.
let activeDirectory: string | null = null;
let activeManifest: string | null = null;

function readOverlay(link: string, appVersion: string) {
  try {
    const directory = NodeFS.realpathSync(link);
    const manifest = NodeFS.readFileSync(NodePath.join(directory, "overlay.json"), "utf8");
    if ((JSON.parse(manifest) as { appVersion?: unknown }).appVersion !== appVersion) return null;
    if (!NodeFS.statSync(NodePath.join(directory, "index.html")).isFile()) return null;
    return { directory, manifest };
  } catch {
    return null;
  }
}

export function forkClientAssetDirectory(bundledDirectory: string): string {
  return activeDirectory ?? bundledDirectory;
}

export function forkStartUiOverlay(input: {
  readonly baseDir: string;
  readonly appVersion: string;
  readonly desktopOrigin: string;
}): void {
  const root = NodePath.join(input.baseDir, "fork-ui");
  const current = NodePath.join(root, "current");
  const refresh = () => {
    const overlay = readOverlay(current, input.appVersion);
    const manifest = overlay?.manifest ?? null;
    if (manifest === activeManifest) return false;
    activeDirectory = overlay?.directory ?? null;
    activeManifest = manifest;
    return true;
  };
  refresh();
  try {
    NodeFS.mkdirSync(root, { recursive: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The script renames whole directories in and out of root, so a shallow watch sees each swap.
    NodeFS.watch(root, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!refresh()) return;
        for (const window of Electron.BrowserWindow.getAllWindows()) {
          const contents = window.webContents;
          if (!contents.isDestroyed() && contents.getURL().startsWith(input.desktopOrigin)) {
            contents.reload();
          }
        }
      }, 300);
    }).on("error", () => undefined);
  } catch {
    // Without a watcher, swaps apply on the next launch.
  }
}
