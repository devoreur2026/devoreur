# UMBRA — The Maze That Eats Light

A real-time, **server-authoritative multiplayer** 3D maze treasure hunt built
with Three.js. Up to 12 players share one procedurally generated maze shrouded
in darkness, each carrying only a torch. "Darkness Eater" wraiths patrol the
corridors — they hear you sprint, chase you on sight, and kill on contact.
The first player to reach the Heart of the Maze wins the round; then a new maze
is generated and the next round begins.

The server owns all the truth (maze, treasure, every player's position, the
eaters, kills and wins). Clients send inputs and render; they can't cheat.

## Run it

```bash
npm install     # once — installs `ws`
npm start       # serves game + web at http://localhost:5173
```

Then open **two browser tabs** at http://localhost:5173, type a name in each,
and click **Enter the maze** — both players appear in the same maze and can see
each other. Three.js is vendored into `vendor/`, so there are no external
runtime dependencies — it runs fully offline.

> Tip: browsers throttle animation in *hidden* tabs, so put the two tabs in
> separate windows side by side to see both move at full speed at once.

## Deploy it online

See **[DEPLOY.md](DEPLOY.md)** for a step-by-step, beginner-friendly guide:
push to GitHub, then deploy to Railway (always-on) or Render (free). The server
listens on `process.env.PORT` and the client auto-uses `wss://` over HTTPS, so
it works behind a host's TLS proxy with no config.

## How the authority model works

- **Maze** — the server generates a maze from a seed and sends the grid to
  every client in the room. Everyone builds the identical maze; no client can
  invent its own.
- **Movement** — clients predict locally (so movement feels instant) and send
  their position ~30×/s. The server validates every move against a speed cap
  and full path/wall collision. Impossible moves (teleport, speed-hacks,
  clipping through walls) are rejected and the client is snapped back on the
  next broadcast.
- **World state** — the server ticks at 20Hz and broadcasts all players + eater
  positions. Clients interpolate the other players and eaters so 20Hz looks
  smooth.
- **Eaters, kills, wins** — all decided server-side. An eater touching a
  vulnerable player is a kill (respawn at start, +1 death). Reaching the
  treasure ends the round for everyone.

## Project structure

```
index.html            Page shell; loads Three.js (vendor/) then src/main.js
vendor/three.min.js   Three.js r128, vendored (no external runtime deps)
server/
  index.js            HTTP static server + WebSocket game server (entry point)
  room.js             A room: maze, players, eaters, 20Hz tick, round flow
  player.js           Authoritative player state + input validation (anti-cheat)
  eaters.js           Multi-player Darkness Eater AI
  agents.js           Grid-walking movement (server side)
shared/               Isomorphic modules used by BOTH server and client
  config.js           Constants (maze size, speeds, tick rate, room size…)
  maze.js             Seeded generation + grid-bound queries (collision, BFS…)
  prng.js             Seeded RNG (a seed reproduces a maze)
  protocol.js         WebSocket message types + round phases
src/                  Browser client
  net.js              WebSocket client + latest snapshot + event hooks
  scene.js            Renderer, lights, textures, torch, dust, treasure;
                      (re)builds the maze geometry from the server grid
  player.js           Local predicted movement, camera, input, reconciliation
  remotePlayers.js    Renders other players (body + name tag), interpolated
  eaters.js           Renders eaters from server snapshots, interpolated
  hud.js              Stamina, danger/heartbeat, timer, deaths, player roster
  game.js             Name entry, connect, round build, death & win overlays
  main.js             The render/update loop tying it together
  state.js, util.js   UI phase + helpers
```

### Reused from the original prototype

The maze generation/BFS/collision, grid movement, and Darkness Eater AI were
moved out of the old single-player client into `shared/` and `server/`. The
old `bots.js` (fake simulated players) is gone — `src/remotePlayers.js` renders
real networked players with the same body + name-tag visuals.

## Controls

WASD / arrows move · mouse look (click to lock pointer) · Shift sprint (loud —
eaters hear you) · **E** drop a beacon · **M** mute. On touch devices: left half
of the screen is a move stick, right half looks.

## Testing / verification

The build was verified with scripted tests (all passing): shared maze seed to
both clients; teleport and speed-hack rejected/clamped while legit moves apply;
two headless browser tabs joining one room and seeing each other; server-decided
kill + respawn; the full round flow (win → winner announced → maze regenerated →
countdown → next round); and smooth walking/sprinting under 200ms simulated
latency (no rubber-banding).

**Netcode:** the client sends fixed-timestep, sequence-numbered inputs; the
server simulates them authoritatively and acks the last processed sequence;
the client predicts locally and, on each snapshot, resets to the server state
and replays unacknowledged inputs, blending any residual correction over
~100ms. To feel it under load, append **`?lag=200&jitter=60`** to the URL — a
dev-only option that delays traffic both ways (a "SIM LAG" badge shows when
it's on). There's also a `window.UMBRA` handle for inspection in the console.
