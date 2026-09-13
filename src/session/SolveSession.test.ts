import { describe, expect, it } from 'vitest';

import { SolveSession, formatTime, type SolveRecord, type StorageLike } from './SolveSession';

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

function record(timeMs: number, moves = 30, at = 0): SolveRecord {
  return { timeMs, moves, scramble: 'R U', at };
}

describe('solve session', () => {
  it('starts empty', () => {
    const session = new SolveSession();
    const stats = session.stats();
    expect(stats.count).toBe(0);
    expect(stats.best).toBeNull();
    expect(stats.latest).toBeNull();
    expect(stats.averageOf5).toBeNull();
    expect(stats.averageOf12).toBeNull();
  });

  it('tracks count, latest and best', () => {
    const session = new SolveSession();
    session.add(record(12_000));
    session.add(record(9_500));
    session.add(record(15_000));
    const stats = session.stats();
    expect(stats.count).toBe(3);
    expect(stats.latest?.timeMs).toBe(15_000);
    expect(stats.best?.timeMs).toBe(9_500);
  });

  it('returns null averages until the window is full', () => {
    const session = new SolveSession();
    for (const time of [10, 20, 30, 40]) session.add(record(time));
    expect(session.stats().averageOf5).toBeNull();
    session.add(record(50));
    expect(session.stats().averageOf5).not.toBeNull();
    expect(session.stats().averageOf12).toBeNull();
  });

  it('drops the best and worst from the average of five', () => {
    const session = new SolveSession();
    for (const time of [10, 20, 30, 40, 50]) session.add(record(time));
    // 10 and 50 are discarded; mean(20, 30, 40) = 30
    expect(session.stats().averageOf5).toBe(30);
  });

  it('uses only the most recent five for the average of five', () => {
    const session = new SolveSession();
    for (const time of [1, 2, 3, 10, 20, 30, 40, 50]) session.add(record(time));
    expect(session.stats().averageOf5).toBe(30);
  });

  it('drops the best and worst from the average of twelve', () => {
    const session = new SolveSession();
    for (let i = 1; i <= 12; i++) session.add(record(i));
    // 1 and 12 discarded; mean(2..11) = 6.5
    expect(session.stats().averageOf12).toBe(6.5);
  });

  it('lists the most recent solves first', () => {
    const session = new SolveSession();
    for (const time of [100, 200, 300]) session.add(record(time));
    expect(session.stats().recent.map((r) => r.timeMs)).toEqual([300, 200, 100]);
  });
});

describe('solve persistence', () => {
  it('round-trips records through storage', () => {
    const { storage } = fakeStorage();
    const first = new SolveSession(storage);
    first.add(record(11_111, 42, 7));

    const second = new SolveSession(storage);
    const stats = second.stats();
    expect(stats.count).toBe(1);
    expect(stats.latest).toEqual({ timeMs: 11_111, moves: 42, scramble: 'R U', at: 7 });
  });

  it('survives a corrupt payload instead of throwing', () => {
    const { storage } = fakeStorage({ 'cube3:solves': '{not json' });
    expect(() => new SolveSession(storage)).not.toThrow();
    expect(new SolveSession(storage).stats().count).toBe(0);
  });

  it('discards entries that do not look like solves', () => {
    const payload = JSON.stringify([
      { timeMs: 5000, moves: 10, scramble: 'R', at: 1 },
      { timeMs: 'fast', moves: 10, scramble: 'R', at: 1 },
      { nope: true },
      { timeMs: -5, moves: 10, scramble: 'R', at: 1 },
    ]);
    const { storage } = fakeStorage({ 'cube3:solves': payload });
    const session = new SolveSession(storage);
    expect(session.stats().count).toBe(1);
    expect(session.stats().latest?.timeMs).toBe(5000);
  });

  it('clears persisted records', () => {
    const { storage, data } = fakeStorage();
    const session = new SolveSession(storage);
    session.add(record(1000));
    session.clear();
    expect(session.stats().count).toBe(0);
    expect(JSON.parse(data['cube3:solves'])).toEqual([]);
    expect(new SolveSession(storage).stats().count).toBe(0);
  });

  it('works without any storage at all', () => {
    const session = new SolveSession(null);
    expect(() => session.add(record(1000))).not.toThrow();
    expect(session.stats().count).toBe(1);
  });

  it('caps stored history so it cannot grow without bound', () => {
    const { storage } = fakeStorage();
    const session = new SolveSession(storage);
    for (let i = 0; i < 260; i++) session.add(record(1000 + i));
    expect(session.stats().count).toBeLessThanOrEqual(200);
    expect(new SolveSession(storage).stats().count).toBeLessThanOrEqual(200);
  });
});

describe('time formatting', () => {
  it('formats sub-minute times with two decimals', () => {
    expect(formatTime(0)).toBe('0.00');
    expect(formatTime(1234)).toBe('1.23');
    expect(formatTime(12_340)).toBe('12.34');
    expect(formatTime(59_990)).toBe('59.99');
  });

  it('formats minute times as m:ss.xx', () => {
    expect(formatTime(60_000)).toBe('1:00.00');
    expect(formatTime(62_450)).toBe('1:02.45');
    expect(formatTime(600_000)).toBe('10:00.00');
  });

  it('pads the seconds field inside a minute', () => {
    expect(formatTime(65_000)).toBe('1:05.00');
  });
});
