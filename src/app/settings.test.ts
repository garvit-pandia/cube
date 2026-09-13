import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  animationScaleFor,
  loadSettings,
  saveSettings,
  type Settings,
} from './settings';
import type { StorageLike } from '../session/SolveSession';

function fakeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const storage: StorageLike = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
  return { storage, data };
}

describe('settings', () => {
  it('falls back to defaults when storage is missing', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when nothing is stored', () => {
    const { storage } = fakeStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const { storage } = fakeStorage();
    const settings: Settings = { animationSpeed: 'fast', forceReducedMotion: true };
    saveSettings(storage, settings);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('survives a corrupt payload', () => {
    const { storage } = fakeStorage({ 'cube3:settings': 'not json at all' });
    expect(() => loadSettings(storage)).not.toThrow();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects unknown values field by field', () => {
    const { storage } = fakeStorage({
      'cube3:settings': JSON.stringify({ animationSpeed: 'ludicrous', forceReducedMotion: 'yes' }),
    });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields when only one is invalid', () => {
    const { storage } = fakeStorage({
      'cube3:settings': JSON.stringify({ animationSpeed: 'instant', forceReducedMotion: 'yes' }),
    });
    expect(loadSettings(storage)).toEqual({ animationSpeed: 'instant', forceReducedMotion: false });
  });

  it('never throws without storage', () => {
    expect(() => saveSettings(null, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('animation scale', () => {
  it('maps speeds to increasing brevity', () => {
    expect(animationScaleFor({ animationSpeed: 'normal', forceReducedMotion: false })).toBe(1);
    const fast = animationScaleFor({ animationSpeed: 'fast', forceReducedMotion: false });
    const instant = animationScaleFor({ animationSpeed: 'instant', forceReducedMotion: false });
    expect(fast).toBeLessThan(1);
    expect(fast).toBeGreaterThan(instant);
    expect(instant).toBeGreaterThan(0);
  });
});
