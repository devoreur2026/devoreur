// A room: one maze shared by up to MAX_PLAYERS, with the paid-round economy.
// Owns the authoritative truth (maze, treasure, players, eaters) AND drives the
// money flow through the shared Bank: entry fees at round start, the kill
// economy, the pot, the payout on a win, and refunds on abort. All amounts and
// splits come from shared/economy and are enforced by the Bank; the room never
// touches balances directly.
import { generateMaze, WX, TX, id } from '../shared/maze.js';
import {
  TICK_DT, MAX_PLAYERS, WIN_DIST, FIELD_REFRESH, ROUND_COUNTDOWN
} from '../shared/config.js';
import {
  ENTRY_FEE, BONUS_POT, bonusUnlocked,
  FIREBALL_SPEED, FIREBALL_RANGE, FIREBALL_COOLDOWN, FIREBALL_HIT_R, FIREBALL_FLARE
} from '../shared/economy.js';
import { MSG, PHASE } from '../shared/protocol.js';
import { Eaters } from './eaters.js';
import { ServerPlayer } from './player.js';
import { bank } from './bankInstance.js';

var nextPlayerId = 1;

export class Room {
  constructor(name, bankRef){
    this.name = name;
    this.bank = bankRef || bank;
    this.players = new Map();      // id -> ServerPlayer
    this.phase = PHASE.PLAYING;
    this.countdown = 0;
    this.winnerName = null;
    this.t = 0;
    this.roundCounter = 0;
    this.roundId = null;
    this.killSeq = 0;
    this.fbSeq = 0;
    this.fireballs = [];
    this.paidCount = 0;
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
  potBalance(){ return this.bank.potBalance(this.roundId); }
  sendWallet(p){
    var w = this.bank.wallet(p.account);
    this.send(p.ws, { t: MSG.WALLET, credit: w.credit, earnings: w.earnings, fireballs: this.bank.fireballs(p.account) });
  }

  newRound(){
    this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    var gen = generateMaze(this.seed);
    this.maze = gen.maze;
    this.grid = gen.grid;
    this.dS = gen.dS;
    this.treasureT = gen.treasureT;
    this.startT = gen.startT;
    this.startWX = { x: WX(this.startT.x), z: WX(this.startT.z) };
    this.treasureWX = { x: WX(this.treasureT.x), z: WX(this.treasureT.z) };
    this.eaters = new Eaters(this.maze, this.dS, gen.best, gen.rnd);
    this.phase = PHASE.PLAYING;
    this.winnerName = null;
    this.t = 0;
    this.killSeq = 0;
    this.fireballs = [];                 // live projectiles (populated in commit: fireballs)
    this.roundId = this.name + '#' + (++this.roundCounter);

    // charge the entry fee; those who can't afford spectate this round
    this.paidCount = 0;
    for (var p of this.players.values()){
      p.spawnAt(this.startWX.x, this.startWX.z);
      var res = this.bank.enterRound(p.account, this.roundId);
      p.paid = res.ok;
      if (res.ok) this.paidCount++;
      else this.send(p.ws, { t: MSG.SPECTATE, reason: 'insufficient', fee: ENTRY_FEE });
      this.sendWallet(p);
    }
    this.broadcast(this.roundMsg());
  }

  addPlayer(name, account, ws){
    var pid = nextPlayerId++;
    var p = new ServerPlayer(pid, name, this.players.size, ws, account);
    p.spawnAt(this.startWX.x, this.startWX.z);
    p.paid = false;                      // mid-round joiner: waits for the next paid round
    this.players.set(pid, p);
    this.send(ws, { t: MSG.WELCOME, id: pid, color: p.color, name: p.name });
    this.send(ws, this.roundMsg());
    this.sendWallet(p);
    if (this.phase === PHASE.PLAYING) this.send(ws, { t: MSG.SPECTATE, reason: 'midround' });
    return p;
  }

  removePlayer(id){
    var p = this.players.get(id);
    this.players.delete(id);
    // if the last paid player of a live round leaves, void the round (refund all)
    if (p && p.paid && this.phase === PHASE.PLAYING && !this.anyPaidConnected()){
      this.bank.abortRound(this.roundId);
      this.newRound();
    }
  }
  anyPaidConnected(){ for (var p of this.players.values()) if (p.paid) return true; return false; }

  onInput(p, cmds){
    if (this.phase !== PHASE.PLAYING) return;
    p.applyCommands(this.maze, cmds, Date.now() / 1000);
  }

  // Server-authoritative fireball throw. Origin is the player's *authoritative*
  // position (never a client-claimed one), so shots can't teleport. Validated:
  // must be a paid participant, off cooldown, and have a fireball in inventory.
  throwFireball(p, msg){
    if (this.phase !== PHASE.PLAYING || !p.paid) return;
    if (p.throwCd > 0) return;                                   // cooldown
    var throwId = 'fb:' + p.account + ':' + msg.id;             // idempotent (double-send safe)
    var consumed = this.bank.consumeFireball(p.account, throwId);
    if (!consumed.ok){ this.sendWallet(p); return; }            // no fireballs
    p.throwCd = FIREBALL_COOLDOWN;
    p.flareUntil = this.t + FIREBALL_FLARE;                     // now loud/bright to eaters
    var yaw = +msg.yaw || 0;
    var dirx = -Math.sin(yaw), dirz = -Math.cos(yaw);          // camera-forward (matches movement)
    var fb = { id: ++this.fbSeq, x: p.x, z: p.z, dirx: dirx, dirz: dirz, dist: 0,
               owner: p.id, ownerAccount: p.account, ownerName: p.name };
    this.fireballs.push(fb);
    this.broadcast({ t: MSG.FIREBALL, id: fb.id, x: p.x, z: p.z, dx: dirx, dz: dirz,
                     speed: FIREBALL_SPEED, range: FIREBALL_RANGE, owner: p.id });
    this.sendWallet(p);                                         // inventory changed
  }

  stepFireballs(dt){
    if (!this.fireballs.length) return;
    var alive = [];
    for (var i = 0; i < this.fireballs.length; i++){
      var fb = this.fireballs[i];
      var step = FIREBALL_SPEED * dt;
      var nx = fb.x + fb.dirx * step, nz = fb.z + fb.dirz * step;
      fb.dist += step;
      if (this.maze.solidAt(nx, nz) || fb.dist > FIREBALL_RANGE){  // hit a wall or fizzled out
        this.broadcast({ t: MSG.FIREBALL_END, id: fb.id, x: fb.x, z: fb.z, hit: 0 });
        continue;
      }
      fb.x = nx; fb.z = nz;
      var victim = null;
      for (var pw of this.players.values()){
        if (pw.id === fb.owner || !pw.paid || pw.invuln > 0) continue;   // no self-hit, no eaters, no invuln
        var dx = pw.x - fb.x, dz = pw.z - fb.z;
        if (dx * dx + dz * dz < FIREBALL_HIT_R * FIREBALL_HIT_R){ victim = pw; break; }
      }
      if (victim){
        this.fireballKill(fb, victim);
        this.broadcast({ t: MSG.FIREBALL_END, id: fb.id, x: fb.x, z: fb.z, hit: 1 });
        continue;
      }
      alive.push(fb);
    }
    this.fireballs = alive;
  }

  // one hit kills: normal death flow + PvP kill economy + kill feed
  fireballKill(fb, victim){
    var killer = this.players.get(fb.owner);
    var killId = this.roundId + ':f:' + (++this.killSeq);
    this.bank.killByFireball(victim.account, fb.ownerAccount, this.roundId, killId);
    victim.deaths++;
    victim.spawnAt(this.startWX.x, this.startWX.z);
    this.send(victim.ws, { t: MSG.KILLED, by: 'fireball', byName: fb.ownerName });
    this.sendWallet(victim);
    if (killer) this.sendWallet(killer);
    this.broadcast({ t: MSG.KILLFEED, text: fb.ownerName + ' burned ' + victim.name });
  }

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

  // killed by a Darkness Eater: 50% house / 50% pot (only if the victim paid in)
  kill(pid){
    var p = this.players.get(pid);
    if (!p || p.invuln > 0) return;
    if (p.paid){
      var killId = this.roundId + ':e:' + (++this.killSeq);
      this.bank.killByEater(p.account, this.roundId, killId);
      this.sendWallet(p);
    }
    p.deaths++;
    p.spawnAt(this.startWX.x, this.startWX.z);
    this.send(p.ws, { t: MSG.KILLED, by: 'eater' });
  }

  endRound(winner){
    this.phase = PHASE.COUNTDOWN;
    this.countdown = ROUND_COUNTDOWN;
    this.winnerName = winner ? winner.name : null;

    var pot = this.potBalance(), target = 0, topup = 0;
    if (winner && winner.paid){
      var pay = this.bank.payout(winner.account, this.roundId, this.paidCount);
      target = pay.target; topup = pay.topup;
      this.sendWallet(winner);
    }
    // audit: the round's ledger deltas must net to exactly zero
    var audit = this.bank.auditRound(this.roundId);
    if (audit !== 0) console.error('[AUDIT FAIL] round ' + this.roundId + ' nets ' + audit + ' (should be 0)');

    var summary = [];
    for (var p of this.players.values()) summary.push({ id: p.id, name: p.name, net: this.bank.roundNet(p.account, this.roundId) });

    this.broadcast({
      t: MSG.ROUND_OVER,
      winnerId: winner ? winner.id : 0, winnerName: this.winnerName,
      pot: pot, target: target, topup: topup, paid: this.paidCount,
      bonus: bonusUnlocked(this.paidCount), players: summary
    });
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
      p.throwCd = Math.max(0, p.throwCd - dt);
      arr.push({ id: p.id, x: p.x, z: p.z, invuln: p.invuln, speed: p.speed, flare: (p.flareUntil || 0) > this.t });
    }

    var self = this;
    this.eaters.update(dt, this.t, arr,
      function(pid){ var pp = self.players.get(pid); return pp ? pp.field : null; },
      function(pid){ self.kill(pid); });

    this.stepFireballs(dt);

    // win: first PAID player to the treasure
    for (var pw of this.players.values()){
      if (!pw.paid) continue;
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
      econ: { pot: this.potBalance(), paid: this.paidCount, bonus: bonusUnlocked(this.paidCount), bonusPot: BONUS_POT },
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
