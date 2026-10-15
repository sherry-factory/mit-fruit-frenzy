import { describe, expect, it } from 'vitest';
import { Board, type LayoutCell } from './board';
import { mulberry32 } from './rng';
import { BOMB_KIND, type ClearStep, type Step } from './types';

// Plain fruit kinds 2-5 in a pattern where no two neighbors match, leaving kinds 0 and 1 free for test setups.
const filler = (r: number, c: number) => 2 + ((c + 2 * r) % 4);

function makeBoard(overrides: Record<string, LayoutCell>, size = 5, seed = 1): Board {
  const layout = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => overrides[`${r},${c}`] ?? filler(r, c)),
  );
  return new Board({ rng: mulberry32(seed) }, layout);
}

const clears = (steps: Step[]) => steps.filter((s): s is ClearStep => s.type === 'clear');
const ids = (b: Board) => b.grid.map((row) => row.map((t) => t?.id));

function expectSettled(b: Board) {
  expect(b.grid.flat().every(Boolean)).toBe(true);
  expect(b.findMatches()).toHaveLength(0);
}

describe('Board', () => {
  it('starts full, with no matches and at least one move', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const b = new Board({ rng: mulberry32(seed) });
      expectSettled(b);
      expect(b.hasMoves()).toBe(true);
    }
  });

  it('ignores swaps between tiles that are not neighbors', () => {
    const b = makeBoard({});
    expect(b.trySwap({ r: 0, c: 0 }, { r: 0, c: 2 })).toEqual({ valid: false, steps: [] });
    expect(b.trySwap({ r: 0, c: 0 }, { r: 1, c: 1 })).toEqual({ valid: false, steps: [] });
  });

  it('swaps back and leaves the board unchanged when no match forms', () => {
    const b = makeBoard({});
    const before = ids(b);
    const result = b.trySwap({ r: 0, c: 0 }, { r: 0, c: 1 });
    expect(result.valid).toBe(false);
    expect(result.steps.map((s) => s.type)).toEqual(['swap', 'swapBack']);
    expect(ids(b)).toEqual(before);
  });

  it('clears a match of three and refills the board', () => {
    const b = makeBoard({ '2,0': 0, '2,1': 0, '1,2': 0 });
    const result = b.trySwap({ r: 1, c: 2 }, { r: 2, c: 2 });
    expect(result.valid).toBe(true);
    const [first] = clears(result.steps);
    expect(first.cleared.map((c) => c.pos)).toEqual(
      expect.arrayContaining([{ r: 2, c: 0 }, { r: 2, c: 1 }, { r: 2, c: 2 }]),
    );
    expect(first.cleared).toHaveLength(3);
    expect(first.points).toBe(30);
    expect(first.created).toHaveLength(0);
    expectSettled(b);
  });

  it('turns a horizontal match of four into a row blaster where the fruit landed', () => {
    const b = makeBoard({ '2,0': 0, '2,1': 0, '2,3': 0, '1,2': 0 });
    const [first] = clears(b.trySwap({ r: 1, c: 2 }, { r: 2, c: 2 }).steps);
    expect(first.cleared).toHaveLength(4);
    expect(first.created).toMatchObject([{ pos: { r: 2, c: 2 }, tile: { kind: 0, special: 'lineH' } }]);
    expect(first.points).toBe(80);
  });

  it('turns a vertical match of four into a column blaster', () => {
    const b = makeBoard({ '0,2': 0, '1,2': 0, '3,2': 0, '2,1': 0 });
    const [first] = clears(b.trySwap({ r: 2, c: 1 }, { r: 2, c: 2 }).steps);
    expect(first.created).toMatchObject([{ pos: { r: 2, c: 2 }, tile: { kind: 0, special: 'lineV' } }]);
  });

  it('turns a match of five into a color bomb', () => {
    const b = makeBoard({ '2,0': 0, '2,1': 0, '2,3': 0, '2,4': 0, '1,2': 0 });
    const [first] = clears(b.trySwap({ r: 1, c: 2 }, { r: 2, c: 2 }).steps);
    expect(first.cleared).toHaveLength(5);
    expect(first.created).toMatchObject([{ pos: { r: 2, c: 2 }, tile: { kind: BOMB_KIND, special: 'bomb' } }]);
  });

  it('fires a row blaster when it is part of a match', () => {
    const b = makeBoard({ '2,0': 0, '2,1': '0h', '1,2': 0 });
    const [first] = clears(b.trySwap({ r: 1, c: 2 }, { r: 2, c: 2 }).steps);
    expect(first.lines).toEqual([{ dir: 'row', index: 2 }]);
    expect(first.cleared.map((c) => c.pos).sort((a, b) => a.c - b.c)).toEqual(
      [0, 1, 2, 3, 4].map((c) => ({ r: 2, c })),
    );
  });

  it('clears every fruit of the swapped kind when a color bomb is swapped', () => {
    const b = makeBoard({ '0,0': 'B' });
    const partnerKind = b.get({ r: 0, c: 1 })!.kind;
    const sameKind = b.grid.flat().filter((t) => t!.kind === partnerKind).length;
    const result = b.trySwap({ r: 0, c: 0 }, { r: 0, c: 1 });
    expect(result.valid).toBe(true);
    const [first] = clears(result.steps);
    expect(first.bombs).toMatchObject([{ kind: partnerKind }]);
    expect(first.cleared).toHaveLength(sameKind + 1);
    expectSettled(b);
  });

  it('clears the whole board when two color bombs are swapped', () => {
    const b = makeBoard({ '0,0': 'B', '0,1': 'B' });
    const [first] = clears(b.trySwap({ r: 0, c: 0 }, { r: 0, c: 1 }).steps);
    expect(first.cleared).toHaveLength(25);
  });

  it('chains cascades and multiplies their points', () => {
    // Clearing column 2 drops the 1 at (1,2) next to the 1s at (4,0) and (4,1).
    const b = makeBoard({ '2,2': 0, '3,2': 0, '4,3': 0, '4,0': 1, '4,1': 1, '1,2': 1 });
    const steps = clears(b.trySwap({ r: 4, c: 3 }, { r: 4, c: 2 }).steps);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[1].combo).toBe(2);
    expect(steps[1].cleared.map((c) => c.pos)).toEqual(
      expect.arrayContaining([{ r: 4, c: 0 }, { r: 4, c: 1 }, { r: 4, c: 2 }]),
    );
    expect(steps[1].points).toBeGreaterThanOrEqual(60);
  });

  it('suggests hints that are always valid moves', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const b = new Board({ rng: mulberry32(seed) });
      const hint = b.findHint();
      expect(hint).not.toBeNull();
      expect(b.trySwap(...hint!).valid).toBe(true);
    }
  });

  it('shuffles the same tiles into a playable board with no matches', () => {
    const b = new Board({ rng: mulberry32(7) });
    const before = b.grid.flat().map((t) => t!.id).sort((x, y) => x - y);
    const step = b.shuffle();
    expect(step.moves).toHaveLength(64);
    expect(b.grid.flat().map((t) => t!.id).sort((x, y) => x - y)).toEqual(before);
    expectSettled(b);
    expect(b.hasMoves()).toBe(true);
  });
});
