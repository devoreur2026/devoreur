// Server-authoritative fireball combat + PvP kill economy. Run via npm test.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { WX } from '../shared/maze.js';
import { FIREBALL_HIT_R } from '../shared/economy.js';

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

console.log('— fireball hit -> kill + PvP economy + kill feed');
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

  // push a projectile heading at BOB (bypasses aim; combat sim is what we test)
  room.fireballs.push({ id: 1, x: A.x, z: A.z, dirx: dir.x, dirz: dir.z, dist: 0,
                        owner: A.id, ownerAccount: 'A', ownerName: 'ALICE' });
  for (var i = 0; i < 6 && room.fireballs.length; i++) room.stepFireballs(0.05);

  eq(room.fireballs.length, 0, 'projectile consumed on hit');
  eq(B.deaths, 1, 'victim died');
  var killed = wb.last('killed');
  ok(killed && killed.by === 'fireball' && killed.byName === 'ALICE', 'victim told ALICE burned them');
  eq(bank.wallet('B').credit, 3750, 'victim -250 Credit');
  eq(bank.wallet('A').earnings, 175, 'killer +70% to Earnings (175)');
  eq(room.potBalance(), 1400 + 75, 'pot +30% (75)');
  var feed = wa.last('killfeed');
  ok(feed && feed.text === 'ALICE burned BOB', 'kill feed: "ALICE burned BOB"');
  eq(bank.auditRound(room.roundId), 0, 'round audit still nets to zero');

  // a projectile into a wall / open air just fizzles (no infinite flight)
  room.fireballs.push({ id: 2, x: sw.x, z: sw.z, dirx: -dir.x, dirz: -dir.z, dist: 0, owner: A.id, ownerAccount: 'A', ownerName: 'ALICE' });
  var before = B.deaths;
  for (var j = 0; j < 30 && room.fireballs.length; j++) room.stepFireballs(0.05);
  eq(room.fireballs.length, 0, 'projectile expires (wall or range), no infinite flight');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
