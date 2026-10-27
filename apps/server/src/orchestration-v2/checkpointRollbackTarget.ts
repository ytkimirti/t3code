/**
 * A chat-only rewind (`restoreFiles: false`) never reads the checkpoint's files, so a missing
 * checkpoint, such as one in a workspace that is not a git repository, still works as its target.
 */
export const isUsableRollbackTarget = (
  checkpoint: { readonly status: string },
  restoreFiles: boolean | undefined,
): boolean =>
  checkpoint.status === "ready" || (checkpoint.status === "missing" && restoreFiles === false);
