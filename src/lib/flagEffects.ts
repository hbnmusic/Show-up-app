/**
 * What the app does when a kill switch is off, beyond hiding things: clearing what it already downloaded. Runs after the
 * flags load at launch and whenever they change. Each effect is idempotent, so running twice is harmless.
 */
import { isOn, type Flags } from './flagsCore';

export type FlagEffectDeps = {
  /** Rebuild the combined listing (drops cached JamBase shows when JamBase is off). */
  recombine: () => Promise<void>;
  /** Forget previews and artist photos and empty the picture cache. */
  clearDeezer: () => Promise<void>;
  /** Cancel every notification this app scheduled. */
  cancelNotifications: () => Promise<void>;
  /** A small persistent marker so the picture cache is emptied once per switch-off, not at every launch. */
  getMarker: () => Promise<boolean>;
  setMarker: (cleared: boolean) => Promise<void>;
};

export type FlagEffectResult = { recombined: boolean; clearedDeezer: boolean; cancelledNotifications: boolean };

export async function runFlagEffects(flags: Flags, deps: FlagEffectDeps): Promise<FlagEffectResult> {
  const out: FlagEffectResult = { recombined: false, clearedDeezer: false, cancelledNotifications: false };
  await deps.recombine();
  out.recombined = true;

  if (!isOn(flags, 'deezer_enabled')) {
    if (!(await deps.getMarker())) {
      await deps.clearDeezer();
      await deps.setMarker(true);
      out.clearedDeezer = true;
    }
  } else if (await deps.getMarker()) {
    await deps.setMarker(false);
  }

  if (!isOn(flags, 'notifications_enabled')) {
    await deps.cancelNotifications();
    out.cancelledNotifications = true;
  }
  return out;
}
