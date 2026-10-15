import { FRUITS, RAINBOW } from '../game/fruits';
import type { ClearStep, FallStep, LineEffect, PlacedTile, Pos, ShuffleStep, SwapStep, Tile } from '../game/types';
import { easeDrop, easeInOutCubic, easeOutBack, easeOutCubic, lerp, linear, type Ease } from './easing';
import { drawTileSprite, roundRect } from './sprites';

const TEXT_FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif';
const COMBO_WORDS = ['Juicy!', 'Sweet!', 'Fruit-tastic!', 'Berry good!', 'Smoothie time!', 'Tutti frutti!'];

// Visual positions, particles, and text all live in cell units so they survive a resize.
interface Visual {
  tile: Tile;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  spin: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  banner: boolean;
}

interface Effect {
  life: number;
  maxLife: number;
  draw: (ctx: CanvasRenderingContext2D, remaining: number) => void;
}

interface Tween {
  elapsed: number;
  duration: number;
  ease: Ease;
  update: (k: number) => void;
  resolve: () => void;
}

export class Renderer {
  cell = 0;
  selected: Pos | null = null;
  hint: [Pos, Pos] | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private size = 0;
  private pad = 0;
  private time = 0;
  private shake = 0;
  private visuals = new Map<number, Visual>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private tweens: Tween[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private effects: Effect[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rows: number,
    private readonly cols: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
    this.ctx = ctx;
  }

  resize(cssSize: number): void {
    this.size = cssSize;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(cssSize * this.dpr);
    this.canvas.height = Math.round(cssSize * this.dpr);
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    this.pad = Math.round(cssSize * 0.02);
    this.cell = (cssSize - this.pad * 2) / this.cols;
    this.sprites.clear();
  }

  cellAt(clientX: number, clientY: number): Pos | null {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left - this.pad) / this.cell);
    const r = Math.floor((clientY - rect.top - this.pad) / this.cell);
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols ? { r, c } : null;
  }

  /** Drops in-flight animations. Their promises are abandoned, so callers must guard with their own generation check. */
  reset(): void {
    this.tweens = [];
    this.particles = [];
    this.floaters = [];
    this.effects = [];
    this.visuals.clear();
    this.selected = null;
    this.hint = null;
    this.shake = 0;
  }

  /** Snaps every visual to the board's true state. */
  sync(grid: (Tile | null)[][]): void {
    const seen = new Set<number>();
    grid.forEach((row, r) =>
      row.forEach((tile, c) => {
        if (!tile) return;
        seen.add(tile.id);
        const v = this.visuals.get(tile.id);
        if (v) Object.assign(v, { tile, x: c, y: r, scale: 1, alpha: 1, spin: 0 });
        else this.visuals.set(tile.id, this.makeVisual(tile, c, r));
      }),
    );
    for (const id of [...this.visuals.keys()]) if (!seen.has(id)) this.visuals.delete(id);
  }

  animateSwap(step: SwapStep): Promise<void> {
    const back = step.type === 'swapBack';
    const va = this.visuals.get(step.idA);
    const vb = this.visuals.get(step.idB);
    const [from, to] = back ? [step.b, step.a] : [step.a, step.b];
    return this.tween(
      back ? 200 : 170,
      (k) => {
        if (va) Object.assign(va, { x: lerp(from.c, to.c, k), y: lerp(from.r, to.r, k) });
        if (vb) Object.assign(vb, { x: lerp(to.c, from.c, k), y: lerp(to.r, from.r, k) });
      },
      easeInOutCubic,
    );
  }

  async animateClear(step: ClearStep): Promise<void> {
    for (const line of step.lines) this.addBeam(line);
    for (const bomb of step.bombs) this.addBombBurst(bomb.pos, step.cleared);
    if (step.bombs.length) this.shake = Math.max(this.shake, 0.6);
    else if (step.lines.length) this.shake = Math.max(this.shake, 0.3);

    const fading: Visual[] = [];
    let sx = 0;
    let sy = 0;
    for (const { tile, pos } of step.cleared) {
      sx += pos.c;
      sy += pos.r;
      const v = this.visuals.get(tile.id);
      if (v) fading.push(v);
      this.burst(pos, tile);
    }
    const n = Math.max(1, step.cleared.length);
    this.floaters.push({
      text: `+${step.points}`,
      x: sx / n,
      y: sy / n,
      life: 0.9,
      maxLife: 0.9,
      size: 0.5,
      color: '#ffffff',
      banner: false,
    });
    if (step.combo >= 2) {
      const word = COMBO_WORDS[Math.min(step.combo - 2, COMBO_WORDS.length - 1)];
      this.banner(`${word} x${step.combo}`, RAINBOW[step.combo % RAINBOW.length]);
    }

    const appearing = step.created.map(({ tile, pos }) => {
      const v = this.makeVisual(tile, pos.c, pos.r);
      v.scale = 0;
      this.visuals.set(tile.id, v);
      return v;
    });

    await this.tween(
      240,
      (k) => {
        for (const v of fading) {
          v.scale = (1 - k) * (1 + 0.35 * k);
          v.alpha = 1 - k * k;
        }
        for (const v of appearing) v.scale = easeOutBack(k);
      },
      linear,
    );
    for (const { tile } of step.cleared) this.visuals.delete(tile.id);
  }

  async animateFall(step: FallStep): Promise<void> {
    const drops: Promise<void>[] = [];
    for (const m of step.moves) {
      const v = this.visuals.get(m.id);
      if (v) drops.push(this.drop(v, m.from.r, m.to.r));
    }
    for (const s of step.spawned) {
      const v = this.makeVisual(s.tile, s.pos.c, s.fromRow);
      this.visuals.set(s.tile.id, v);
      drops.push(this.drop(v, s.fromRow, s.pos.r));
    }
    await Promise.all(drops);
  }

  animateShuffle(step: ShuffleStep): Promise<void> {
    const cx = (this.cols - 1) / 2;
    const cy = (this.rows - 1) / 2;
    const items = step.moves.flatMap((m) => {
      const v = this.visuals.get(m.id);
      return v ? [{ v, m }] : [];
    });
    return this.tween(
      800,
      (k) => {
        for (const { v, m } of items) {
          const gather = k < 0.5;
          const t = easeInOutCubic(gather ? k * 2 : (k - 0.5) * 2);
          const from = gather ? { c: m.from.c, r: m.from.r } : { c: cx, r: cy };
          const to = gather ? { c: cx, r: cy } : { c: m.to.c, r: m.to.r };
          v.x = lerp(from.c, to.c, t);
          v.y = lerp(from.r, to.r, t);
          v.scale = gather ? 1 - 0.5 * t : 0.5 + 0.5 * t;
          v.spin = Math.sin(k * Math.PI) * Math.PI;
        }
      },
      linear,
    );
  }

  banner(text: string, color = '#ffd23f'): void {
    this.floaters = this.floaters.filter((f) => !f.banner);
    this.floaters.push({
      text,
      x: (this.cols - 1) / 2,
      y: (this.rows - 1) / 2,
      life: 1.2,
      maxLife: 1.2,
      size: 0.85,
      color,
      banner: true,
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2);

    const finished: Tween[] = [];
    for (const t of this.tweens) {
      t.elapsed += dt * 1000;
      const k = Math.min(1, t.elapsed / t.duration);
      t.update(t.ease(k));
      if (k >= 1) finished.push(t);
    }
    if (finished.length) {
      this.tweens = this.tweens.filter((t) => !finished.includes(t));
      finished.forEach((t) => t.resolve());
    }

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 9 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const f of this.floaters) {
      f.life -= dt;
      if (!f.banner) f.y -= 0.8 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
  }

  draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    if (this.shake > 0) {
      const amount = this.shake * this.cell * 0.12;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    }

    this.drawBoard();
    this.drawHighlights();

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.pad, this.pad, this.cols * this.cell, this.rows * this.cell);
    ctx.clip();
    for (const v of this.visuals.values()) this.drawVisual(v);
    ctx.restore();

    for (const e of this.effects) e.draw(ctx, e.life / e.maxLife);

    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(this.px(p.x), this.px(p.y), p.size * this.cell, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of this.floaters) this.drawFloater(f);
  }

  private drawBoard(): void {
    const { ctx, cell, pad } = this;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.28)';
        roundRect(ctx, pad + c * cell + 1.5, pad + r * cell + 1.5, cell - 3, cell - 3, cell * 0.2);
        ctx.fill();
      }
    }
  }

  private drawHighlights(): void {
    const { ctx, cell, pad } = this;
    if (this.selected) {
      const { r, c } = this.selected;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 210, 63, 0.6)';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, cell * 0.06);
      roundRect(ctx, pad + c * cell + 2, pad + r * cell + 2, cell - 4, cell - 4, cell * 0.22);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (this.hint) {
      const alpha = 0.55 + 0.4 * Math.sin(this.time * 7);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.shadowColor = '#fff6a8';
      ctx.shadowBlur = cell * 0.35;
      ctx.lineWidth = Math.max(3, cell * 0.08);
      for (const { r, c } of this.hint) {
        roundRect(ctx, pad + c * cell + 3, pad + r * cell + 3, cell - 6, cell - 6, cell * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawVisual(v: Visual): void {
    if (v.alpha <= 0.01 || v.scale <= 0.01) return;
    const { ctx } = this;
    let scale = v.scale;
    let lift = 0;
    let rotation = v.spin;
    if (v.tile.special !== 'none') scale *= 1 + 0.05 * Math.sin(this.time * 5 + v.tile.id);
    if (v.tile.special === 'bomb') rotation += this.time * 1.2;
    if (this.selected && this.isAt(v, this.selected)) scale *= 1.08 + 0.03 * Math.sin(this.time * 8);
    if (this.hint && this.hint.some((p) => this.isAt(v, p))) lift = Math.abs(Math.sin(this.time * 6)) * 0.12;

    ctx.save();
    ctx.globalAlpha = v.alpha;
    ctx.translate(this.px(v.x), this.px(v.y - lift));
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.drawImage(this.sprite(v.tile), -this.cell / 2, -this.cell / 2, this.cell, this.cell);
    ctx.restore();
  }

  private drawFloater(f: Floater): void {
    const { ctx } = this;
    const remaining = f.life / f.maxLife;
    const age = 1 - remaining;
    const scale = f.banner && age < 0.15 ? easeOutBack(age / 0.15) : 1;
    const fontSize = f.size * this.cell;
    ctx.save();
    ctx.globalAlpha = Math.min(1, remaining * 2.5);
    ctx.translate(this.px(f.x), this.px(f.y));
    ctx.scale(scale, scale);
    ctx.font = `900 ${fontSize}px ${TEXT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.2;
    ctx.strokeStyle = 'rgba(90, 20, 70, 0.85)';
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }

  private addBeam(line: LineEffect): void {
    this.effects.push({
      life: 0.35,
      maxLife: 0.35,
      draw: (ctx, remaining) => {
        const thickness = this.cell * 0.75 * remaining;
        const span = (line.dir === 'row' ? this.cols : this.rows) * this.cell;
        const center = this.px(line.index);
        ctx.save();
        ctx.globalAlpha = remaining;
        ctx.fillStyle = '#fffbe0';
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = this.cell * 0.6;
        if (line.dir === 'row') ctx.fillRect(this.pad, center - thickness / 2, span, thickness);
        else ctx.fillRect(center - thickness / 2, this.pad, thickness, span);
        ctx.restore();
      },
    });
  }

  private addBombBurst(origin: Pos, cleared: PlacedTile[]): void {
    const targets = cleared.map((c) => c.pos).filter((p) => p.r !== origin.r || p.c !== origin.c);
    this.effects.push({
      life: 0.55,
      maxLife: 0.55,
      draw: (ctx, remaining) => {
        const x = this.px(origin.c);
        const y = this.px(origin.r);
        ctx.save();
        ctx.globalAlpha = remaining;
        ctx.lineCap = 'round';
        ctx.lineWidth = this.cell * 0.07;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = this.cell * 0.4;
        ctx.beginPath();
        for (const t of targets) {
          ctx.moveTo(x, y);
          ctx.lineTo(this.px(t.c), this.px(t.r));
        }
        ctx.stroke();
        ctx.lineWidth = this.cell * 0.2 * remaining;
        ctx.strokeStyle = RAINBOW[Math.floor(this.time * 20) % RAINBOW.length];
        ctx.beginPath();
        ctx.arc(x, y, (1 - remaining) * this.cell * 5 + this.cell * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },
    });
  }

  private burst(pos: Pos, tile: Tile): void {
    if (this.particles.length > 700) return;
    for (let i = 0; i < 9; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      const life = 0.45 + Math.random() * 0.4;
      this.particles.push({
        x: pos.c,
        y: pos.r,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life,
        maxLife: life,
        color: tile.special === 'bomb' ? RAINBOW[i % RAINBOW.length] : FRUITS[tile.kind].color,
        size: 0.05 + Math.random() * 0.07,
      });
    }
  }

  private drop(v: Visual, fromRow: number, toRow: number): Promise<void> {
    const distance = Math.max(0, toRow - fromRow);
    return this.tween(
      160 + 75 * Math.sqrt(distance),
      (k) => {
        v.y = lerp(fromRow, toRow, k);
      },
      easeDrop,
    );
  }

  private tween(duration: number, update: (k: number) => void, ease: Ease = easeOutCubic): Promise<void> {
    update(ease(0));
    return new Promise((resolve) => this.tweens.push({ elapsed: 0, duration, ease, update, resolve }));
  }

  private sprite(tile: Tile): HTMLCanvasElement {
    const key = `${tile.kind}:${tile.special}`;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      sprite = drawTileSprite(tile, Math.max(8, Math.round(this.cell * this.dpr)));
      this.sprites.set(key, sprite);
    }
    return sprite;
  }

  private makeVisual(tile: Tile, x: number, y: number): Visual {
    return { tile, x, y, scale: 1, alpha: 1, spin: 0 };
  }

  private isAt(v: Visual, p: Pos): boolean {
    return Math.abs(v.x - p.c) < 0.01 && Math.abs(v.y - p.r) < 0.01;
  }

  /** Converts a cell coordinate to the canvas pixel at that cell's center. */
  private px(cellCoord: number): number {
    return this.pad + (cellCoord + 0.5) * this.cell;
  }
}
