// Round ids must be unique across server restarts, or (with the durable ledger)
// a reused id collides with stale idempotency keys + a leftover pot balance and
// corrupts the economy — the cause of a negative pot.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function mkws(){ return { readyState: 1, send: function(){}, close: function(){} }; }

console.log('— round ids differ across a "restart"; the reused round still funds its pot');
{
  var bank = new Bank();
  bank.grant('P', 1000000, 'gP');            // persists in the shared ledger

  var a = new Room('room-1', bank); clearInterval(a.timer);
  a.addPlayer('P', 'P', mkws());             // enters a's round -> charged (staked)
  eq(bank.stakeBalance('P'), 1000, 'round A entry charged (staked 1000)');
  var idA = a.roundId;

  // simulate a restart: a NEW room, same name, SAME bank (the ledger survived).
  var b = new Room('room-1', bank); clearInterval(b.timer);
  ok(b.roundId !== idA, 'round id differs across restart (no collision): ' + idA + ' vs ' + b.roundId);

  b.addPlayer('P', 'P', mkws());             // different round id -> NOT idempotent -> charges again
  eq(bank.stakeBalance('P'), 2000, 'round B entry also charged — NOT idempotent-skipped as a duplicate');
  ok(b.potBalance() >= 0, 'pot is never negative');
  ok(bank.ledger.verifyIntegrity(), 'ledger integrity holds');
}

console.log('— potDisplay never shows a negative even if an account is corrupted');
{
  var bank = new Bank();
  var room = new Room('room-9', bank); clearInterval(room.timer);
  // force a legacy-style negative directly on the ledger balance (mint may go negative)
  var potKey = 'pot:' + room.roundId + '|credit';
  bank.ledger.bal.set(potKey, -950);
  eq(room.potBalance(), -950, 'raw balance can be inspected');
  eq(room.potDisplay(), 0, 'the displayed pot is clamped to 0 (never negative to players)');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
