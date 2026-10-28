import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/client-runtime/thread-pull-requests";
import { EyeIcon, PlusIcon } from "lucide-react";

import { RelativeTime } from "~/components/RelativeTime";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { useServerConfigs, useThreadShell } from "~/state/entities";

import { openLinkPullRequestDialog } from "../pullRequest/LinkPullRequestDialog";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { PULL_REQUEST_ROW_CLASS, PullRequestRowGlyph } from "../pullRequest/PullRequestListRow";
import { pullRequestChecksStatePresentation } from "../pullRequest/pullRequestPresentation";
import { Button } from "../ui/button";

export function ThreadDetailsPullRequestList({
  threadRef,
  canLink,
}: {
  threadRef: ScopedThreadRef;
  canLink: boolean;
}) {
  const supported =
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities.threadPullRequests ===
    true;
  const thread = useThreadShell(threadRef);
  const openPrLink = useOpenPrLink(threadRef);
  const links = visibleThreadPullRequests(thread?.pullRequests ?? []).toSorted((left, right) =>
    right.linkedAt.localeCompare(left.linkedAt),
  );

  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
        <PullRequestGlyph.link aria-hidden className="size-5 text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground">No linked pull requests</p>
        {supported && canLink ? (
          <Button size="xs" variant="outline" onClick={() => openLinkPullRequestDialog(threadRef)}>
            <PlusIcon className="size-3.5" />
            Link pull request
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div data-thread-details-pr-list className="flex flex-col p-1.5">
      {links.map((link) => {
        const snapshot = link.snapshot;
        const open = snapshot === null || snapshot.state === "open";
        const checks =
          open && snapshot?.checksState
            ? pullRequestChecksStatePresentation(snapshot.checksState)
            : null;
        return (
          <a
            key={threadPullRequestKeyOf(link)}
            href={link.url}
            title={`${link.url}\nLinked ${new Date(link.linkedAt).toLocaleString()}`}
            onClick={(event) => openPrLink(event, link.url, threadRef)}
            onAuxClick={(event) => openPrLink(event, link.url, threadRef)}
            className={`${PULL_REQUEST_ROW_CLASS} items-start px-1.5 hover:bg-accent/60`}
          >
            {snapshot === null ? (
              <PullRequestGlyph.pullRequest
                aria-label="Waiting for host state"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
            ) : (
              <PullRequestRowGlyph
                state={snapshot.state}
                isDraft={snapshot.isDraft}
                mergeability={snapshot.mergeability}
                baseBranch={snapshot.baseBranch}
                className="mt-0.5"
              />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 text-sm leading-4.5">
                {snapshot?.title ?? link.repository}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                <span className="shrink-0 font-mono tabular-nums">#{link.number}</span>
                <span className="min-w-0 truncate font-mono">
                  {link.repository.split("/").at(-1)}
                </span>
                {open && link.watch !== undefined ? (
                  <EyeIcon role="img" aria-label="Watching" className="size-3 shrink-0" />
                ) : null}
                {checks ? (
                  <checks.Icon
                    role="img"
                    aria-label={checks.label}
                    className={`size-3 shrink-0 ${checks.toneClassName}`}
                  />
                ) : null}
                <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">
                  <RelativeTime timestamp={link.linkedAt} />
                </span>
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
