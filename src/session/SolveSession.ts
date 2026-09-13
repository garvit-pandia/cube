/** One completed solve. */
export interface SolveRecord {
  readonly timeMs: number;
  readonly moves: number;
  readonly scramble: string;
  /** Epoch milliseconds, used only for display ordering and the recent list. */
  readonly at: number;
}

export interface SolveStats {
  readonly count: number;
  readonly best: SolveRecord | null;
  readonly latest: SolveRecord | null;
  /** WCA-style average: drop the best and worst of the last 5, mean the rest. */
  readonly averageOf5: number | null;
  /** WCA-style average: drop the best and worst of the last 12, mean the rest. */
  readonly averageOf12: number | null;
  readonly recent: readonly SolveRecord[];
}

/** The slice of `Storage` this module needs, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'cube3:solves';
const MAX_RECORDS = 200;

function isSolveRecord(value: unknown): value is SolveRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.timeMs === 'number' &&
    Number.isFinite(candidate.timeMs) &&
    candidate.timeMs > 0 &&
    typeof candidate.moves === 'number' &&
    typeof candidate.scramble === 'string' &&
    typeof candidate.at === 'number'
  );
}

/**
 * A WCA-style average: for `n` solves, discard the single best and single
 * worst result and take the arithmetic mean of what remains. Returns null
 * until enough solves exist.
 */
function trimmedAverage(times: readonly number[], window: number): number | null {
  if (times.length < window) return null;
  const slice = [...times.slice(-window)].sort((a, b) => a - b);
  const middle = slice.slice(1, -1);
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
}

/**
 * Solve history with basic statistics, persisted to `localStorage` when one is
 * available. Reads are defensive: a corrupt or foreign payload is discarded
 * rather than thrown.
 */
export class SolveSession {
  private storage: StorageLike | null;
  private records: SolveRecord[] = [];

  constructor(storage: StorageLike | null = null) {
    this.storage = storage;
    this.records = SolveSession.load(storage);
  }

  private static load(storage: StorageLike | null): SolveRecord[] {
    if (!storage) return [];
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isSolveRecord).slice(-MAX_RECORDS);
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // Quota or private-mode failures must never break a solve.
    }
  }

  add(record: SolveRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records = this.records.slice(-MAX_RECORDS);
    this.persist();
  }

  clear(): void {
    this.records = [];
    this.persist();
  }

  all(): readonly SolveRecord[] {
    return this.records;
  }

  stats(): SolveStats {
    const times = this.records.map((record) => record.timeMs);
    let best: SolveRecord | null = null;
    for (const record of this.records) {
      if (best === null || record.timeMs < best.timeMs) best = record;
    }
    return {
      count: this.records.length,
      best,
      latest: this.records[this.records.length - 1] ?? null,
      averageOf5: trimmedAverage(times, 5),
      averageOf12: trimmedAverage(times, 12),
      recent: this.records.slice(-25).reverse(),
    };
  }
}

/** Format milliseconds as a speedcubing-style time, e.g. `12.34` or `1:02.45`. */
export function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return totalSeconds.toFixed(2);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}
