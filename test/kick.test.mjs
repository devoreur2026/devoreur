// When a round ends, EVERYONE is kicked out; a fresh (empty) round starts and
// players must rejoin. Drives the Room directly with an injected Bank.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { PHASE } from '../shared/protocol.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){
  var msgs = [];
  return { readyState: 1, closed: false, send: function(s){ msgs.push(JSON.parse(s)); },
           close: function(){ this.closed = true; this.readyState = 3; }, msgs: msgs,
           last: function(t){ for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].t === t) return msgs[i]; return null; } };
}

console.log('— a win ends the round; countdown expiry kicks everyone + starts a fresh round');
{
  var bank = new Bank();
  var room = new Room('k', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA'); bank.grant('B', 5000, 'gB');
  var wa = mkws(), wb = mkws();
  var A = room.addPlayer('ALICE', 'A', wa);
  var B = room.addPlayer('BOB', 'B', wb);
  eq(room.players.size, 2, 'two players in the round');
  var wonRound = room.roundId;

  room.endRound(A);                                   // ALICE reaches the Heart
  eq(room.phase, PHASE.COUNTDOWN, 'round over -> countdown');
  ok(wa.last('roundOver'), 'summary broadcast');
  ok(!wa.closed && !wb.closed, 'nobody kicked yet (summary is showing)');

  // force the countdown to expire -> kickAll + newRound
  room.countdown = 0.05; room.lastTick = Date.now() - 1000;
  room.tick();

  ok(wa.closed && wb.closed, 'BOTH connections closed (everyone returned to the entrance)');
  eq(room.players.size, 0, 'room emptied — a fresh round waits for players to rejoin');
  eq(room.paidCount, 0, 'fresh round has no paid players');
  eq(room.phase, PHASE.PLAYING, 'a brand-new round is live');
  ok(room.roundId !== wonRound, 'it is a different round');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity intact through the kick');
}

console.log('— the same happens on a time-limit expiry (no winner); pot still rolls over');
{
  var bank = new Bank();
  var room = new Room('k2', bank); clearInterval(room.timer);
  bank.grant('A', 5000, 'gA');
  var A = room.addPlayer('A', 'A', mkws());
  var r1 = room.roundId;
  eq(room.potBalance(), 700, 'pot from the single entry');

  room.endRound(null);                                // Heart unclaimed at the limit
  room.countdown = 0.05; room.lastTick = Date.now() - 1000;
  room.tick();                                        // kickAll + newRound (rolls the pot over)

  eq(room.players.size, 0, 'everyone kicked on expiry too');
  eq(room.rolledIn, 700, 'the unclaimed pot rolled into the fresh round');
  eq(room.potBalance(), 700, 'fresh round starts with the rolled-over pot');
  eq(bank.auditRound(r1), 0, 'the expired round still audits to zero');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
