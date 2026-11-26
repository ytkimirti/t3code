import {
  type EnvironmentThreadShell,
  resolveThreadProviderStack,
} from "@t3tools/client-runtime/state/models";

type ThreadContext = Pick<
  EnvironmentThreadShell,
  "environmentId" | "providerInstanceHistory" | "modelSelection" | "runtime"
>;

function mostCommon(values: Iterable<string>): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The machine most threads run on; rows only label threads on another one. */
export function resolveUsualEnvironmentId(threads: ReadonlyArray<ThreadContext>): string | null {
  return mostCommon(threads.map((thread) => thread.environmentId));
}

/** The agent most threads use; rows only show the agent when it differs. */
export function resolveUsualProviderInstanceId(
  threads: ReadonlyArray<ThreadContext>,
): string | null {
  return mostCommon(threads.map((thread) => resolveThreadProviderStack(thread).at(-1)!));
}

// A handed-off thread keeps its provider stack, since the handoff is the unusual part.
export function isUsualProvider(thread: ThreadContext, usualProviderInstanceId: string | null) {
  const stack = resolveThreadProviderStack(thread);
  return stack.length === 1 && stack[0] === usualProviderInstanceId;
}
