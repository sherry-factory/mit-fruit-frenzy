import type { Rng } from './rng';
import {
  BOMB_KIND,
  type BombEffect,
  type FallStep,
  type LineEffect,
  type PlacedTile,
  type Pos,
  type ShuffleStep,
  type Special,
  type Step,
  type SwapStep,
  type Tile,
  type TileMove,
} from './types';

export interface BoardOptions {
  rows?: number;
  cols?: number;
  kinds?: number;
  rng?: Rng;
}

/** A number is a plain fruit kind, `'B'` is a color bomb, `'2h'` / `'2v'` are line blasters of kind 2. */
export type LayoutCell = number | string;

export interface MoveResult {
  valid: boolean;
  steps: Step[];
}

interface Run {
  dir: 'h' | 'v';
  kind: number;
  cells: Pos[];
}

export interface MatchGroup {
  kind: number;
  cells: Pos[];
  runs: Run[];
}

interface Creation {
  pos: Pos;
  kind: number;
  special: Special;
}

interface ForcedClear {
  seeds: Pos[];
  bombKinds: Map<number, number | 'all'>;
}

const MAX_CASCADES = 100;
const MAX_SHUFFLE_ATTEMPTS = 1000;

const isLine = (t: Tile) => t.special === 'lineH' || t.special === 'lineV';

export class Board {
  readonly rows: number;
  readonly cols: number;
  readonly kinds: number;
  readonly grid: (Tile | null)[][];
  private readonly rng: Rng;
  private nextId = 1;

  constructor(options: BoardOptions = {}, layout?: LayoutCell[][]) {
    this.rows = layout?.length ?? options.rows ?? 8;
    this.cols = layout?.[0]?.length ?? options.cols ?? 8;
    this.kinds = options.kinds ?? 6;
    this.rng = options.rng ?? Math.random;
    this.grid = Array.from({ length: this.rows }, () => Array<Tile | null>(this.cols).fill(null));
    if (layout) this.loadLayout(layout);
    else this.fillInitial();
  }

  static isAdjacent(a: Pos, b: Pos): boolean {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  inBounds(p: Pos): boolean {
    return p.r >= 0 && p.r < this.rows && p.c >= 0 && p.c < this.cols;
  }

  get(p: Pos): Tile | null {
    return this.inBounds(p) ? this.grid[p.r][p.c] : null;
  }

  /** Swaps two tiles and resolves every resulting clear, fall, and cascade. */
  trySwap(a: Pos, b: Pos): MoveResult {
    const ta = this.get(a);
    const tb = this.get(b);
    if (!ta || !tb || !Board.isAdjacent(a, b)) return { valid: false, steps: [] };

    const swap: SwapStep = { type: 'swap', a, b, idA: ta.id, idB: tb.id };
    const steps: Step[] = [swap];
    this.swapCells(a, b);

    if (ta.special === 'bomb' || tb.special === 'bomb') {
      const bombKinds = new Map<number, number | 'all'>();
      if (ta.special === 'bomb' && tb.special === 'bomb') {
        bombKinds.set(this.key(a), 'all');
        bombKinds.set(this.key(b), 'all');
      } else if (ta.special === 'bomb') {
        bombKinds.set(this.key(b), tb.kind);
      } else {
        bombKinds.set(this.key(a), ta.kind);
      }
      this.resolve(steps, [], { seeds: [a, b], bombKinds });
    } else if (isLine(ta) && isLine(tb)) {
      // Two blasters fire as a cross: one clears a column, the other a row.
      ta.special = 'lineV';
      tb.special = 'lineH';
      this.resolve(steps, [], { seeds: [a, b], bombKinds: new Map() });
    } else if (this.hasMatchAt(a) || this.hasMatchAt(b)) {
      this.resolve(steps, [b, a]);
    } else {
      this.swapCells(a, b);
      steps.push({ ...swap, type: 'swapBack' });
      return { valid: false, steps };
    }
    return { valid: true, steps };
  }

  findMatches(): MatchGroup[] {
    const runs: Run[] = [];
    this.scanRuns('h', runs);
    this.scanRuns('v', runs);

    // Runs that share a cell (L and T shapes) merge into one group.
    const parent = runs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map<number, number>();
    runs.forEach((run, i) => {
      for (const p of run.cells) {
        const k = this.key(p);
        const j = owner.get(k);
        if (j === undefined) owner.set(k, i);
        else parent[find(i)] = find(j);
      }
    });

    const groups = new Map<number, { kind: number; runs: Run[]; cells: Map<number, Pos> }>();
    runs.forEach((run, i) => {
      const root = find(i);
      let g = groups.get(root);
      if (!g) {
        g = { kind: run.kind, runs: [], cells: new Map() };
        groups.set(root, g);
      }
      g.runs.push(run);
      for (const p of run.cells) g.cells.set(this.key(p), p);
    });
    return [...groups.values()].map((g) => ({ kind: g.kind, runs: g.runs, cells: [...g.cells.values()] }));
  }

  validMoves(): [Pos, Pos][] {
    const moves: [Pos, Pos][] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const a = { r, c };
        for (const b of [{ r, c: c + 1 }, { r: r + 1, c }]) {
          if (this.inBounds(b) && this.isValidSwap(a, b)) moves.push([a, b]);
        }
      }
    }
    return moves;
  }

  hasMoves(): boolean {
    return this.validMoves().length > 0;
  }

  findHint(): [Pos, Pos] | null {
    const moves = this.validMoves();
    return moves.length ? moves[Math.floor(this.rng() * moves.length)] : null;
  }

  /** Rearranges the existing tiles until there are no matches and at least one move. */
  shuffle(): ShuffleStep {
    const tiles: Tile[] = [];
    const origin = new Map<number, Pos>();
    this.forEachCell((pos, tile) => {
      if (!tile) return;
      tiles.push(tile);
      origin.set(tile.id, pos);
    });

    for (let attempt = 1; attempt <= MAX_SHUFFLE_ATTEMPTS; attempt++) {
      // Some fruit mixes can never form a move, so re-roll plain fruit occasionally.
      if (attempt % 50 === 0) {
        for (const t of tiles) if (t.special === 'none') t.kind = this.randomKind();
      }
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      let i = 0;
      this.forEachCell((pos) => {
        this.grid[pos.r][pos.c] = tiles[i++] ?? null;
      });
      if (this.findMatches().length === 0 && this.hasMoves()) break;
    }

    const moves: TileMove[] = [];
    this.forEachCell((to, tile) => {
      if (tile) moves.push({ id: tile.id, from: origin.get(tile.id)!, to });
    });
    return { type: 'shuffle', moves };
  }

  private resolve(steps: Step[], preferred: Pos[], forced?: ForcedClear): void {
    for (let combo = 1; combo <= MAX_CASCADES; combo++) {
      let seeds: Pos[];
      let bombKinds = new Map<number, number | 'all'>();
      const creations: Creation[] = [];

      if (forced) {
        ({ seeds, bombKinds } = forced);
        forced = undefined;
      } else {
        const groups = this.findMatches();
        if (!groups.length) return;
        seeds = groups.flatMap((g) => g.cells);
        for (const g of groups) {
          const special = this.specialFor(g);
          if (special === 'none') continue;
          creations.push({
            pos: this.spawnPos(g, preferred),
            kind: special === 'bomb' ? BOMB_KIND : g.kind,
            special,
          });
        }
      }
      preferred = [];

      const { cells, lines, bombs } = this.collectClears(seeds, bombKinds);
      const cleared: PlacedTile[] = cells.map((pos) => ({ pos, tile: this.grid[pos.r][pos.c]! }));
      for (const { pos } of cleared) this.grid[pos.r][pos.c] = null;
      const created: PlacedTile[] = creations.map(({ pos, kind, special }) => {
        const tile = this.newTile(kind, special);
        this.grid[pos.r][pos.c] = tile;
        return { pos, tile };
      });

      const bonus = created.reduce((sum, c) => sum + (c.tile.special === 'bomb' ? 100 : 40), 0);
      steps.push({
        type: 'clear',
        combo,
        points: (cleared.length * 10 + bonus) * combo,
        cleared,
        created,
        lines,
        bombs,
      });
      steps.push(this.applyGravity());
    }
  }

  /** Expands the seed cells with every blaster and bomb they set off, recursively. */
  private collectClears(seeds: Pos[], bombKinds: Map<number, number | 'all'>) {
    const cells = new Map<number, Pos>();
    const lines: LineEffect[] = [];
    const bombs: BombEffect[] = [];
    const queue = [...seeds];

    while (queue.length) {
      const p = queue.pop()!;
      const k = this.key(p);
      const tile = this.get(p);
      if (!tile || cells.has(k)) continue;
      cells.set(k, p);

      if (tile.special === 'lineH') {
        lines.push({ dir: 'row', index: p.r });
        for (let c = 0; c < this.cols; c++) queue.push({ r: p.r, c });
      } else if (tile.special === 'lineV') {
        lines.push({ dir: 'col', index: p.c });
        for (let r = 0; r < this.rows; r++) queue.push({ r, c: p.c });
      } else if (tile.special === 'bomb') {
        const kind = bombKinds.get(k) ?? this.mostCommonKind();
        bombs.push({ pos: p, kind });
        this.forEachCell((pos, t) => {
          if (t && (kind === 'all' || t.kind === kind)) queue.push(pos);
        });
      }
    }
    return { cells: [...cells.values()], lines, bombs };
  }

  private applyGravity(): FallStep {
    const moves: TileMove[] = [];
    const spawned: FallStep['spawned'] = [];
    for (let c = 0; c < this.cols; c++) {
      let write = this.rows - 1;
      for (let r = this.rows - 1; r >= 0; r--) {
        const tile = this.grid[r][c];
        if (!tile) continue;
        if (r !== write) {
          this.grid[write][c] = tile;
          this.grid[r][c] = null;
          moves.push({ id: tile.id, from: { r, c }, to: { r: write, c } });
        }
        write--;
      }
      const empty = write + 1;
      for (let r = write; r >= 0; r--) {
        const tile = this.newTile(this.randomKind());
        this.grid[r][c] = tile;
        spawned.push({ tile, pos: { r, c }, fromRow: r - empty });
      }
    }
    return { type: 'fall', moves, spawned };
  }

  private specialFor(group: MatchGroup): Special {
    const longest = this.longestRun(group);
    if (longest.cells.length >= 5) return 'bomb';
    if (longest.cells.length === 4 || group.runs.length > 1) {
      return longest.dir === 'h' ? 'lineH' : 'lineV';
    }
    return 'none';
  }

  private spawnPos(group: MatchGroup, preferred: Pos[]): Pos {
    const inGroup = (p: Pos) => group.cells.some((q) => q.r === p.r && q.c === p.c);
    const pref = preferred.find(inGroup);
    if (pref) return pref;

    if (group.runs.length > 1) {
      const counts = new Map<number, number>();
      for (const run of group.runs) {
        for (const p of run.cells) counts.set(this.key(p), (counts.get(this.key(p)) ?? 0) + 1);
      }
      const corner = group.cells.find((p) => (counts.get(this.key(p)) ?? 0) > 1);
      if (corner) return corner;
    }
    const longest = this.longestRun(group);
    return longest.cells[Math.floor(longest.cells.length / 2)];
  }

  private longestRun(group: MatchGroup): Run {
    return group.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  }

  private scanRuns(dir: 'h' | 'v', out: Run[]): void {
    const lineCount = dir === 'h' ? this.rows : this.cols;
    const length = dir === 'h' ? this.cols : this.rows;
    const at = (line: number, i: number): Pos => (dir === 'h' ? { r: line, c: i } : { r: i, c: line });

    for (let line = 0; line < lineCount; line++) {
      let start = 0;
      for (let i = 1; i <= length; i++) {
        const kind = this.matchKind(at(line, start));
        if (i < length && this.matchKind(at(line, i)) === kind) continue;
        if (kind !== null && i - start >= 3) {
          out.push({ dir, kind, cells: Array.from({ length: i - start }, (_, j) => at(line, start + j)) });
        }
        start = i;
      }
    }
  }

  private isValidSwap(a: Pos, b: Pos): boolean {
    const ta = this.get(a);
    const tb = this.get(b);
    if (!ta || !tb) return false;
    if (ta.special === 'bomb' || tb.special === 'bomb') return true;
    if (isLine(ta) && isLine(tb)) return true;
    this.swapCells(a, b);
    const ok = this.hasMatchAt(a) || this.hasMatchAt(b);
    this.swapCells(a, b);
    return ok;
  }

  private hasMatchAt(p: Pos): boolean {
    const kind = this.matchKind(p);
    if (kind === null) return false;
    const count = (dr: number, dc: number) => {
      let n = 0;
      let q = { r: p.r + dr, c: p.c + dc };
      while (this.matchKind(q) === kind) {
        n++;
        q = { r: q.r + dr, c: q.c + dc };
      }
      return n;
    };
    return 1 + count(0, -1) + count(0, 1) >= 3 || 1 + count(-1, 0) + count(1, 0) >= 3;
  }

  private matchKind(p: Pos): number | null {
    const tile = this.get(p);
    return tile && tile.kind >= 0 ? tile.kind : null;
  }

  private mostCommonKind(): number {
    const counts = new Array<number>(this.kinds).fill(0);
    this.forEachCell((_, t) => {
      if (t && t.kind >= 0) counts[t.kind]++;
    });
    return counts.indexOf(Math.max(...counts));
  }

  private fillInitial(): void {
    do {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          let kind: number;
          do kind = this.randomKind();
          while (this.wouldStartRun(r, c, kind));
          this.grid[r][c] = this.newTile(kind);
        }
      }
    } while (!this.hasMoves());
  }

  private wouldStartRun(r: number, c: number, kind: number): boolean {
    const k = (rr: number, cc: number) => this.grid[rr][cc]?.kind;
    return (c >= 2 && k(r, c - 1) === kind && k(r, c - 2) === kind) || (r >= 2 && k(r - 1, c) === kind && k(r - 2, c) === kind);
  }

  private loadLayout(layout: LayoutCell[][]): void {
    layout.forEach((row, r) =>
      row.forEach((cell, c) => {
        this.grid[r][c] = this.parseCell(cell);
      }),
    );
  }

  private parseCell(cell: LayoutCell): Tile {
    if (typeof cell === 'number') return this.newTile(cell);
    if (cell === 'B') return this.newTile(BOMB_KIND, 'bomb');
    const m = /^(\d+)([hv])$/.exec(cell);
    if (!m) throw new Error(`Unknown layout cell: ${cell}`);
    return this.newTile(Number(m[1]), m[2] === 'h' ? 'lineH' : 'lineV');
  }

  private swapCells(a: Pos, b: Pos): void {
    const t = this.grid[a.r][a.c];
    this.grid[a.r][a.c] = this.grid[b.r][b.c];
    this.grid[b.r][b.c] = t;
  }

  private forEachCell(fn: (pos: Pos, tile: Tile | null) => void): void {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) fn({ r, c }, this.grid[r][c]);
  }

  private newTile(kind: number, special: Special = 'none'): Tile {
    return { id: this.nextId++, kind, special };
  }

  private randomKind(): number {
    return Math.floor(this.rng() * this.kinds);
  }

  private key(p: Pos): number {
    return p.r * this.cols + p.c;
  }
}
