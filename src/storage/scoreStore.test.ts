import { describe, expect, it } from 'vitest';
import { LocalScoreStore } from './scoreStore';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('LocalScoreStore', () => {
  it('keeps the best score per mode', async () => {
    const store = new LocalScoreStore(memoryStorage());
    expect(await store.getBest('classic')).toBe(0);
    expect(await store.submitScore('classic', 500)).toEqual({ best: 500, isNewBest: true });
    expect(await store.submitScore('classic', 300)).toEqual({ best: 500, isNewBest: false });
    expect(await store.getBest('classic')).toBe(500);
    expect(await store.getBest('timed')).toBe(0);
  });

  it('does not count a zero score as a new best', async () => {
    const store = new LocalScoreStore(memoryStorage());
    expect(await store.submitScore('timed', 0)).toEqual({ best: 0, isNewBest: false });
  });

  it('works without storage', async () => {
    const store = new LocalScoreStore(null);
    expect(await store.submitScore('timed', 100)).toEqual({ best: 100, isNewBest: true });
    expect(await store.getBest('timed')).toBe(0);
  });
});
