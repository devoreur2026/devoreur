// A room: one maze shared by up to MAX_PLAYERS, with the paid-round economy.
// Owns the authoritative truth (maze, treasure, players, eaters) AND drives the
// money flow through the shared Bank: entry fees at round start, the kill
// economy, the pot, the payout on a win, and refunds on abort. All amounts and
// splits come from shared/economy and are enforced by the Bank; the room never
// touches balances directly.
import { generateMaze, WX, TX, id } from '../shared/maze.js';
import {
  TICK_DT, MAX_PLAYERS, WIN_DIST, FIELD_REFRESH, ROUND_COUNTDOWN,
  SPAWN_HEART_FRAC, SPAWN_MIN_PLAYER_DIST,
  FIREBALL_DAMAGE, EATER_DAMAGE, EATER_HIT_INTERVAL,
  KEEPER_COUNT, EATER_ADD_INTERVAL, MAX_EATERS
} from '../shared/config.js';
import {
  BONUS_POT, bonusUnlocked, entryPrice, entriesOpen, ROUND_LIMIT,
  FIREBALL_SPEED, FIREBALL_RANGE, FIREBALL_COOLDOWN, FIREBALL_HIT_R, FIREBALL_FLARE
} from '../shared/economy.js';
import { MSG, PHASE } from '../shared/protocol.js';
import { Eaters } from './eaters.js';
import { ServerPlayer } from './player.js';
import { bank } from './bankInstance.js';
import { randomUUID } from 'crypto';

var nextPlayerId = 1;

export class Room {
  constructor(name, bankRef){
    this.name = name;
    this.bank = bankRef || bank;
    // Unique per room instance -> round ids NEVER collide across server restarts
    // (a fresh process makes a fresh room). Otherwise, with the durable ledger, a
    // reused id (room-1#1) hits stale idempotency keys + a leftover pot balance
    // and corrupts the economy: an entry gets silently skipped as a "duplicate",
    // the pot isn't funded, and it can read wrong / negative.
    this.uid = randomUUID().slice(0, 8);
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
    this.entrants = new Set();     // accounts that staked into the CURRENT round (for the round-end forfeit)
    this.lastTick = Date.now();
    this.newRound();
    this.timer = setInterval(() => this.tick(), TICK_DT * 1000);
  }

  get size(){ return this.players.size; }
  hasRoom(){ return this.players.size < MAX_PLAYERS; }

  gridB64(){ return Buffer.from(this.grid).toString('base64'); }
  roundMsg(){ return { t: MSG.ROUND, seed: this.seed, grid: this.gridB64(), treasure: this.treasureT }; }
  potBalance(){ return this.bank.potBalance(this.roundId); }
  potDisplay(){ return Math.max(0, this.potBalance()); }   // never surface a negative pot
  price(){ return entryPrice(this.t); }
  entriesOpen(){ return this.phase === PHASE.PLAYING && entriesOpen(this.t); }
  roundInfo(){   // for the /api/round join-screen preview
    return { price: this.price(), pot: this.potDisplay(), elapsed: +this.t.toFixed(1),
             limit: ROUND_LIMIT, open: this.entriesOpen(), paid: this.paidCount };
  }
  sendWallet(p){
    var w = this.bank.wallet(p.account);
    this.send(p.ws, { t: MSG.WALLET, credit: w.credit, earnings: w.earnings, fireballs: this.bank.fireballs(p.account) });
  }

  // Randomized spawn: an open cell a safe minimum BFS distance from the Heart
  // and world distance from every active player (the map is public + campable).
  pickSpawn(){
    var minHeart = Math.floor(SPAWN_HEART_FRAC * this.best), fallback = null;
    for (var i = 0; i < 80; i++){
      var cell = this.maze.randOpenCell(this.tField, minHeart, this.best, this.rnd);
      var wx = WX(cell.x), wz = WX(cell.z);
      if (!fallback) fallback = { x: wx, z: wz };
      var ok = true;
      for (var p of this.players.values()){
        if (!p.paid) continue;
        var dx = p.x - wx, dz = p.z - wz;
        if (dx * dx + dz * dz < SPAWN_MIN_PLAYER_DIST * SPAWN_MIN_PLAYER_DIST){ ok = false; break; }
      }
      if (ok) return { x: wx, z: wz };
    }
    return fallback || { x: this.treasureWX.x, z: this.treasureWX.z };
  }
  spawnPlayer(p){
    var s = this.pickSpawn();
    p.spawnAt(s.x, s.z);
    this.send(p.ws, { t: MSG.SPAWN, x: s.x, z: s.z });
  }
  syncLives(p){ p.lives = this.bank.lives(p.account); }   // lives = staked / 250
  active(p){ return p.paid && p.lives > 0; }               // in the hunt: paid AND has lives left

  // Open entry: charge the current rising price and spawn immediately. Can't
  // afford -> ghost (roam, clear price-vs-balance). Entries closed (8:00-10:00
  // or between rounds) -> ghost, auto-entered at the next newRound.
  enterOrSpectate(p){
    if (this.entriesOpen()){
      var res = this.bank.enterRound(p.account, this.roundId, this.price());
      if (res.ok){
        p.paid = true; p.entryPrice = res.price || p.entryPrice || this.price();
        this.paidCount++; this.entrants.add(p.account); this.syncLives(p);
        this.spawnPlayer(p); this.sendWallet(p); return;
      }
      p.paid = false; this.syncLives(p); this.spawnPlayer(p);
      var w = this.bank.wallet(p.account);
      this.send(p.ws, { t: MSG.SPECTATE, reason: 'insufficient', price: this.price(), credit: w.credit });
    } else {
      p.paid = false; this.syncLives(p); this.spawnPlayer(p);
      this.send(p.ws, { t: MSG.SPECTATE, reason: 'locked' });
    }
    this.sendWallet(p);
  }

  // Re-pay when out of lives: buy another life-pack at the current price.
  buyLives(p, msg){
    if (!p.paid || p.lives > 0 || !this.entriesOpen()) return;
    var res = this.bank.buyLives(p.account, this.roundId, this.price(), '' + (msg && msg.nonce));
    if (!res.ok){ this.sendWallet(p); return; }
    this.entrants.add(p.account); this.syncLives(p);
    this.spawnPlayer(p); this.sendWallet(p);
  }

  newRound(){
    this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    var gen = generateMaze(this.seed);
    this.maze = gen.maze;
    this.grid = gen.grid;
    this.dS = gen.dS;
    this.tField = gen.tField;
    this.best = gen.best;
    this.rnd = gen.rnd;
    this.treasureT = gen.treasureT;
    this.treasureWX = { x: WX(this.treasureT.x), z: WX(this.treasureT.z) };
    this.eaters = new Eaters(this.maze, this.dS, gen.best, gen.rnd);
    this.phase = PHASE.PLAYING;
    this.winnerName = null;
    this.t = 0;
    this.killSeq = 0; this.fbSeq = 0; this.fireballs = [];

    var prevRound = this.roundId;
    this.roundId = this.name + '#' + this.uid + '.' + (++this.roundCounter);   // unique across restarts
    this.rolledIn = prevRound ? this.bank.rollover(prevRound, this.roundId) : 0;   // carry an unclaimed pot
    var live = new Set(); for (var lp of this.players.values()) live.add(lp.account);
    this.bank.sweepOrphans(this.roundId, live);      // absorb anything stranded by a restart into this pot

    this.broadcast(this.roundMsg());                 // maze first, then charge + spawn
    this.paidCount = 0;
    this.entrants = new Set();                        // fresh session: lives don't carry
    for (var p of this.players.values()){ p.paid = false; p.entryPrice = 0; p.lives = 0; this.enterOrSpectate(p); }
  }

  addPlayer(name, account, ws){
    var pid = nextPlayerId++;
    var p = new ServerPlayer(pid, name, this.players.size, ws, account);
    this.players.set(pid, p);
    this.send(ws, { t: MSG.WELCOME, id: pid, color: p.color, name: p.name });
    this.send(ws, this.roundMsg());
    this.enterOrSpectate(p);                          // open entry: charge current price + spawn immediately
    return p;
  }

  removePlayer(id){
    var p = this.players.get(id);
    this.players.delete(id);
    if (p && p.paid) this.paidCount = Math.max(0, this.paidCount - 1);
    // NOTE: no refund/abort on leave. Their stake stays on the account and is
    // forfeited to the pot at round end (also keeps reconnects safe — the same
    // account re-enters idempotently and keeps its remaining lives).
  }
  anyPaidConnected(){ for (var p of this.players.values()) if (p.paid) return true; return false; }

  // When a round ends, everyone is returned to the entrance: close every
  // connection and empty the room. A fresh round only fills up as players
  // reconnect and pay in again. (Runs during COUNTDOWN, so removePlayer's
  // last-paid-leaves refund path doesn't fire.)
  kickAll(){
    for (var p of this.players.values()){
      try { if (p.ws) p.ws.close(); } catch (e) {}
    }
    this.players.clear();
    this.paidCount = 0;
  }

  onInput(p, cmds){
    if (this.phase !== PHASE.PLAYING) return;
    p.applyCommands(this.maze, cmds, Date.now() / 1000);
  }

  // Server-authoritative fireball throw. Origin is the player's *authoritative*
  // position (never a client-claimed one), so shots can't teleport. Validated:
  // must be a paid participant, off cooldown, and have a fireball in inventory.
  throwFireball(p, msg){
    if (this.phase !== PHASE.PLAYING || !this.active(p)) return;   // out of lives -> can't throw
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
        if (pw.id === fb.owner || !this.active(pw) || pw.invuln > 0 || pw.health <= 0) continue;   // no self/ghost/out/invuln/dead
        var dx = pw.x - fb.x, dz = pw.z - fb.z;
        if (dx * dx + dz * dz < FIREBALL_HIT_R * FIREBALL_HIT_R){ victim = pw; break; }
      }
      if (victim){
        this.hitByFireball(fb, victim);                 // applies damage; death fires once if it drops to 0
        this.broadcast({ t: MSG.FIREBALL_END, id: fb.id, x: fb.x, z: fb.z, hit: 1 });
        continue;
      }
      alive.push(fb);
    }
    this.fireballs = alive;
  }

  // A fireball landed: credit the attacker (for the killing-blow) and apply
  // damage. Death, if the hit drops health to 0, fires the economy once in die().
  hitByFireball(fb, victim){
    victim.lastAttacker = { account: fb.ownerAccount, name: fb.ownerName, id: fb.owner };
    this.damage(victim, FIREBALL_DAMAGE, 'fireball');
  }

  // Continuous eater contact -> apply EATER_DAMAGE at most once per interval.
  hitByEater(pid){
    var p = this.players.get(pid);
    if (!p || !this.active(p) || p.invuln > 0 || p.health <= 0 || p.eaterHitCd > 0) return;
    p.eaterHitCd = EATER_HIT_INTERVAL;
    this.damage(p, EATER_DAMAGE, 'eater');
  }

  // Apply damage. Ghosts, invulnerable, and already-dead players are immune, so
  // a second hit in the same tick can't re-trigger death. Health is the source
  // of truth (broadcast in snapshots); the client never decides it.
  damage(victim, amount, cause){
    if (!this.active(victim) || victim.invuln > 0 || victim.health <= 0) return;
    victim.health = Math.max(0, victim.health - amount);
    if (victim.health === 0) this.die(victim, cause);
  }

  // Killing blow: economy fires ONCE here (250 penalty + split). spawnPlayer
  // then respawns full + invulnerable, so any same-tick follow-up hit no-ops.
  die(victim, cause){
    victim.deaths++;
    if (cause === 'fireball'){
      var atk = victim.lastAttacker || { account: null, name: 'Someone', id: 0 };
      var killId = this.roundId + ':f:' + (++this.killSeq);
      this.bank.killByFireball(victim.account, atk.account, this.roundId, killId);   // spends 250 stake -> killer/pot
      this.broadcast({ t: MSG.KILLFEED, text: atk.name + ' burned ' + victim.name });
      this.syncLives(victim);
      this.respawnOrOut(victim, 'fireball', atk.name);
      this.sendWallet(victim);
      var killer = this.players.get(atk.id);
      if (killer) this.sendWallet(killer);
    } else {
      var killId2 = this.roundId + ':e:' + (++this.killSeq);
      this.bank.killByEater(victim.account, this.roundId, killId2);                  // spends 250 stake -> house/pot
      this.syncLives(victim);
      this.respawnOrOut(victim, 'eater', null);
      this.sendWallet(victim);
    }
  }

  // A death spent one life. Respawn if lives remain, else the player is OUT (a
  // spectator who can re-pay to buy another life-pack).
  respawnOrOut(victim, by, byName){
    this.spawnPlayer(victim);   // fresh spawn + full health + spawn invuln (also for out-of-lives roaming)
    if (victim.lives > 0){
      this.send(victim.ws, { t: MSG.KILLED, by: by, byName: byName, lives: victim.lives });
    } else {
      this.send(victim.ws, { t: MSG.KILLED, by: by, byName: byName, lives: 0, out: true, price: this.price() });
    }
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

  // winner may be null -> time limit hit, pot rolls into the next round
  endRound(winner){
    this.phase = PHASE.COUNTDOWN;
    this.countdown = ROUND_COUNTDOWN;
    this.winnerName = winner ? winner.name : null;

    // every remaining stake (unused lives) forfeits into the pot before payout,
    // for EVERY account that entered this round (incl. those who disconnected).
    for (var acc of this.entrants) this.bank.forfeitStake(acc, this.roundId);

    var pot = this.potBalance(), target = 0, topup = 0, rolled = 0;
    if (winner && winner.paid){
      var pay = this.bank.payout(winner.account, this.roundId, this.paidCount);
      target = pay.target; topup = pay.topup;
      this.sendWallet(winner);
    } else {
      rolled = pot;                              // unclaimed -> rolls over (transferred at newRound)
    }
    // audit: the round's ledger deltas must net to exactly zero
    var audit = this.bank.auditRound(this.roundId);
    if (audit !== 0) console.error('[AUDIT FAIL] round ' + this.roundId + ' nets ' + audit + ' (should be 0)');

    var summary = [];
    for (var p of this.players.values())
      summary.push({ id: p.id, name: p.name, net: this.bank.roundNet(p.account, this.roundId), entry: p.entryPrice });

    this.broadcast({
      t: MSG.ROUND_OVER,
      winnerId: winner ? winner.id : 0, winnerName: this.winnerName,
      pot: Math.max(0, pot), target: target, topup: topup, rolled: Math.max(0, rolled),
      paid: this.paidCount, bonus: bonusUnlocked(this.paidCount), players: summary
    });
  }

  tick(){
    var now = Date.now();
    var dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    if (this.phase === PHASE.COUNTDOWN){
      this.countdown -= dt;
      if (this.countdown <= 0){ this.kickAll(); this.newRound(); }   // round over -> everyone rejoins
      this.broadcastState();
      return;
    }

    this.t += dt;
    this.refreshFields(dt);

    // escalate the hunt: a new eater joins every EATER_ADD_INTERVAL (5 min)
    var wantEaters = Math.min(MAX_EATERS, KEEPER_COUNT + Math.floor(this.t / EATER_ADD_INTERVAL));
    while (this.eaters.count < wantEaters) this.eaters.addEater();

    var arr = [];
    for (var p of this.players.values()){
      p.invuln = Math.max(0, p.invuln - dt);
      p.throwCd = Math.max(0, p.throwCd - dt);
      p.eaterHitCd = Math.max(0, p.eaterHitCd - dt);
      arr.push({ id: p.id, x: p.x, z: p.z, invuln: p.invuln, speed: p.speed, paid: this.active(p), flare: (p.flareUntil || 0) > this.t });
    }

    var self = this;
    this.eaters.update(dt, this.t, arr,
      function(pid){ var pp = self.players.get(pid); return pp ? pp.field : null; },
      function(pid){ self.hitByEater(pid); });

    this.stepFireballs(dt);

    // win: first PAID player to the treasure
    var won = false;
    for (var pw of this.players.values()){
      if (!this.active(pw)) continue;                            // out of lives -> can't claim the Heart
      var dx = this.treasureWX.x - pw.x, dz = this.treasureWX.z - pw.z;
      if (Math.sqrt(dx * dx + dz * dz) < WIN_DIST){ this.endRound(pw); won = true; break; }
    }
    // 10-minute limit reached with no winner -> end + roll the pot over
    if (!won && this.t >= ROUND_LIMIT) this.endRound(null);

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
      econ: {
        pot: this.potDisplay(), paid: this.paidCount,
        bonus: bonusUnlocked(this.paidCount), bonusPot: BONUS_POT,
        price: this.price(), elapsed: +this.t.toFixed(1), limit: ROUND_LIMIT, open: this.entriesOpen()
      },
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
