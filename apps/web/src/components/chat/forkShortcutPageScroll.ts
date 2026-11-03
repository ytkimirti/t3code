import type { PageScrollKey } from "./pageScrollController";

interface PageScrollControls {
  readonly keyDown: (key: PageScrollKey) => void;
  readonly release: () => void;
}

let active: {
  readonly controls: PageScrollControls;
  readonly release: () => void;
  code: string;
} | null = null;

// macOS can omit a letter's keyup while Command is held, so any modifier keyup ends a hold.
const MODIFIER_KEYS = new Set(["Control", "Shift", "Meta", "Alt"]);

/**
 * Fork: a keybinding (chat.scrollUp, chat.scrollDown) drives the timeline's PageUp and
 * PageDown scroll, holding while the chord is held. The chord's keyup carries a letter, not
 * PageUp, so the held key's or a modifier's keyup, or window blur, ends the hold. A hold
 * that moves to another chat (remounted while held) releases the old one first.
 */
export function pageScrollFromShortcut(
  event: KeyboardEvent,
  key: PageScrollKey,
  controls: PageScrollControls,
): boolean {
  if (event.isComposing) return false;
  // Callers pass a fresh object per key; a chat's stable release callback identifies it.
  if (active !== null && active.controls.release !== controls.release) active.release();
  controls.keyDown(key);
  if (active !== null) {
    active.code = event.code;
    return true;
  }
  const onKeyUp = (keyup: KeyboardEvent) => {
    if (keyup.code === active?.code || MODIFIER_KEYS.has(keyup.key)) release();
  };
  const release = () => {
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", release);
    if (active?.release === release) active = null;
    controls.release();
  };
  active = { controls, release, code: event.code };
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", release);
  return true;
}
