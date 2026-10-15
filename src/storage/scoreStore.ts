import type { GameMode } from '../game/types';

export interface SubmitResult {
  best: number;
  isNewBest: boolean;
}

/** Async on purpose, so a networked leaderboard can implement the same contract. */
export interface ScoreStore {
  getBest(mode: GameMode): Promise<number>;
  submitScore(mode: GameMode, score: number): Promise<SubmitResult>;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY_PREFIX = 'fruit-frenzy:best:';

export class LocalScoreStore implements ScoreStore {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  async getBest(mode: GameMode): Promise<number> {
    const value = Number(this.read(KEY_PREFIX + mode));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  async submitScore(mode: GameMode, score: number): Promise<SubmitResult> {
    const previous = await this.getBest(mode);
    if (score <= previous) return { best: previous, isNewBest: false };
    this.write(KEY_PREFIX + mode, String(score));
    return { best: score, isNewBest: true };
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Private browsing or a full quota: the score just isn't persisted.
    }
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
