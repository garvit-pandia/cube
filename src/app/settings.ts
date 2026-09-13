import type { StorageLike } from '../session/SolveSession';

export type AnimationSpeed = 'normal' | 'fast' | 'instant';

export interface Settings {
  readonly animationSpeed: AnimationSpeed;
  /** Force reduced motion even when the OS does not ask for it. */
  readonly forceReducedMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  animationSpeed: 'normal',
  forceReducedMotion: false,
};

const STORAGE_KEY = 'cube3:settings';

/** Multiplier applied to turn durations. `instant` is effectively one frame. */
const SPEED_SCALE: Record<AnimationSpeed, number> = {
  normal: 1,
  fast: 0.55,
  instant: 0.001,
};

export function animationScaleFor(settings: Settings): number {
  return SPEED_SCALE[settings.animationSpeed];
}

function isSpeed(value: unknown): value is AnimationSpeed {
  return value === 'normal' || value === 'fast' || value === 'instant';
}

/** Defensive load: an unknown or corrupt payload falls back to the defaults. */
export function loadSettings(storage: StorageLike | null): Settings {
  if (!storage) return DEFAULT_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const candidate = parsed as Record<string, unknown>;
    return {
      animationSpeed: isSpeed(candidate.animationSpeed)
        ? candidate.animationSpeed
        : DEFAULT_SETTINGS.animationSpeed,
      forceReducedMotion:
        typeof candidate.forceReducedMotion === 'boolean'
          ? candidate.forceReducedMotion
          : DEFAULT_SETTINGS.forceReducedMotion,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: StorageLike | null, settings: Settings): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode / quota failures must not break the app.
  }
}

/** True when motion should be reduced, from either the OS or the user setting. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function safeStorage(): StorageLike | null {
  try {
    const probe = '__cube3_settings_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const SIDEBAR_KEY = 'cube3:sidebar';

/** Whether the controls sidebar starts open; corrupt/missing storage = open. */
export function loadSidebarOpen(storage: StorageLike | null): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(SIDEBAR_KEY);
    if (raw === null) return true;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : true;
  } catch {
    return true;
  }
}

export function saveSidebarOpen(storage: StorageLike | null, open: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_KEY, JSON.stringify(open));
  } catch {
    // Private mode / quota failures must not break the app.
  }
}
