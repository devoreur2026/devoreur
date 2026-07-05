// A room: one maze shared by up to MAX_PLAYERS. Owns the authoritative truth
// (maze seed, treasure, every player position, the eaters) and ticks the
// simulation at TICK_HZ, broadcasting world state to all clients. Handles
// deaths (server-decided) and round flow (first to the treasure wins; then a
// countdown regenerates the maze for the next round).
import { generateMaze, WX, TX, id } from '../shared/maze.js';
import {
  TICK_DT, MAX_PLAYERS, WIN_DIST, FIELD_REFRESH, ROUND_COUNTDOWN,
  RELIC_MIN_D, RELIC_MAX_D, RELIC_PICKUP_D
} from '../shared/config.js';
import { MSG, PHASE } from '../shared/protocol.js';
import { Eaters } from './eaters.js';
import { ServerPlayer } from './player.js';

var nextPlayerId = 1;

export class Room {
  constructor(name){
    this.name = name;
    this.players = new Map();      // id -> ServerPlayer
    this.phase = PHASE.PLAYING;
    this.countdown = 0;
    this.winnerName = null;
    this.t = 0;
    this.lastTick = Date.now();
    this.newRound();
    this.timer = setInterval(() => this.tick(), TICK_DT * 1000);
  }

  get size(){ return this.players.size; }
  hasRoom(){ return this.players.size < MAX_PLAYERS; }

  gridB64(){ return Buffer.from(this.grid).toString('base64'); }
  roundMsg(){
    return { t: MSG.ROUND, seed: this.seed, grid: this.gridB64(),
             treasure: this.treasureT, start: this.startT };
  }

  newRound(){
    this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    var gen = generateMaze(this.seed);
    this.maze = gen.maze;
    this.grid = gen.grid;
    this.dS = gen.dS;
    this.tField = gen.tField;
    this.treasureT = gen.treasureT;
    this.startT = gen.startT;
    this.startWX = { x: WX(this.startT.x), z: WX(this.startT.z) };
    this.treasureWX = { x: WX(this.treasureT.x), z: WX(this.treasureT.z) };
    this.best = gen.best;
    this.rnd = gen.rnd;
    this.eaters = new Eaters(this.maze, this.dS, gen.best, gen.rnd);
    this.spawnRelic();
    this.phase = PHASE.PLAYING;
    this.winnerName = null;
    this.t = 0;
    for (var p of this.players.values()){ var s = this.spawnPos(p); p.spawnAt(s.x, s.z); }
    this.broadcast(this.roundMsg());
  }

  // Where a player (re)spawns: start normally, or a few cells from the treasure
  // for dev testing (server-gated by UMBRA_DEV; see index.js).
  spawnPos(p){
    if (p.devSpawn){
      var cell = this.maze.randOpenCell(this.tField, 2, 4, this.rnd);
      return { x: WX(cell.x), z: WX(cell.z) };
    }
    return this.startWX;
  }

  // The Torn Map relic: one per round, on an open cell 40–70% of the treasure's
  // BFS distance from spawn. Lives on the ground until someone walks over it.
  spawnRelic(){
    var cell = this.maze.randOpenCell(this.dS, RELIC_MIN_D * this.best, RELIC_MAX_D * this.best, this.rnd);
    this.relic = { onGround: true, carrier: 0, x: WX(cell.x), z: WX(cell.z) };
  }

  addPlayer(name, ws, dev){
    var pid = nextPlayerId++;
    var p = new ServerPlayer(pid, name, this.players.size, ws);
    p.devSpawn = (dev === 'treasure');
    var s = this.spawnPos(p); p.spawnAt(s.x, s.z);
    this.players.set(pid, p);
    this.send(ws, { t: MSG.WELCOME, id: pid, color: p.color });
    this.send(ws, this.roundMsg());
    return p;
  }
  removePlayer(id){
    if (this.relic && this.relic.carrier === id){
      var p = this.players.get(id);
      this.dropRelicAt(p ? p.x : this.relic.x, p ? p.z : this.relic.z);
    }
    this.players.delete(id);
  }

  onInput(p, cmds){
    if (this.phase !== PHASE.PLAYING) return;
    p.applyCommands(this.maze, cmds, Date.now() / 1000);
  }

  // BFS field from a player's current tile, rebuilt on tile-change or timeout.
  refreshFields(dt){
    for (var p of this.players.values()){
      p.fieldT -= dt;
      var tile = id(TX(p.x), TX(p.z));
      if (tile !== p.tile || p.fieldT <= 0 || !p.field){
        p.field = this.maze.bfs(TX(p.x), TX(p.z));
        p.tile = tile; p.fieldT = FIELD_REFRESH;
      }
    }
  }

  // Pick-up detection (walk over) + keep a carried relic on the carrier.
  updateRelic(){
    var r = this.relic;
    if (r.onGround){
      for (var pp of this.players.values()){
        var dx = pp.x - r.x, dz = pp.z - r.z;
        if (dx * dx + dz * dz < RELIC_PICKUP_D * RELIC_PICKUP_D){
          r.onGround = false; r.carrier = pp.id;
          this.broadcast({ t: MSG.RELIC, name: pp.name });
          break;
        }
      }
    } else {
      var carrier = this.players.get(r.carrier);
      if (carrier){ r.x = carrier.x; r.z = carrier.z; }
      else { r.onGround = true; r.carrier = 0; }   // carrier vanished -> drop where last known
    }
  }

  // Drop the relic at a spot for anyone to grab.
  dropRelicAt(x, z){
    this.relic.onGround = true; this.relic.carrier = 0;
    this.relic.x = x; this.relic.z = z;
  }

  kill(pid){
    var p = this.players.get(pid);
    if (!p || p.invuln > 0) return;
    if (this.relic.carrier === pid) this.dropRelicAt(p.x, p.z);   // drops at the death spot
    p.deaths++;
    var s = this.spawnPos(p); p.spawnAt(s.x, s.z);
    this.send(p.ws, { t: MSG.KILLED });
  }

  endRound(winner){
    this.phase = PHASE.COUNTDOWN;
    this.countdown = ROUND_COUNTDOWN;
    this.winnerName = winner ? winner.name : null;
    this.broadcast({ t: MSG.ROUND_OVER,
      winnerId: winner ? winner.id : 0,
      winnerName: this.winnerName });
  }

  tick(){
    var now = Date.now();
    var dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    if (this.phase === PHASE.COUNTDOWN){
      this.countdown -= dt;
      if (this.countdown <= 0){ this.newRound(); }
      this.broadcastState();
      return;
    }

    this.t += dt;
    this.refreshFields(dt);

    var arr = [];
    for (var p of this.players.values()){
      p.invuln = Math.max(0, p.invuln - dt);
      arr.push({ id: p.id, x: p.x, z: p.z, invuln: p.invuln, speed: p.speed });
    }

    this.updateRelic();

    var self = this;
    this.eaters.update(dt, this.t, arr,
      function(pid){ var pp = self.players.get(pid); return pp ? pp.field : null; },
      function(pid){ self.kill(pid); },
      this.relic.carrier);

    // win: first player to the treasure
    for (var pw of this.players.values()){
      var dx = this.treasureWX.x - pw.x, dz = this.treasureWX.z - pw.z;
      if (Math.sqrt(dx * dx + dz * dz) < WIN_DIST){ this.endRound(pw); break; }
    }

    this.broadcastState();
  }

  broadcastState(){
    var players = [];
    for (var p of this.players.values()) players.push(p.snapshot());
    this.broadcast({
      t: MSG.STATE,
      time: +this.t.toFixed(2),
      players: players,
      eaters: this.eaters.snapshot(),
      map: { g: this.relic.onGround ? 1 : 0, x: +this.relic.x.toFixed(2), z: +this.relic.z.toFixed(2), c: this.relic.carrier },
      round: {
        phase: this.phase,
        timeLeft: this.phase === PHASE.COUNTDOWN ? Math.ceil(this.countdown) : 0,
        winner: this.winnerName
      }
    });
  }

  broadcast(obj){
    var s = JSON.stringify(obj);
    for (var p of this.players.values()){
      if (p.ws && p.ws.readyState === 1) p.ws.send(s);
    }
  }
  send(ws, obj){ if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  dispose(){ clearInterval(this.timer); }
}
