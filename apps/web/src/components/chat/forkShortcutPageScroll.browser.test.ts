import { describe, expect, it } from "vite-plus/test";

import { pageScrollFromShortcut } from "./forkShortcutPageScroll";
import type { PageScrollKey } from "./pageScrollController";

function controls() {
  const log: string[] = [];
  return {
    log,
    keyDown: (key: PageScrollKey) => log.push(key),
    release: () => log.push("release"),
  };
}

const keydown = (code: string, repeat = false) =>
  new KeyboardEvent("keydown", { code, ctrlKey: true, shiftKey: true, repeat });
const keyup = (code: string, key = code.slice(3).toLowerCase()) =>
  window.dispatchEvent(new KeyboardEvent("keyup", { code, key }));

describe("pageScrollFromShortcut", () => {
  it("holds across repeats and releases on the held letter's keyup", () => {
    const chat = controls();
    const fresh = () => ({ keyDown: chat.keyDown, release: chat.release });
    expect(pageScrollFromShortcut(keydown("KeyO"), "PageUp", fresh())).toBe(true);
    pageScrollFromShortcut(keydown("KeyO", true), "PageUp", fresh());
    keyup("KeyO");
    keyup("KeyO");
    expect(chat.log).toEqual(["PageUp", "PageUp", "release"]);
  });

  it("keeps a switched direction held when the first letter is released", () => {
    const chat = controls();
    pageScrollFromShortcut(keydown("KeyO"), "PageUp", chat);
    pageScrollFromShortcut(keydown("KeyI"), "PageDown", chat);
    keyup("KeyO");
    expect(chat.log).toEqual(["PageUp", "PageDown"]);
    keyup("ShiftLeft", "Shift");
    expect(chat.log).toEqual(["PageUp", "PageDown", "release"]);
  });

  it("releases the previous chat when a remounted one takes the hold", () => {
    const before = controls();
    const after = controls();
    pageScrollFromShortcut(keydown("KeyI"), "PageDown", before);
    pageScrollFromShortcut(keydown("KeyI", true), "PageDown", after);
    keyup("KeyI");
    expect(before.log).toEqual(["PageDown", "release"]);
    expect(after.log).toEqual(["PageDown", "release"]);
  });

  it("ignores IME composition", () => {
    const chat = controls();
    const composing = new KeyboardEvent("keydown", { code: "KeyO", isComposing: true });
    expect(pageScrollFromShortcut(composing, "PageUp", chat)).toBe(false);
    expect(chat.log).toEqual([]);
  });
});
