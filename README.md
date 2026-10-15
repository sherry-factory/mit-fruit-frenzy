# MIT Fruit Frenzy

A match-3 puzzle game, like Bejeweled, but with fruit. It runs entirely in the browser with no backend.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev       # http://localhost:5173
```

Other scripts:

```bash
npm test          # unit tests for board logic and score storage
npm run build     # typecheck and build static files into dist/
npm run preview   # serve the production build
```

The `dist/` folder is a static site, so you can host it on Vercel, Netlify, GitHub Pages, or any static host.

## How to play

- Swipe a fruit, or tap two neighbors, to swap them. Line up 3 or more of the same fruit.
- Match 4 in a row to make a **Blaster** that clears its row or column. L and T shapes also make one.
- Match 5 in a row to make a **Rainbow Bomb**. Swap it with any fruit to clear every fruit of that kind.
- Swap two Blasters for a cross blast, or two Rainbow Bombs to clear the whole board.
- Chain reactions multiply your points.
- Keyboard: `H` hint, `P` or `Esc` pause, `M` mute.

### Modes

- **Classic**: no timer. When no moves are left, the board shuffles itself up to 3 times. After that, the game ends.
- **Timed**: 60 seconds to score as much as you can. Shuffles are unlimited.

The best score for each mode is saved in the browser's `localStorage`.

## Project layout

```
src/
  game/board.ts         Pure game rules: matching, specials, cascades, gravity, hints, shuffle
  game/game.ts          Game loop, modes, timer, input, and step-by-step animation playback
  render/renderer.ts    Canvas drawing, tweens, particles, and effects
  render/sprites.ts     Pre-rendered fruit, Blaster, and Rainbow Bomb tiles
  audio/sfx.ts          Sound effects synthesized with the Web Audio API
  storage/scoreStore.ts High score storage behind a small async interface
  main.ts               Menus, HUD, and wiring
```

`Board` has no DOM dependencies. Each move returns a list of steps (swap, clear, fall, shuffle) that the renderer animates in order, which keeps the rules easy to unit test.

## Adding a global leaderboard later

Scores go through the `ScoreStore` interface in `src/storage/scoreStore.ts`. To add a shared leaderboard (for example with Supabase or Vercel and Upstash Redis), write a new class that implements `ScoreStore` and swap it in `src/main.ts`. Nothing else in the game needs to change.
