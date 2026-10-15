export type Special = 'none' | 'lineH' | 'lineV' | 'bomb';

export const BOMB_KIND = -1;

export interface Tile {
  id: number;
  kind: number;
  special: Special;
}

export interface Pos {
  r: number;
  c: number;
}

export type GameMode = 'classic' | 'timed';

export interface PlacedTile {
  pos: Pos;
  tile: Tile;
}

export interface TileMove {
  id: number;
  from: Pos;
  to: Pos;
}

export interface SwapStep {
  type: 'swap' | 'swapBack';
  a: Pos;
  b: Pos;
  idA: number;
  idB: number;
}

export interface LineEffect {
  dir: 'row' | 'col';
  index: number;
}

export interface BombEffect {
  pos: Pos;
  kind: number | 'all';
}

export interface ClearStep {
  type: 'clear';
  combo: number;
  points: number;
  cleared: PlacedTile[];
  created: PlacedTile[];
  lines: LineEffect[];
  bombs: BombEffect[];
}

export interface FallStep {
  type: 'fall';
  moves: TileMove[];
  spawned: (PlacedTile & { fromRow: number })[];
}

export interface ShuffleStep {
  type: 'shuffle';
  moves: TileMove[];
}

export type Step = SwapStep | ClearStep | FallStep | ShuffleStep;
