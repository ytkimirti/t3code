import type * as Electron from "electron";

// Fork: the macOS main window shows a blurred native material behind the page.
// The web app's forkVibrancy.css makes its panes translucent over it.
const TRANSPARENT = "#00000000";
const vibrantWindows = new WeakSet<Electron.BrowserWindow>();

export function forkMainWindowMaterialOptions(
  platform: NodeJS.Platform,
): Pick<
  Electron.BrowserWindowConstructorOptions,
  "vibrancy" | "visualEffectState" | "backgroundColor"
> {
  if (platform !== "darwin") return {};
  // "active" keeps the blur while the window is unfocused instead of turning it gray.
  return { vibrancy: "under-window", visualEffectState: "active", backgroundColor: TRANSPARENT };
}

export function forkTrackVibrantWindow(
  window: Electron.BrowserWindow,
  platform: NodeJS.Platform,
): void {
  if (platform === "darwin") vibrantWindows.add(window);
}

export function forkWindowBackgroundColor(
  window: Electron.BrowserWindow,
  opaqueColor: string,
): string {
  return vibrantWindows.has(window) ? TRANSPARENT : opaqueColor;
}
