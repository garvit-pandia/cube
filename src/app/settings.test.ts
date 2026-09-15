import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  animationScaleFor,
  loadSettings,
  loadSidebarOpen,
  saveSettings,
  saveSidebarOpen,
  type Settings,
} from './settings';
import { fakeStorage } from '../test/support';

describe('settings', () => {
  it('falls back to defaults when storage is missing', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.sound).toBe(true);
  });

  it('falls back to defaults when nothing is stored', () => {
    const { storage } = fakeStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const { storage } = fakeStorage();
    const settings: Settings = {
      animationSpeed: 'fast',
      forceReducedMotion: true,
      sound: false,
    };
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
      'cube3:settings': JSON.stringify({
        animationSpeed: 'ludicrous',
        forceReducedMotion: 'yes',
        sound: 'yes',
      }),
    });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields when only one is invalid', () => {
    const { storage } = fakeStorage({
      'cube3:settings': JSON.stringify({
        animationSpeed: 'instant',
        forceReducedMotion: 'yes',
        sound: 'yes',
      }),
    });
    expect(loadSettings(storage)).toEqual({
      animationSpeed: 'instant',
      forceReducedMotion: false,
      sound: true,
    });
  });

  it('never throws without storage', () => {
    expect(() => saveSettings(null, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('animation scale', () => {
  it('maps speeds to increasing brevity', () => {
    expect(
      animationScaleFor({ animationSpeed: 'normal', forceReducedMotion: false, sound: true }),
    ).toBe(1);
    const fast = animationScaleFor({
      animationSpeed: 'fast',
      forceReducedMotion: false,
      sound: true,
    });
    const instant = animationScaleFor({
      animationSpeed: 'instant',
      forceReducedMotion: false,
      sound: true,
    });
    expect(fast).toBeLessThan(1);
    expect(fast).toBeGreaterThan(instant);
    expect(instant).toBeGreaterThan(0);
  });
});

describe('sidebar persistence', () => {
  it('defaults to open without storage', () => {
    expect(loadSidebarOpen(null)).toBe(true);
  });

  it('defaults to open when nothing is stored', () => {
    const { storage } = fakeStorage();
    expect(loadSidebarOpen(storage)).toBe(true);
  });

  it('defaults to open on a corrupt payload', () => {
    const { storage } = fakeStorage({ 'cube3:sidebar': 'not json at all' });
    expect(() => loadSidebarOpen(storage)).not.toThrow();
    expect(loadSidebarOpen(storage)).toBe(true);
  });

  it('defaults to open for non-boolean payloads', () => {
    const { storage } = fakeStorage({ 'cube3:sidebar': '"yes"' });
    expect(loadSidebarOpen(storage)).toBe(true);
    const { storage: numeric } = fakeStorage({ 'cube3:sidebar': '1' });
    expect(loadSidebarOpen(numeric)).toBe(true);
  });

  it('reads a stored false', () => {
    const { storage } = fakeStorage({ 'cube3:sidebar': 'false' });
    expect(loadSidebarOpen(storage)).toBe(false);
  });

  it('round-trips closed and open through storage', () => {
    const { storage } = fakeStorage();
    saveSidebarOpen(storage, false);
    expect(loadSidebarOpen(storage)).toBe(false);
    saveSidebarOpen(storage, true);
    expect(loadSidebarOpen(storage)).toBe(true);
  });

  it('never throws without storage', () => {
    expect(() => saveSidebarOpen(null, false)).not.toThrow();
  });

  it('overwrites the previous value when saved twice', () => {
    const { storage, data } = fakeStorage();
    saveSidebarOpen(storage, false);
    saveSidebarOpen(storage, true);
    expect(loadSidebarOpen(storage)).toBe(true);
    expect(data['cube3:sidebar']).toBe('true');
  });
});
