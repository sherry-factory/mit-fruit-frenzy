const MUTE_KEY = 'fruit-frenzy:muted';

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
}

const note = (base: number, semitones: number) => base * 2 ** (semitones / 12);

/** All sounds are synthesized with Web Audio, so there are no audio files to ship. */
export class Sfx {
  muted = readFlag(MUTE_KEY);
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /** Browsers only allow audio after a user gesture, so call this from input handlers. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.6;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeFlag(MUTE_KEY, this.muted);
    return this.muted;
  }

  select(): void {
    this.tone(740, 0.07, { type: 'triangle', gain: 0.12 });
  }

  hint(): void {
    this.tone(880, 0.1, { gain: 0.12 });
    this.tone(1175, 0.14, { gain: 0.1, delay: 0.09 });
  }

  swap(): void {
    this.tone(380, 0.1, { type: 'triangle', gain: 0.14, slideTo: 620 });
  }

  invalid(): void {
    this.tone(220, 0.12, { type: 'square', gain: 0.05, slideTo: 150 });
    this.tone(180, 0.16, { type: 'square', gain: 0.05, delay: 0.1, slideTo: 110 });
  }

  match(combo: number): void {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const f = note(523.25, scale[Math.min(combo - 1, scale.length - 1)]);
    this.tone(f, 0.14, { gain: 0.2 });
    this.tone(f * 1.5, 0.16, { type: 'triangle', gain: 0.07, delay: 0.04 });
    this.tone(f * 2, 0.12, { gain: 0.05, delay: 0.08 });
  }

  special(): void {
    [0, 4, 7, 12].forEach((n, i) => this.tone(note(784, n), 0.12, { type: 'triangle', gain: 0.1, delay: i * 0.05 }));
  }

  blast(): void {
    this.noise(0.35, 0.3, 3000, 300);
    this.tone(320, 0.3, { type: 'sawtooth', gain: 0.05, slideTo: 80 });
  }

  bomb(): void {
    this.noise(0.7, 0.35, 1500, 120);
    [0, 4, 7, 11, 14].forEach((n, i) => this.tone(note(392, n), 0.5, { gain: 0.07, delay: i * 0.04 }));
  }

  shuffle(): void {
    for (let i = 0; i < 8; i++) this.tone(400 + i * 90, 0.05, { type: 'triangle', gain: 0.08, delay: i * 0.05 });
  }

  start(): void {
    [0, 4, 7].forEach((n, i) => this.tone(note(523.25, n), 0.12, { type: 'triangle', gain: 0.12, delay: i * 0.08 }));
  }

  tick(): void {
    this.tone(1046, 0.06, { type: 'square', gain: 0.05 });
  }

  gameOver(): void {
    [12, 7, 4, 0].forEach((n, i) => this.tone(note(392, n), 0.22, { type: 'triangle', gain: 0.12, delay: i * 0.16 }));
  }

  newBest(): void {
    [0, 4, 7, 12, 16, 19].forEach((n, i) =>
      this.tone(note(523.25, n), 0.22, { type: 'triangle', gain: 0.12, delay: i * 0.09 }),
    );
  }

  private live(): { ctx: AudioContext; out: GainNode } | null {
    return this.muted || !this.ctx || !this.out ? null : { ctx: this.ctx, out: this.out };
  }

  private tone(freq: number, duration: number, { type = 'sine', gain = 0.15, delay = 0, slideTo }: ToneOptions = {}): void {
    const audio = this.live();
    if (!audio) return;
    const t = audio.ctx.currentTime + delay;
    const osc = audio.ctx.createOscillator();
    const env = audio.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env);
    env.connect(audio.out);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private noise(duration: number, gain: number, fromHz: number, toHz: number): void {
    const audio = this.live();
    if (!audio) return;
    const { ctx } = audio;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(fromHz, t);
    filter.frequency.exponentialRampToValueAtTime(toHz, t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(env);
    env.connect(audio.out);
    src.start(t);
    src.stop(t + duration + 0.05);
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Storage unavailable: the mute setting just won't persist.
  }
}
