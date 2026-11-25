import * as Schema from "effect/Schema";

import "./forkVibrancy.css";
import { readLocalStorageValue, subscribeLocalStorageKey } from "./hooks/useLocalStorage";

export const FORK_WINDOW_TINT_STORAGE_KEY = "t3code:fork-window-tint:v1";
export const FORK_WINDOW_TINT_DEFAULT = 55;
export const ForkWindowTint = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));

// Fork: only the macOS desktop window has the native blur behind the page.
export const forkVibrancyEnabled = window.desktopBridge?.getClientPlatform() === "darwin";

if (forkVibrancyEnabled) {
  const root = document.documentElement;
  root.classList.add("fork-vibrancy");
  const applyTint = () => {
    const tint = readLocalStorageValue(
      FORK_WINDOW_TINT_STORAGE_KEY,
      FORK_WINDOW_TINT_DEFAULT,
      ForkWindowTint,
    );
    root.style.setProperty("--fork-glass", `${tint}%`);
  };
  applyTint();
  subscribeLocalStorageKey(FORK_WINDOW_TINT_STORAGE_KEY, applyTint);
}

/** The page background as a solid color, even when vibrancy makes the body translucent. */
export function forkSolidPageBackground(): string {
  if (!forkVibrancyEnabled) {
    return getComputedStyle(document.body).backgroundColor;
  }
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--app-chrome-background")
    .trim();
}
