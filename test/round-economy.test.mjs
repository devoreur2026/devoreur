// Integration tests for the OPEN-MAZE round economy: open entry, rising price,
// randomized spawns, entry lockout, and pot rollover. Drives the Room class
// directly with an injected fresh Bank (no sockets/auth). Run via npm test.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { WX, TX, id as cellId } from '../shared/maze.js';
import { ENTRY_BASE, ENTRY_PER_MINUTE, ENTRY_CLOSE, BONUS_POT, entryPrice } from '../shared/economy.js';
import { SPAWN_MIN_PLAYER_DIST, SPAWN_HEART_FRAC, MAX_HEALTH, EATER_DAMAGE } from '../shared/config.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){
  var msgs = [];
  return { readyState: 1, send: function(s){ msgs.push(JSON.parse(s)); }, msgs: msgs,
           last: function(t){ for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].t === t) return msgs[i]; return null; } };
}

console.log('— open entry: funded players enter on join; pot / eater-kill / payout');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var wa = mkws(), wb = mkws();
  var A = room.addPlayer('ALICE', 'A', wa);
  var B = room.addPlayer('BOB', 'B', wb);
  ok(A.paid && B.paid, 'both enter immediately on join (open entry)');
  eq(room.paidCount, 2, 'paidCount = 2');
  eq(room.potBalance(), 0, 'pot starts empty — entries are staked, not pooled');
  eq(bank.stakeBalance('A'), 1000, "A's 1000 is held as stake (4 lives)");
  eq(A.lives, 4, 'A shows 4 lives');
  eq(bank.wallet('A').credit, 4000, 'A charged the base price (1000)');
  ok(wa.last('spawn') && typeof wa.last('spawn').x === 'number', 'server sent A a spawn point');

  B.invuln = 0;
  room.hitByEater(B.id);                            // hit 1: half damage, no death/life lost
  eq(B.health, MAX_HEALTH - EATER_DAMAGE, 'eater contact takes half health');
  eq(B.lives, 4, 'no life lost on a non-lethal eater hit');
  B.eaterHitCd = 0;                                 // (in-game the contact cooldown spaces these)
  room.hitByEater(B.id);                            // hit 2: killing blow -> spends a life
  eq(bank.wallet('B').credit, 4000, 'Credit untouched — the stake pays for the death');
  eq(bank.stakeBalance('B'), 750, 'eater death spends 250 stake ONCE');
  eq(B.lives, 3, 'B down to 3 lives');
  eq(room.potBalance(), 125, 'pot += 125 (eater 50/50)');
  ok(wb.last('spawn'), 'respawn sends a fresh spawn point');
  eq(B.health, MAX_HEALTH, 'respawn restores full health');

  room.endRound(A);                                 // A wins: forfeit half of A(1000) + B(750) -> pot, then payout
  eq(bank.wallet('A').earnings, BONUS_POT, 'winner gets the guaranteed bonus (pot < 15000)');
  var ro = wa.last('roundOver');
  eq(ro.pot, 125 + 500 + 375, 'summary pot = eater share + half of each forfeited stake (1000)');
  eq(ro.target, BONUS_POT, 'payout is the bonus floor'); eq(ro.rolled, 0, 'nothing rolls over on a win');
  ok(ro.players.every(function(p){ return typeof p.entry === 'number'; }), 'summary lists each entry price');
  eq(bank.auditRound(room.roundId), 0, 'round audit nets to zero');
}

console.log('— flat price for a mid-round late join (no late-comer penalty)');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('L', 5000, 'gL');
  room.addPlayer('A', 'A', mkws());
  room.t = 1800;                                   // 30:00 into the round
  var wl = mkws();
  var L = room.addPlayer('LATE', 'L', wl);
  ok(L.paid, 'late joiner still enters (open maze, any time)');
  eq(L.entryPrice, ENTRY_BASE, 'charged the same flat 1000');
  eq(L.lives, 4, 'still 4 lives');
  eq(bank.wallet('L').credit, 5000 - ENTRY_BASE, 'debited the flat 1000');
}

console.log('— broke at the door = ghost (price vs balance shown)');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('P', 500, 'gP');                       // < 1000
  var wp = mkws();
  var P = room.addPlayer('POOR', 'P', wp);
  ok(!P.paid, 'broke player is a ghost, not paid');
  eq(room.paidCount, 0, 'not counted as paid');
  var sp = wp.last('spectate');
  ok(sp && sp.reason === 'insufficient' && sp.price === ENTRY_BASE && sp.credit === 500, 'told price vs balance');
  ok(wp.last('spawn'), 'ghost still gets a spawn to roam');
}

console.log('— entries stay open the whole session; only close at the round limit');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('X', 5000, 'gX');
  room.addPlayer('A', 'A', mkws());
  room.t = ENTRY_CLOSE + 5;                         // past the 1-hour limit — the only time entries are closed
  ok(!room.entriesOpen(), 'entries closed only at/after the session limit');
  var wx = mkws();
  var X = room.addPlayer('X', 'X', wx);
  ok(!X.paid, 'arrival during lockout is a ghost');
  ok(wx.last('spectate').reason === 'locked', 'told the lockout');
  eq(bank.wallet('X').credit, 5000, 'not charged during lockout');
}

console.log('— guaranteed bonus top-up (always on, any player count)');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  var ids = ['A', 'B', 'C'];                          // only 3 — bonus still applies
  ids.forEach(function(a){ bank.grant(a, 5000, 'g' + a); });
  var ws = {}; ids.forEach(function(a){ ws[a] = mkws(); });
  var players = {};
  ids.forEach(function(a){ players[a] = room.addPlayer(a, a, ws[a]); });
  eq(room.paidCount, 3, 'three paid players');
  var houseBefore = bank.houseBalance();
  room.endRound(players['A']);                       // forfeit 3 stakes: 1500 -> pot, 1500 -> house, then payout
  eq(bank.wallet('A').earnings, BONUS_POT, 'winner guaranteed 15000 with only 3 players');
  var ro = ws['A'].last('roundOver');
  eq(ro.topup, BONUS_POT - 1500, 'house tops up the gap over the pot (half of 3 stakes)'); ok(ro.bonus, 'bonus always flagged');
  eq(bank.houseBalance(), houseBefore + 1500 - ro.topup, 'house nets its forfeit share minus the top-up');
  eq(bank.auditRound(room.roundId), 0, 'audit zero');
}

console.log('— time-limit rollover: pot carries into the next round, audits stay zero');
{
  var bank = new Bank();
  var room = new Room('t3', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  room.addPlayer('A', 'A', mkws());
  room.addPlayer('B', 'B', mkws());
  var r1 = room.roundId;
  eq(room.potBalance(), 0, 'r1 pot empty until the round-end forfeit');

  room.endRound(null);                              // time limit hit, no winner -> forfeit half of each stake to pot
  room.newRound();                                  // rolls r1 pot into r2 + re-charges present players
  var r2 = room.roundId;
  eq(room.rolledIn, 1000, 'r1 pot (half of 2 forfeited stakes) rolled into r2');
  eq(room.potBalance(), 1000, 'r2 pot = rolled-over pot (re-entries are staked, not pooled)');
  eq(bank.auditRound(r1), 0, 'expired round r1 audits to zero');
  eq(bank.auditRound(r2), 0, 'r2 (rollover + entries) audits to zero');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity holds through rollover');
}

console.log('— randomized spawns: far from the Heart and from other players');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var A = room.addPlayer('A', 'A', mkws());
  var B = room.addPlayer('B', 'B', mkws());
  var apart = Math.hypot(A.x - B.x, A.z - B.z);
  ok(apart >= SPAWN_MIN_PLAYER_DIST, 'players spawn >= min distance apart (got ' + apart.toFixed(1) + ')');
  var minHeart = Math.floor(SPAWN_HEART_FRAC * room.best);
  var aHeart = room.tField[cellId(TX(A.x), TX(A.z))];
  var bHeart = room.tField[cellId(TX(B.x), TX(B.z))];
  ok(aHeart >= minHeart && bHeart >= minHeart, 'both spawn a safe BFS distance from the Heart');
}

console.log('— leaving does not refund; stakes forfeit to the pot at round end');
{
  var bank = new Bank();
  var room = new Room('t2', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var A = room.addPlayer('A', 'A', mkws());
  var B = room.addPlayer('B', 'B', mkws());
  var round = room.roundId;
  room.removePlayer(A.id);
  eq(bank.wallet('A').credit, 4000, 'no refund on leaving');
  eq(bank.stakeBalance('A'), 1000, "A's stake stays for the round-end forfeit");
  room.removePlayer(B.id);
  eq(bank.wallet('B').credit, 4000, 'B not refunded either');
  room.endRound(null);                              // session ends -> both entrants forfeit
  eq(bank.stakeBalance('A'), 0, 'A stake forfeited');
  eq(bank.stakeBalance('B'), 0, 'B stake forfeited');
  eq(bank.potBalance(round), 1000, 'half of both stakes went into the pot');
  eq(bank.auditRound(round), 0, 'round nets to zero');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
