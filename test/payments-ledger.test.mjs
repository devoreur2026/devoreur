// Payment ledger flows: deposit credits once, withdrawal hold/complete/release,
// mutual exclusion, and the whole ledger still nets to zero.
import { Bank } from '../server/bank.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function throws(fn, m){ try { fn(); ok(false, m + ' (did not throw)'); } catch (e) { ok(true, m); } }
// every transaction is balanced, so the sum of ALL row deltas must be exactly 0
function totalZero(bank){ var s = 0, r = bank.ledger.rows; for (var i = 0; i < r.length; i++) s += r[i].amount; return s === 0; }

console.log('— deposit credits Credit exactly once (idempotent on order_id)');
{
  var b = new Bank();
  var r = b.creditDeposit('A', 1000, 'dep_x1');
  ok(r.ok, 'deposit ok');
  eq(b.wallet('A').credit, 1000, 'credited 1000');
  eq(b.gatewayBalance(), -1000, 'gateway went negative (real money in)');
  b.creditDeposit('A', 1000, 'dep_x1');                 // retried callback
  eq(b.wallet('A').credit, 1000, 'duplicate callback does NOT double-credit');
  ok(b.ledger.verifyIntegrity() && totalZero(b), 'integrity + total zero');
}

console.log('— withdrawal: hold immediately, then complete on success');
{
  var b = new Bank();
  b.creditDeposit('A', 0, 'seed');                      // no-op-ish; give A earnings via a kill instead
  // give A earnings
  b.ledger.post('seedwin', [
    { account: 'mint', bucket: 'earnings', amount: -8000, type: 'seed' },
    { account: 'A', bucket: 'earnings', amount: 8000, type: 'seed' }
  ], { counterparty: 'mint' });
  eq(b.wallet('A').earnings, 8000, 'A has 8000 earnings');

  var h = b.holdWithdrawal('A', 5000, 'wd_1');
  ok(h.ok, 'hold ok');
  eq(b.wallet('A').earnings, 3000, 'earnings reduced immediately (double-spend safe)');
  eq(b.held('A'), 5000, 'amount is held');
  b.holdWithdrawal('A', 5000, 'wd_1');                  // retry
  eq(b.held('A'), 5000, 'hold is idempotent');

  b.completeWithdrawal('A', 5000, 'wd_1');
  eq(b.held('A'), 0, 'hold released to the gateway on success');
  eq(b.wallet('A').earnings, 3000, 'earnings unchanged on completion');
  eq(b.gatewayBalance(), 5000, 'money left via the gateway');
  b.completeWithdrawal('A', 5000, 'wd_1');              // retry
  eq(b.gatewayBalance(), 5000, 'completion is idempotent');
  ok(b.ledger.verifyIntegrity() && totalZero(b), 'integrity + total zero');
}

console.log('— withdrawal failure releases the hold back to Earnings');
{
  var b = new Bank();
  b.ledger.post('seed', [
    { account: 'mint', bucket: 'earnings', amount: -8000, type: 'seed' },
    { account: 'A', bucket: 'earnings', amount: 8000, type: 'seed' }
  ], {});
  b.holdWithdrawal('A', 5000, 'wd_2');
  eq(b.wallet('A').earnings, 3000, 'held');
  b.releaseWithdrawal('A', 5000, 'wd_2');
  eq(b.wallet('A').earnings, 8000, 'earnings fully restored on failure/cancel');
  eq(b.held('A'), 0, 'nothing left held');
  b.releaseWithdrawal('A', 5000, 'wd_2');               // retry
  eq(b.wallet('A').earnings, 8000, 'release is idempotent');
  ok(b.ledger.verifyIntegrity() && totalZero(b), 'integrity + total zero');
}

console.log('— a withdrawal cannot both complete AND release (ledger floor backstop)');
{
  var b = new Bank();
  b.ledger.post('seed', [
    { account: 'mint', bucket: 'earnings', amount: -5000, type: 'seed' },
    { account: 'A', bucket: 'earnings', amount: 5000, type: 'seed' }
  ], {});
  b.holdWithdrawal('A', 5000, 'wd_3');
  b.completeWithdrawal('A', 5000, 'wd_3');              // hold -> 0
  throws(function(){ b.releaseWithdrawal('A', 5000, 'wd_3'); }, 'release after complete throws (hold would go negative)');
  eq(b.held('A'), 0, 'hold stays 0');
  ok(b.ledger.verifyIntegrity(), 'integrity intact after the rejected op');
}

console.log('— cannot hold more than Earnings');
{
  var b = new Bank();
  b.ledger.post('seed', [
    { account: 'mint', bucket: 'earnings', amount: -3000, type: 'seed' },
    { account: 'A', bucket: 'earnings', amount: 3000, type: 'seed' }
  ], {});
  var r = b.holdWithdrawal('A', 5000, 'wd_4');
  ok(!r.ok && r.reason === 'insufficient', 'hold rejected when earnings < amount');
  eq(b.wallet('A').earnings, 3000, 'nothing moved');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
