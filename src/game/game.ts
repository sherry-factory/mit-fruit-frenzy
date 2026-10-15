import { Renderer } from '../render/renderer';
import type { Sfx } from '../audio/sfx';
import { Board } from './board';
import type { GameMode, Pos, Step } from './types';

export const TIMED_SECONDS = 60;
export const CLASSIC_SHUFFLES = 3;
const HINT_SECONDS = 4;

export interface GameEvents {
  onScore(score: number): void;
  onTimer(secondsLeft: number, total: number): void;
  onShuffles(left: number): void;
  onGameOver(mode: GameMode, score: number): void;
}

interface Drag {
  pos: Pos;
  x: number;
  y: number;
  moved: boolean;
}

export class Game {
  readonly renderer: Renderer;
  private board: Board;
  private mode: GameMode = 'classic';
  private score = 0;
  private timeLeft = TIMED_SECONDS;
  private shufflesLeft = CLASSIC_SHUFFLES;
  private running = false;
  private paused = false;
  private busy = false;
  // Bumped whenever a game starts or stops so stale animation sequences stop touching state.
  private generation = 0;
  private selected: Pos | null = null;
  private drag: Drag | null = null;
  private hintTimer = 0;
  private lastTickSecond = -1;
  private lastFrame = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sfx: Sfx,
    private readonly events: GameEvents,
  ) {
    this.board = new Board();
    this.renderer = new Renderer(canvas, this.board.rows, this.board.cols);
    this.renderer.sync(this.board.grid);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    requestAnimationFrame(this.frame);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(mode: GameMode): void {
    this.generation++;
    this.mode = mode;
    this.score = 0;
    this.timeLeft = TIMED_SECONDS;
    this.shufflesLeft = CLASSIC_SHUFFLES;
    this.running = true;
    this.paused = false;
    this.busy = false;
    this.selected = null;
    this.drag = null;
    this.hintTimer = 0;
    this.lastTickSecond = -1;
    this.board = new Board();
    this.renderer.reset();
    this.renderer.sync(this.board.grid);
    this.renderer.banner(mode === 'timed' ? 'Go!' : 'Match fruits!');
    this.sfx.start();
    this.events.onScore(0);
    this.events.onTimer(this.timeLeft, TIMED_SECONDS);
    this.events.onShuffles(this.shufflesLeft);
  }

  stop(): void {
    this.generation++;
    this.running = false;
    this.paused = false;
    this.busy = false;
    this.setSelected(null);
    this.clearHint();
  }

  setPaused(paused: boolean): void {
    if (this.running) this.paused = paused;
  }

  showHint(): void {
    if (!this.canInteract()) return;
    const hint = this.board.findHint();
    if (!hint) return;
    this.renderer.hint = hint;
    this.hintTimer = HINT_SECONDS;
    this.sfx.hint();
  }

  private canInteract(): boolean {
    return this.running && !this.paused && !this.busy && !(this.mode === 'timed' && this.timeLeft <= 0);
  }

  private frame = (now: number) => {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (!this.paused) {
      this.renderer.update(dt);
      this.tick(dt);
    }
    this.renderer.draw();
    requestAnimationFrame(this.frame);
  };

  private tick(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.clearHint();
    }
    if (!this.running || this.mode !== 'timed' || this.timeLeft <= 0) return;

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.events.onTimer(this.timeLeft, TIMED_SECONDS);
    const second = Math.ceil(this.timeLeft);
    if (second <= 5 && second > 0 && second !== this.lastTickSecond) {
      this.lastTickSecond = second;
      this.sfx.tick();
    }
    // A cascade already in progress still finishes and scores before the game ends.
    if (this.timeLeft <= 0) {
      this.setSelected(null);
      if (!this.busy) this.finish();
    }
  }

  private async attemptSwap(a: Pos, b: Pos): Promise<void> {
    if (!this.canInteract() || !this.board.inBounds(b)) return;
    this.setSelected(null);
    this.clearHint();

    const result = this.board.trySwap(a, b);
    if (!result.steps.length) return;

    const gen = this.generation;
    this.busy = true;
    await this.play(result.steps, gen);
    if (result.valid) await this.ensureMoves(gen);
    if (gen !== this.generation) return;

    this.renderer.sync(this.board.grid);
    this.busy = false;
    if (this.running && this.mode === 'timed' && this.timeLeft <= 0) this.finish();
  }

  private async play(steps: Step[], gen: number): Promise<void> {
    for (const step of steps) {
      if (gen !== this.generation) return;
      switch (step.type) {
        case 'swap':
          this.sfx.swap();
          await this.renderer.animateSwap(step);
          break;
        case 'swapBack':
          this.sfx.invalid();
          await this.renderer.animateSwap(step);
          break;
        case 'clear':
          this.score += step.points;
          this.events.onScore(this.score);
          this.sfx.match(step.combo);
          if (step.bombs.length) this.sfx.bomb();
          else if (step.lines.length) this.sfx.blast();
          if (step.created.length) this.sfx.special();
          await this.renderer.animateClear(step);
          break;
        case 'fall':
          await this.renderer.animateFall(step);
          break;
        case 'shuffle':
          await this.renderer.animateShuffle(step);
          break;
      }
    }
  }

  private async ensureMoves(gen: number): Promise<void> {
    if (gen !== this.generation || this.board.hasMoves()) return;
    if (this.mode === 'classic') {
      if (this.shufflesLeft === 0) {
        this.finish();
        return;
      }
      this.shufflesLeft--;
      this.events.onShuffles(this.shufflesLeft);
    }
    this.renderer.banner('No moves! Shuffling…');
    this.sfx.shuffle();
    await this.play([this.board.shuffle()], gen);
  }

  private finish(): void {
    if (!this.running) return;
    this.running = false;
    this.setSelected(null);
    this.clearHint();
    this.renderer.banner(this.mode === 'timed' ? "Time's up!" : 'Out of moves!', '#ffffff');
    this.sfx.gameOver();
    const { generation, mode, score } = this;
    setTimeout(() => {
      if (generation === this.generation) this.events.onGameOver(mode, score);
    }, 1100);
  }

  private setSelected(pos: Pos | null): void {
    this.selected = pos;
    this.renderer.selected = pos;
  }

  private clearHint(): void {
    this.hintTimer = 0;
    this.renderer.hint = null;
  }

  private tap(pos: Pos): void {
    const sel = this.selected;
    if (sel && sel.r === pos.r && sel.c === pos.c) {
      this.setSelected(null);
    } else if (sel && Board.isAdjacent(sel, pos)) {
      void this.attemptSwap(sel, pos);
    } else {
      this.setSelected(pos);
      this.sfx.select();
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    this.sfx.unlock();
    if (!this.canInteract()) return;
    const pos = this.renderer.cellAt(e.clientX, e.clientY);
    if (!pos) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { pos, x: e.clientX, y: e.clientY, moved: false };
  };

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.moved) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.renderer.cell * 0.35) return;
    drag.moved = true;
    const target =
      Math.abs(dx) > Math.abs(dy)
        ? { r: drag.pos.r, c: drag.pos.c + Math.sign(dx) }
        : { r: drag.pos.r + Math.sign(dy), c: drag.pos.c };
    void this.attemptSwap(drag.pos, target);
  };

  private onPointerUp = () => {
    const drag = this.drag;
    this.drag = null;
    if (drag && !drag.moved && this.canInteract()) this.tap(drag.pos);
  };
}
