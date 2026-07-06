// Entry is charged on EVERY join and deducted from Credit — EXCEPT rejoining the
// same round you already paid (reconnect/quit-back), which is not re-charged.
// A different round (new session) charges again.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){ return { readyState: 1, send: function(){}, close: function(){} }; }

console.log('— charged on join; NOT re-charged rejoining the same round; charged on a new round');
{
  var bank = new Bank();
  bank.grant('A', 10000, 'gA'); bank.grant('B', 10000, 'gB');
  var room = new Room('t', bank); clearInterval(room.timer);

  var pa = room.addPlayer('A', 'A', mkws());
  eq(bank.wallet('A').credit, 9000, 'A charged the entry on join (10000 -> 9000)');
  ok(pa.paid, 'A is paid');
  var pb = room.addPlayer('B', 'B', mkws());
  eq(bank.wallet('B').credit, 9000, 'B charged on join');
  var round1 = room.roundId;

  // A leaves while B remains -> no refund; A's stake stays for the round-end forfeit
  room.removePlayer(pa.id);
  eq(bank.wallet('A').credit, 9000, 'A not refunded (round continues with B)');

  // A rejoins the SAME round -> idempotent, NOT re-charged
  var pa2 = room.addPlayer('A', 'A', mkws());
  eq(bank.wallet('A').credit, 9000, 'rejoining the SAME round does NOT charge again');
  ok(pa2.paid, 'A keeps their paid status');
  eq(room.roundId, round1, 'still the same round');

  // a NEW round (different session) -> charged again
  room.newRound();
  ok(room.roundId !== round1, 'new round id');
  eq(bank.wallet('A').credit, 8000, 'A charged again for the NEW round');
  eq(bank.wallet('B').credit, 8000, 'B charged again for the NEW round');
}

console.log('— reconnect (displacement-style): remove old + re-add same account, same round = one charge');
{
  var bank = new Bank();
  bank.grant('A', 10000, 'gA'); bank.grant('B', 10000, 'gB');
  var room = new Room('t2', bank); clearInterval(room.timer);
  var pa = room.addPlayer('A', 'A', mkws());
  room.addPlayer('B', 'B', mkws());                 // B keeps the round alive
  eq(bank.wallet('A').credit, 9000, 'A charged once');
  // index.js does addPlayer(new) THEN removePlayer(old) on a reconnect
  var paNew = room.addPlayer('A', 'A', mkws());      // new connection, same round -> idempotent
  room.removePlayer(pa.id);                          // old connection removed
  eq(bank.wallet('A').credit, 9000, 'reconnect within the same round charges only once');
  ok(paNew.paid && room.paidCount === 2, 'A + B are the two paid players (no double count)');
}

console.log('— quitting does NOT refund; the stake forfeits to the pot at round end');
{
  var bank = new Bank();
  bank.grant('A', 10000, 'gA');
  var room = new Room('t3', bank); clearInterval(room.timer);
  var pa = room.addPlayer('A', 'A', mkws());
  eq(bank.wallet('A').credit, 9000, 'charged');
  eq(bank.stakeBalance('A'), 1000, 'staked 1000 (4 lives)');
  room.removePlayer(pa.id);                          // quit -> no refund, stake stays on the account
  eq(bank.wallet('A').credit, 9000, 'quitting does NOT refund the entry');
  eq(bank.stakeBalance('A'), 1000, 'stake still held until round end');
  room.endRound(null);                               // session ends -> A (still an entrant) forfeits to the pot
  eq(bank.stakeBalance('A'), 0, 'leftover stake forfeited to the pot at round end');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity');
}

console.log('— cannot afford -> spectate, NOT charged');
{
  var bank = new Bank();
  bank.grant('P', 500, 'gP');                        // < 1000 entry
  var room = new Room('t4', bank); clearInterval(room.timer);
  var pp = room.addPlayer('POOR', 'P', mkws());
  ok(!pp.paid, 'broke player is a spectator');
  eq(bank.wallet('P').credit, 500, 'nothing deducted from a spectator');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
