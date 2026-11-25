import type { CSSProperties } from "react";
import { useGT } from "gt-react";

import {
  FORK_WINDOW_TINT_DEFAULT,
  FORK_WINDOW_TINT_STORAGE_KEY,
  ForkWindowTint,
  forkVibrancyEnabled,
} from "../../forkVibrancy";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

/** Fork: how strongly the macOS window tint covers the blurred desktop. */
export function ForkWindowTintRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const [tint, setTint] = useLocalStorage(
    FORK_WINDOW_TINT_STORAGE_KEY,
    FORK_WINDOW_TINT_DEFAULT,
    ForkWindowTint,
  );
  if (!forkVibrancyEnabled) return null;
  const sliderStyle = {
    "--settings-slider-progress": `${tint}%`,
    "--settings-slider-fill-offset": `${0.5 - tint / 100}rem`,
  } as CSSProperties;
  return (
    <SettingsRow
      {...searchableSetting("setting-fork-window-tint")}
      description={gt(
        "How much color covers the blurred desktop behind the window. 0% shows only the blur.",
      )}
      devicePreference
      resetAction={
        tint !== FORK_WINDOW_TINT_DEFAULT ? (
          <SettingResetButton
            ariaLabel={gt("Reset window tint to default")}
            onClick={() => setTint(FORK_WINDOW_TINT_DEFAULT)}
          />
        ) : null
      }
      control={
        <div className="flex w-full items-center gap-3 sm:w-52">
          <output
            className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
            htmlFor="fork-window-tint"
          >
            {tint}%
          </output>
          <input
            aria-label={gt("Window tint")}
            className="settings-slider min-w-0 flex-1"
            id="fork-window-tint"
            max={100}
            min={0}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isInteger(value) && value >= 0 && value <= 100) setTint(value);
            }}
            step={5}
            style={sliderStyle}
            type="range"
            value={tint}
          />
        </div>
      }
    />
  );
}
