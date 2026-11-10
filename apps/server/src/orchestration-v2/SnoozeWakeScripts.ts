import {
  CommandId,
  MessageId,
  type OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

// Fork-only: a snooze can carry a shell script that wakes the thread early.
// Exit 0 wakes it, exit 1 keeps it asleep, anything else is a failure.

export const MAX_FAILURES = 3;
const SWEEP_EVERY = "15 seconds";
const SCRIPT_TIMEOUT = "2 minutes";
const MAX_OUTPUT_CHARS = 4000;

const WakeScriptEntry = Schema.Struct({
  threadId: Schema.String,
  snoozedUntilMs: Schema.Number,
  script: Schema.String,
  everyMs: Schema.Number,
  message: Schema.NullOr(Schema.String),
  nextCheckAtMs: Schema.Number,
  failures: Schema.Number,
});
export type WakeScriptEntry = typeof WakeScriptEntry.Type;

const WakeScriptFile = Schema.fromJsonString(Schema.Array(WakeScriptEntry));
const decodeFile = Schema.decodeUnknownEffect(WakeScriptFile);
const encodeFile = Schema.encodeEffect(WakeScriptFile);

type ShellSnooze = Pick<OrchestrationV2ThreadShell, "snoozedUntil" | "archivedAt" | "deletedAt">;

/** Whether the entry still belongs to the thread's current snooze. */
export function entryIsLive(
  entry: WakeScriptEntry,
  shell: ShellSnooze | null,
  nowMs: number,
): boolean {
  if (shell === null || shell.deletedAt !== null || shell.archivedAt !== null) return false;
  if (shell.snoozedUntil == null) return false;
  const snoozedUntilMs = DateTime.toEpochMillis(shell.snoozedUntil);
  return snoozedUntilMs === entry.snoozedUntilMs && snoozedUntilMs > nowMs;
}

export type ScriptOutcome =
  | {
      readonly type: "exited";
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly type: "error"; readonly detail: string };

export type WakeDecision =
  | { readonly type: "sleep"; readonly entry: WakeScriptEntry }
  | { readonly type: "wake"; readonly text: string | null };

const clip = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length <= MAX_OUTPUT_CHARS ? trimmed : `${trimmed.slice(0, MAX_OUTPUT_CHARS)}…`;
};

export function decideAfterRun(
  entry: WakeScriptEntry,
  outcome: ScriptOutcome,
  nowMs: number,
): WakeDecision {
  if (outcome.type === "exited" && outcome.code === 0) {
    if (entry.message === null) return { type: "wake", text: null };
    const output = clip(outcome.stdout);
    return {
      type: "wake",
      text:
        output.length === 0 ? entry.message : `${entry.message}\n\nWake script output:\n${output}`,
    };
  }
  const nextCheckAtMs = nowMs + entry.everyMs;
  if (outcome.type === "exited" && outcome.code === 1) {
    return { type: "sleep", entry: { ...entry, failures: 0, nextCheckAtMs } };
  }
  const failures = entry.failures + 1;
  if (failures < MAX_FAILURES)
    return { type: "sleep", entry: { ...entry, failures, nextCheckAtMs } };
  const detail =
    outcome.type === "error"
      ? outcome.detail
      : `exit ${outcome.code}${outcome.stderr.trim() ? `: ${clip(outcome.stderr)}` : ""}`;
  return {
    type: "wake",
    text: `The wake script for this snooze failed ${MAX_FAILURES} times in a row (${detail}), so the thread woke early.${
      entry.message === null ? "" : `\n\nIts wake message was:\n${entry.message}`
    }`,
  };
}

export interface ArmInput {
  readonly threadId: ThreadId;
  readonly snoozedUntil: string;
  readonly script: string;
  readonly everyMs: number;
  readonly message: string | null;
}

export class SnoozeWakeScripts extends Context.Service<
  SnoozeWakeScripts,
  {
    /** Runs the script once, in the thread's folder, as a check would. */
    readonly probe: (threadId: ThreadId, script: string) => Effect.Effect<ScriptOutcome>;
    readonly arm: (input: ArmInput) => Effect.Effect<void>;
    readonly disarm: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/SnoozeWakeScripts") {}

export const layer = Layer.effect(
  SnoozeWakeScripts,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const runner = yield* ProcessRunner.ProcessRunner;
    const filePath = path.join(stateDir, "snooze-wake-scripts.json");
    const lock = yield* Semaphore.make(1);

    const initial = yield* fs.readFileString(filePath).pipe(
      Effect.flatMap(decodeFile),
      Effect.orElseSucceed((): ReadonlyArray<WakeScriptEntry> => []),
    );
    const entries = yield* Ref.make<ReadonlyArray<WakeScriptEntry>>(initial);
    const running = new Set<string>();

    const persist = Effect.gen(function* () {
      const contents = yield* encodeFile(yield* Ref.get(entries));
      const temp = `${filePath}.tmp`;
      yield* fs.makeDirectory(stateDir, { recursive: true });
      yield* fs.writeFileString(temp, contents);
      yield* fs.rename(temp, filePath);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("snooze-wake-scripts.persist-failed", { cause }),
      ),
    );

    const update = (f: (all: ReadonlyArray<WakeScriptEntry>) => ReadonlyArray<WakeScriptEntry>) =>
      lock.withPermits(1)(Ref.update(entries, f).pipe(Effect.andThen(persist)));

    const drop = (threadId: string) => update((all) => all.filter((e) => e.threadId !== threadId));

    const cwdFor = Effect.fn("SnoozeWakeScripts.cwdFor")(function* (
      shell: OrchestrationV2ThreadShell,
    ) {
      if (shell.worktreePath !== null) return shell.worktreePath;
      const project = yield* projects
        .getById(shell.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      return Option.isSome(project) ? project.value.workspaceRoot : undefined;
    });

    const runScript = (script: string, cwd: string | undefined) =>
      runner
        .run({
          command: "bash",
          args: ["-lc", script],
          cwd,
          timeout: SCRIPT_TIMEOUT,
          maxOutputBytes: 64 * 1024,
          outputMode: "truncate",
          timeoutBehavior: "timedOutResult",
        })
        .pipe(
          Effect.map((result): ScriptOutcome =>
            result.timedOut
              ? { type: "error", detail: `timed out after ${SCRIPT_TIMEOUT}` }
              : {
                  type: "exited",
                  code: result.code === null ? -1 : Number(result.code),
                  stdout: result.stdout,
                  stderr: result.stderr,
                },
          ),
          Effect.catchCause((cause) =>
            Effect.succeed<ScriptOutcome>({ type: "error", detail: String(cause).slice(0, 500) }),
          ),
        );

    const wake = Effect.fn("SnoozeWakeScripts.wake")(function* (
      shell: OrchestrationV2ThreadShell,
      entry: WakeScriptEntry,
      text: string | null,
    ) {
      const threadId = ThreadId.make(entry.threadId);
      const key = `wake-script:${entry.threadId}:${entry.snoozedUntilMs}`;
      yield* threads.dispatch({
        type: "thread.unsnooze",
        commandId: CommandId.make(key),
        threadId,
        reason: "user",
      });
      if (text === null) return;
      yield* threads.sendToThread({
        projectId: shell.projectId,
        commandId: CommandId.make(`${key}:message`),
        threadId,
        messageId: MessageId.make(`${key}:message`),
        text,
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "server",
      });
    });

    const check = Effect.fn("SnoozeWakeScripts.check")(function* (entry: WakeScriptEntry) {
      const shell = yield* threads
        .getThreadShell(ThreadId.make(entry.threadId))
        .pipe(Effect.orElseSucceed(() => null));
      if (shell === null || !entryIsLive(entry, shell, yield* Clock.currentTimeMillis)) {
        return yield* drop(entry.threadId);
      }
      const outcome = yield* runScript(entry.script, yield* cwdFor(shell));
      const decision = decideAfterRun(entry, outcome, yield* Clock.currentTimeMillis);
      // The snooze may have changed while the script ran; act only on the one it was armed for.
      const current = (yield* Ref.get(entries)).find((e) => e.threadId === entry.threadId);
      if (current?.snoozedUntilMs !== entry.snoozedUntilMs) return;
      if (decision.type === "sleep") {
        return yield* update((all) =>
          all.map((e) => (e.threadId === entry.threadId ? decision.entry : e)),
        );
      }
      yield* drop(entry.threadId);
      yield* wake(shell, entry, decision.text);
    });

    const sweep = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const due = (yield* Ref.get(entries)).filter(
        (e) => e.nextCheckAtMs <= nowMs && !running.has(e.threadId),
      );
      for (const entry of due) {
        running.add(entry.threadId);
        yield* forkParked(
          check(entry).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("snooze-wake-scripts.check-failed", {
                threadId: entry.threadId,
                cause,
              }),
            ),
            Effect.ensuring(Effect.sync(() => running.delete(entry.threadId))),
          ),
        );
      }
    });

    yield* forkParked(Effect.sleep(SWEEP_EVERY).pipe(Effect.andThen(sweep), Effect.forever));

    const probe = Effect.fn("SnoozeWakeScripts.probe")(function* (
      threadId: ThreadId,
      script: string,
    ) {
      const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
      return yield* runScript(script, shell === null ? undefined : yield* cwdFor(shell));
    });

    const arm = Effect.fn("SnoozeWakeScripts.arm")(function* (input: ArmInput) {
      const nowMs = yield* Clock.currentTimeMillis;
      yield* update((all) => [
        ...all.filter((e) => e.threadId !== input.threadId),
        {
          threadId: input.threadId,
          snoozedUntilMs: Date.parse(input.snoozedUntil),
          script: input.script,
          everyMs: input.everyMs,
          message: input.message,
          nextCheckAtMs: nowMs + input.everyMs,
          failures: 0,
        },
      ]);
    });

    return SnoozeWakeScripts.of({ probe, arm, disarm: drop });
  }),
);
