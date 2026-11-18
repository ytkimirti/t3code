// Fork: the thread details card is removed. This lives in its own file so upstream can keep
// changing ThreadDetailsPanel.tsx without merge conflicts; ChatView imports this one instead.
import type { ComponentProps } from "react";
import type { ThreadDetailsPanel as UpstreamThreadDetailsPanel } from "./ThreadDetailsPanel";

export function ThreadDetailsPanel(
  _props: ComponentProps<typeof UpstreamThreadDetailsPanel> & { readonly available: boolean },
) {
  return null;
}
