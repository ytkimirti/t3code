import "./forkVibrancy.css";

// Fork: only the macOS desktop window has the native blur behind the page.
if (window.desktopBridge?.getClientPlatform() === "darwin") {
  document.documentElement.classList.add("fork-vibrancy");
}

/** The page background as a solid color, even when vibrancy makes the body translucent. */
export function forkSolidPageBackground(): string {
  if (!document.documentElement.classList.contains("fork-vibrancy")) {
    return getComputedStyle(document.body).backgroundColor;
  }
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--app-chrome-background")
    .trim();
}
