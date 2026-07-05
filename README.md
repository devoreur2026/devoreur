# UMBRA — The Maze That Eats Light

A 3D first-person maze treasure hunt built with Three.js (r128). A huge
procedurally generated maze shrouded in darkness; you carry only a torch.
"Darkness Eater" keepers patrol the corridors, hear you sprint, chase on sight,
and kill on contact. The Heart of the Maze waits at the farthest point from
spawn. Drop beacons, manage sprint stamina, and outrun the dark.

## Run it

```bash
npm run dev      # serves at http://localhost:5173
```

No install step — the dev server is a single zero-dependency Node script.
Three.js is loaded from a CDN, so the first load needs an internet connection.

## Project structure

The former single `umbra-maze.html` is split into ES modules under `src/`,
loaded via `<script type="module">` from `index.html`.

| File | Responsibility |
|------|----------------|
| `index.html`   | Page shell: DOM, styles, loads Three.js (CDN) then `src/main.js`. |
| `src/three.js` | Re-exports the global `THREE` (UMD CDN build) for clean imports. |
| `src/config.js`| Tunable constants (maze size, speeds, sight/hearing ranges). |
| `src/state.js` | Shared mutable game-flow state (`playing`, `ended`, `deaths`, `time`). |
| `src/util.js`  | Small helpers (`fmt` time formatting). |
| `src/maze.js`  | Maze generation (carve + braid), BFS distance fields, spawn/treasure placement, tile↔world coords, collision & line-of-sight. |
| `src/agents.js`| Shared grid-walking movement used by keepers and bots. |
| `src/audio.js` | Procedural Web Audio (ambient drone + one-shot SFX). |
| `src/scene.js` | Renderer, scene, camera, lights, textures, walls, dust, treasure, glow/name sprites, per-frame world animation. |
| `src/player.js`| Player movement/stamina, camera, all input (keyboard/mouse/touch), beacons. |
| `src/enemies.js`| Darkness Eaters: sensing, chase pathfield, movement, kill check. |
| `src/bots.js`  | Simulated rival hunters (placeholder for networked players). |
| `src/hud.js`   | HUD updates: stamina, danger/shield, heartbeat, timer, hunter list. |
| `src/game.js`  | Overlays and flow: start / death / respawn / win, mute. |
| `src/main.js`  | Entry point: the render/update loop wiring everything together. |
| `server.js`    | Zero-dependency static dev server. |

### How the modules fit together

`main.js` owns the loop and the shared `clock`/`state`. Each frame it advances
time, runs `updatePlayer` → `updateField` → win check, then `updateKeepers` /
`updateBots` / `animateWorld` / `applyCamera` / `updateHud` and renders.

Cross-cutting state lives in `state.js` so modules don't have to import each
other just to read `playing`. The keeper "kill" is injected into
`updateKeepers` as a callback (`die`) so `enemies.js` stays independent of game
flow. `scene.js` exposes the world objects and the shared `makeGlow` /
`nameSprite` helpers that keepers, bots and the treasure all reuse.

## Roadmap

This is the prototype. The vision is real-time, server-authoritative
multiplayer — many players hunting the same treasure in the same maze — which
is why the maze, agent movement and simulated bots are already isolated in
their own modules.
