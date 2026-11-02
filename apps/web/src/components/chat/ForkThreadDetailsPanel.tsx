// Fork: the thread details card lists the thread's linked PRs instead of upstream's workspace,
// git, scripts, and automations sections. This lives in its own file so upstream can keep
// changing ThreadDetailsPanel.tsx without merge conflicts; ChatView imports this one instead.
import type { ComponentProps } from "react";
import type { ThreadDetailsPanel as UpstreamThreadDetailsPanel } from "./ThreadDetailsPanel";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsPullRequestList } from "./ThreadDetailsPullRequestList";

export function ThreadDetailsPanel(props: ComponentProps<typeof UpstreamThreadDetailsPanel>) {
  const threadRef = { environmentId: props.environmentId, threadId: props.threadId };
  return (
    <ThreadDetailsCard
      threadRef={threadRef}
      anchor={props.anchor}
      handle={props.handle}
      contentKey="pull-requests"
    >
      {() => <ThreadDetailsPullRequestList threadRef={threadRef} canLink={!props.draftId} />}
    </ThreadDetailsCard>
  );
}
