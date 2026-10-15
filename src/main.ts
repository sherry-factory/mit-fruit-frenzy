import './style.css';
import { Sfx } from './audio/sfx';
import { CLASSIC_SHUFFLES, Game, TIMED_SECONDS } from './game/game';
import type { GameMode } from './game/types';
import { LocalScoreStore, type ScoreStore } from './storage/scoreStore';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const ui = {
  canvas: byId<HTMLCanvasElement>('board'),
  boardWrap: byId('board-wrap'),
  score: byId('score'),
  best: byId('best'),
  timerStat: byId('timer-stat'),
  timerText: byId('timer-text'),
  timerFill: byId('timer-fill'),
  shuffles: byId('shuffles'),
  muteBtn: byId('mute-btn'),
  bestClassic: byId('best-classic'),
  bestTimed: byId('best-timed'),
  finalTitle: byId('final-title'),
  finalScore: byId('final-score'),
  finalBest: byId('final-best'),
  newBest: byId('new-best'),
  screens: {
    menu: byId('menu-screen'),
    pause: byId('pause-screen'),
    gameover: byId('gameover-screen'),
  },
};

type Screen = keyof typeof ui.screens;

const store: ScoreStore = new LocalScoreStore();
const sfx = new Sfx();
let mode: GameMode = 'classic';
let best = 0;

const game = new Game(ui.canvas, sfx, {
  onScore(score) {
    ui.score.textContent = score.toLocaleString();
    ui.best.textContent = Math.max(score, best).toLocaleString();
    bump(ui.score);
  },
  onTimer(left, total) {
    ui.timerText.textContent = String(Math.ceil(left));
    ui.timerFill.style.width = `${(left / total) * 100}%`;
    ui.timerStat.classList.toggle('low', left <= 10);
  },
  onShuffles(left) {
    ui.shuffles.textContent = String(left);
  },
  onGameOver(endedMode, score) {
    void showGameOver(endedMode, score);
  },
});

function bump(el: HTMLElement): void {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function showScreen(screen: Screen | null): void {
  for (const [name, el] of Object.entries(ui.screens)) el.classList.toggle('hidden', name !== screen);
}

async function showMenu(): Promise<void> {
  game.stop();
  showScreen('menu');
  const [classic, timed] = await Promise.all([store.getBest('classic'), store.getBest('timed')]);
  ui.bestClassic.textContent = classic.toLocaleString();
  ui.bestTimed.textContent = timed.toLocaleString();
}

async function startGame(next: GameMode): Promise<void> {
  sfx.unlock();
  mode = next;
  document.body.dataset.gameMode = next;
  best = await store.getBest(next);
  ui.best.textContent = best.toLocaleString();
  ui.timerText.textContent = String(TIMED_SECONDS);
  ui.shuffles.textContent = String(CLASSIC_SHUFFLES);
  showScreen(null);
  game.start(next);
}

async function showGameOver(endedMode: GameMode, score: number): Promise<void> {
  const result = await store.submitScore(endedMode, score);
  best = result.best;
  ui.finalTitle.textContent = endedMode === 'timed' ? "Time's up!" : 'Out of moves!';
  ui.finalScore.textContent = score.toLocaleString();
  ui.finalBest.textContent = result.best.toLocaleString();
  ui.newBest.classList.toggle('hidden', !result.isNewBest);
  if (result.isNewBest) sfx.newBest();
  showScreen('gameover');
}

function pause(): void {
  if (!game.isRunning || game.isPaused) return;
  game.setPaused(true);
  showScreen('pause');
}

function resume(): void {
  showScreen(null);
  game.setPaused(false);
}

function toggleMute(): void {
  sfx.unlock();
  sfx.toggleMute();
  renderMute();
}

function renderMute(): void {
  ui.muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
  ui.muteBtn.setAttribute('aria-label', sfx.muted ? 'Unmute sound' : 'Mute sound');
}

function layoutBoard(): void {
  const top = ui.boardWrap.getBoundingClientRect().top + window.scrollY;
  const available = Math.min(ui.boardWrap.clientWidth, window.innerHeight - top - 16, 600);
  game.renderer.resize(Math.floor(Math.max(260, available)));
}

document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'start':
      void startGame(button.dataset.mode as GameMode);
      break;
    case 'again':
      void startGame(mode);
      break;
    case 'menu':
      void showMenu();
      break;
    case 'pause':
      pause();
      break;
    case 'resume':
      resume();
      break;
    case 'hint':
      sfx.unlock();
      game.showHint();
      break;
    case 'mute':
      toggleMute();
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'h') game.showHint();
  else if (key === 'm') toggleMute();
  else if (key === 'p' || key === 'escape') {
    if (game.isPaused) resume();
    else pause();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

window.addEventListener('resize', layoutBoard);

document.body.dataset.gameMode = mode;
renderMute();
layoutBoard();
void showMenu();
