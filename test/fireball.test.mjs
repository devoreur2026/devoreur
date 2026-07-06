// Server-authoritative fireball combat + PvP kill economy. Run via npm test.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { WX } from '../shared/maze.js';
import { FIREBALL_HIT_R } from '../shared/economy.js';
import { MAX_HEALTH, FIREBALL_DAMAGE, EATER_DAMAGE } from '../shared/config.js';

// a guaranteed-open cell + world position for placing test players/projectiles
var CELL = { x: 1, z: 1 };            // the maze is always carved from (1,1)
function cellWX(){ return { x: WX(CELL.x), z: WX(CELL.z) }; }

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){ var msgs = []; return { readyState: 1, send: function(s){ msgs.push(JSON.parse(s)); }, msgs: msgs,
  last: function(t){ for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].t === t) return msgs[i]; return null; } }; }

console.log('— fireball validation (inventory, cooldown, paid)');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA');
  var A = room.addPlayer('ALICE', 'A', mkws());
  bank.buyFireballs('A', 1, 'buy1');                // 10 fireballs
  eq(bank.fireballs('A'), 10, 'bought a pack of 10');

  room.throwFireball(A, { id: 'x1', yaw: 0 });
  eq(bank.fireballs('A'), 9, 'throw consumes one fireball');
  eq(room.fireballs.length, 1, 'projectile created');
  room.throwFireball(A, { id: 'x2', yaw: 0 });
  eq(bank.fireballs('A'), 9, 'cooldown blocks a second throw');
  room.throwFireball(A, { id: 'x1', yaw: 0 });      // idempotent (same id)
  eq(bank.fireballs('A'), 9, 'same throw id does not double-consume');

  A.throwCd = 0;
  A.paid = false;
  room.throwFireball(A, { id: 'x3', yaw: 0 });
  eq(bank.fireballs('A'), 9, 'spectators cannot throw');
}

console.log('— fireball hit damages (not instant kill); 3rd hit kills; economy fires ONCE');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var wa = mkws(), wb = mkws();
  var A = room.addPlayer('ALICE', 'A', wa);
  var B = room.addPlayer('BOB', 'B', wb);
  bank.buyFireballs('A', 1, 'buy1');

  // aim down an OPEN corridor from a known open cell, place BOB just ahead
  var s = CELL, sw = cellWX(), dir;
  if (!room.maze.isWall(s.x + 1, s.z)) dir = { x: 1, z: 0 };
  else if (!room.maze.isWall(s.x - 1, s.z)) dir = { x: -1, z: 0 };
  else if (!room.maze.isWall(s.x, s.z + 1)) dir = { x: 0, z: 1 };
  else dir = { x: 0, z: -1 };
  A.x = sw.x; A.z = sw.z;
  B.x = sw.x + dir.x * 1.6; B.z = sw.z + dir.z * 1.6; B.invuln = 0;

  // ONE real projectile: it damages BOB (1/3), does NOT kill, no economy yet
  room.fireballs.push({ id: 1, x: A.x, z: A.z, dirx: dir.x, dirz: dir.z, dist: 0,
                        owner: A.id, ownerAccount: 'A', ownerName: 'ALICE' });
  for (var i = 0; i < 6 && room.fireballs.length; i++) room.stepFireballs(0.05);
  eq(room.fireballs.length, 0, 'projectile consumed on hit');
  eq(B.health, MAX_HEALTH - FIREBALL_DAMAGE, 'fireball deals 1/3 damage, not instant death');
  eq(B.deaths, 0, 'not dead after one hit');
  eq(bank.wallet('B').credit, 4000, 'no penalty on a non-lethal hit');
  ok(B.lastAttacker && B.lastAttacker.account === 'A', 'last attacker tracked for kill credit');

  // two more hits: dies on the 3rd, economy fires exactly once
  var fb = { owner: A.id, ownerAccount: 'A', ownerName: 'ALICE' };
  room.hitByFireball(fb, B);                        // 2nd hit
  eq(B.deaths, 0, 'still alive after 2 hits');
  room.hitByFireball(fb, B);                        // 3rd hit -> death
  eq(B.deaths, 1, 'dies on the 3rd hit');
  eq(B.health, MAX_HEALTH, 'respawn restores full health');
  var killed = wb.last('killed');
  ok(killed && killed.by === 'fireball' && killed.byName === 'ALICE', 'victim told ALICE burned them');
  eq(bank.wallet('B').credit, 3750, 'victim -250 Credit ONCE (killing blow only)');
  eq(bank.wallet('A').earnings, 175, 'killer +70% (175) once');
  eq(room.potBalance(), 1400 + 75, 'pot +30% (75) once');
  ok(wa.last('killfeed').text === 'ALICE burned BOB', 'kill feed on death');
  eq(bank.auditRound(room.roundId), 0, 'round audit still nets to zero');
}

console.log('— two fireballs in the SAME tick kill once (no double 250 / double payout)');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var A = room.addPlayer('ALICE', 'A', mkws());
  var B = room.addPlayer('BOB', 'B', mkws());
  B.invuln = 0; B.health = FIREBALL_DAMAGE;         // one hit from death
  var creditBefore = bank.wallet('B').credit;
  var earnBefore = bank.wallet('A').earnings;
  var potBefore = room.potBalance();
  var fb = { owner: A.id, ownerAccount: 'A', ownerName: 'ALICE' };
  room.hitByFireball(fb, B);                        // kills
  room.hitByFireball(fb, B);                        // same tick, B now respawned+invulnerable -> no-op
  eq(B.deaths, 1, 'died exactly once');
  eq(bank.wallet('B').credit, creditBefore - 250, 'penalty charged once (not 500)');
  eq(bank.wallet('A').earnings, earnBefore + 175, 'killer credited once (not 350)');
  eq(room.potBalance(), potBefore + 75, 'pot grew once (not 150)');
  eq(bank.auditRound(room.roundId), 0, 'audit still nets to zero');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity holds');
}

console.log('— damage while a ghost (unpaid) is ignored');
{
  var bank = new Bank();
  var room = new Room('t', bank); clearInterval(room.timer);
  bank.grant('G', 100, 'gG');                       // can't afford -> ghost
  var G = room.addPlayer('GHOST', 'G', mkws());
  ok(!G.paid, 'ghost is not paid');
  var hpBefore = G.health, deathsBefore = G.deaths;
  G.invuln = 0;
  room.damage(G, EATER_DAMAGE, 'eater');
  room.hitByFireball({ owner: 99, ownerAccount: 'X', ownerName: 'X' }, G);
  eq(G.health, hpBefore, 'ghost takes no damage');
  eq(G.deaths, deathsBefore, 'ghost cannot die');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
