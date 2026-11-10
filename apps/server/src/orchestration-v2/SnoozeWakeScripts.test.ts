import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import {
  SnoozeWakeScripts,
  layer as snoozeWakeScriptsLayer,
  MAX_FAILURES,
  type WakeScriptEntry,
  decideAfterRun,
  entryIsLive,
} from "./SnoozeWakeScripts.ts";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const WAKE = Date.parse("2026-11-17T09:00:00.000Z");

const entry = (overrides: Partial<WakeScriptEntry> = {}): WakeScriptEntry => ({
  id: "arm-1",
  threadId: "thread-1",
  snoozedUntilMs: WAKE,
  snoozedAtMs: NOW,
  script: "exit 1",
  everyMs: 300_000,
  message: null,
  nextCheckAtMs: NOW,
  failures: 0,
  ...overrides,
});

const shell = (
  snoozedUntilMs: number | null,
  overrides: { archived?: boolean; snoozedAtMs?: number } = {},
) => ({
  snoozedUntil: snoozedUntilMs === null ? null : DateTime.makeUnsafe(snoozedUntilMs),
  snoozedAt: snoozedUntilMs === null ? null : DateTime.makeUnsafe(overrides.snoozedAtMs ?? NOW),
  archivedAt: overrides.archived === true ? DateTime.makeUnsafe(NOW) : null,
  deletedAt: null,
});

describe("entryIsLive", () => {
  it("follows only the snooze it was armed for", () => {
    expect(entryIsLive(entry(), shell(WAKE), NOW)).toBe(true);
    expect(entryIsLive(entry(), shell(null), NOW)).toBe(false);
    expect(entryIsLive(entry(), shell(WAKE + 60_000), NOW)).toBe(false);
    // Snoozed again to the same time, from the UI or another arm.
    expect(entryIsLive(entry(), shell(WAKE, { snoozedAtMs: NOW + 1 }), NOW)).toBe(false);
    expect(entryIsLive(entry(), shell(WAKE, { archived: true }), NOW)).toBe(false);
    expect(entryIsLive(entry(), null, NOW)).toBe(false);
  });

  it("stops once the snooze time itself has passed", () => {
    expect(entryIsLive(entry(), shell(WAKE), WAKE)).toBe(false);
  });
});

describe("decideAfterRun", () => {
  const exited = (code: number, stdout = "", stderr = "") =>
    ({ type: "exited", code, stdout, stderr }) as const;

  it("exit 0 wakes, with the message and stdout only when a message was given", () => {
    expect(decideAfterRun(entry(), exited(0, "new reply"), NOW)).toEqual({
      type: "wake",
      text: null,
    });
    expect(decideAfterRun(entry({ message: "Read it." }), exited(0, " new reply \n"), NOW)).toEqual(
      { type: "wake", text: "Read it.\n\nWake script output:\nnew reply" },
    );
    expect(decideAfterRun(entry({ message: "Read it." }), exited(0), NOW)).toEqual({
      type: "wake",
      text: "Read it.",
    });
  });

  it("exit 1 sleeps until the next check and clears earlier failures", () => {
    expect(decideAfterRun(entry({ failures: 2 }), exited(1), NOW)).toEqual({
      type: "sleep",
      entry: entry({ failures: 0, nextCheckAtMs: NOW + 300_000 }),
    });
  });

  it("wakes with the error after repeated failures", () => {
    let current = entry();
    for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
      const decision = decideAfterRun(current, exited(127, "", "gh: not found"), NOW);
      expect(decision.type).toBe("sleep");
      if (decision.type === "sleep") current = decision.entry;
    }
    const last = decideAfterRun(current, { type: "error", detail: "timed out" }, NOW);
    expect(last.type).toBe("wake");
    expect(last.type === "wake" ? last.text : null).toContain(
      "failed 3 times in a row (timed out)",
    );
  });
});

it.effect("an armed script survives a restart and wakes the thread once it exits 0", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-wake-scripts-" });
    const worktree = path.join(baseDir, "worktree");
    yield* fs.makeDirectory(worktree);
    const commands = yield* Queue.unbounded<string>();
    const messages = yield* Queue.unbounded<string>();
    const threadId = ThreadId.make("thread-1");
    const layer = snoozeWakeScriptsLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: () =>
              Effect.succeed({
                ...shell(WAKE),
                projectId: ProjectId.make("project-1"),
                worktreePath: worktree,
              } as never),
            dispatch: (command) =>
              Queue.offer(commands, command.type).pipe(Effect.as({ sequence: 1 } as never)),
            sendToThread: (input) => Queue.offer(messages, input.text).pipe(Effect.as({} as never)),
          }),
          Layer.mock(ProjectService.ProjectService)({}),
          ProcessRunner.layer,
          ServerConfig.layerTest(process.cwd(), baseDir),
        ),
      ),
      Layer.fresh,
    );

    const before = yield* Scope.make();
    const first = Context.get(yield* Layer.buildWithScope(layer, before), SnoozeWakeScripts);
    assert.deepEqual(yield* first.probe(threadId, "test -f reply"), {
      type: "exited",
      code: 1,
      stdout: "",
      stderr: "",
    });
    yield* first.arm({
      id: "arm-1",
      threadId,
      snoozedUntilMs: WAKE,
      script: "test -f reply && cat reply",
      everyMs: 60_000,
      message: "Read the reply.",
    });
    yield* Scope.close(before, Exit.void);

    yield* fs.writeFileString(path.join(worktree, "reply"), "lgtm from Ada\n");
    yield* Layer.build(layer);
    yield* TestClock.adjust("75 seconds");
    assert.equal(yield* Queue.take(commands), "thread.unsnooze");
    assert.equal(
      yield* Queue.take(messages),
      "Read the reply.\n\nWake script output:\nlgtm from Ada",
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
