// Health & damage thresholds: full on spawn/respawn/new-round, no regen, and
// exact hit counts to kill. Run via npm test.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { MAX_HEALTH, FIREBALL_DAMAGE, EATER_DAMAGE } from '../shared/config.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){ var msgs = []; return { readyState: 1, send: function(s){ msgs.push(JSON.parse(s)); }, msgs: msgs,
  last: function(t){ for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].t === t) return msgs[i]; return null; } }; }
function fresh(){
  var bank = new Bank();
  var room = new Room('h', bank); clearInterval(room.timer);
  bank.grant('A', 20000, 'gA'); bank.grant('B', 20000, 'gB');
  var A = room.addPlayer('ALICE', 'A', mkws());
  var B = room.addPlayer('BOB', 'B', mkws());
  B.invuln = 0;
  return { bank: bank, room: room, A: A, B: B, fb: { owner: A.id, ownerAccount: 'A', ownerName: 'ALICE' } };
}

console.log('— full health on spawn + carried in the snapshot');
{
  var g = fresh();
  eq(g.B.health, MAX_HEALTH, 'full health on spawn');
  eq(g.B.snapshot().hp, MAX_HEALTH, 'health is in the snapshot');
}

console.log('— fireball threshold: exactly 3 hits kill');
{
  var g = fresh();
  g.room.hitByFireball(g.fb, g.B);
  eq(g.B.health, MAX_HEALTH - FIREBALL_DAMAGE, 'hit 1 -> -1/3');
  eq(g.B.deaths, 0, 'alive after 1');
  g.room.hitByFireball(g.fb, g.B);
  eq(g.B.deaths, 0, 'alive after 2');
  g.room.hitByFireball(g.fb, g.B);
  eq(g.B.deaths, 1, 'dead after 3');
  eq(g.B.health, MAX_HEALTH, 'respawn restores full health');
}

console.log('— eater threshold: exactly 2 contacts kill; contact cooldown prevents stacking');
{
  var g = fresh();
  g.room.hitByEater(g.B.id);
  eq(g.B.health, MAX_HEALTH - EATER_DAMAGE, 'contact 1 -> -1/2');
  g.room.hitByEater(g.B.id);                          // within cooldown -> ignored
  eq(g.B.health, MAX_HEALTH - EATER_DAMAGE, 'contact within cooldown does not stack');
  eq(g.B.deaths, 0, 'still alive');
  g.B.eaterHitCd = 0;
  g.room.hitByEater(g.B.id);                          // 2nd real contact -> kill
  eq(g.B.deaths, 1, 'dead after 2 spaced contacts');
  eq(g.B.health, MAX_HEALTH, 'respawn restores full health');
}

console.log('— no regeneration: damage persists across ticks');
{
  var g = fresh();
  g.room.eaters.update = function(){};               // isolate: no eater damage during ticks
  g.room.hitByFireball(g.fb, g.B);
  var h = g.B.health;
  ok(h < MAX_HEALTH, 'wounded');
  for (var i = 0; i < 12; i++) g.room.tick();
  eq(g.B.health, h, 'health does not recover over time');
}

console.log('— reset to full on a new round');
{
  var g = fresh();
  g.room.hitByFireball(g.fb, g.B);
  ok(g.B.health < MAX_HEALTH, 'wounded mid-round');
  g.room.newRound();
  eq(g.B.health, MAX_HEALTH, 'full health at the start of the next round');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
