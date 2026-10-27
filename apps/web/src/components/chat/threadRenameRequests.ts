import type { ScopedThreadRef } from "@t3tools/contracts";

const THREAD_RENAME_REQUEST_EVENT = "t3:thread-rename-request";

/** Asks the chat header showing `target` to start its inline title rename. */
export function requestThreadRename(target: ScopedThreadRef): void {
  window.dispatchEvent(new CustomEvent(THREAD_RENAME_REQUEST_EVENT, { detail: target }));
}

export function subscribeThreadRename(
  threadRef: ScopedThreadRef,
  listener: () => void,
): () => void {
  const handler = (event: Event) => {
    const target = (event as CustomEvent<ScopedThreadRef>).detail;
    if (target.environmentId === threadRef.environmentId && target.threadId === threadRef.threadId)
      listener();
  };
  window.addEventListener(THREAD_RENAME_REQUEST_EVENT, handler);
  return () => window.removeEventListener(THREAD_RENAME_REQUEST_EVENT, handler);
}
