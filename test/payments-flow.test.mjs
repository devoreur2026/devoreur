// End-to-end payment flows with a mocked gateway: simulator happy path, callback
// verification (valid/tampered/duplicate), withdrawal complete/release/in-transit,
// reconciliation, daily cap, and the gates. Ledger must still net to zero.
import { Bank } from '../server/bank.js';
import { PaymentStore } from '../server/paymentStore.js';
import { Payments } from '../server/payments.js';
import { withSignature } from '../server/unipesa/sign.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }
function totalZero(bank){ var s = 0, r = bank.ledger.rows; for (var i = 0; i < r.length; i++) s += r[i].amount; return s === 0; }

var SECRET = 'unipesa-test-secret';
// mock client: each method shifts the next queued response ({data}) or throws if 'THROW'
function mockClient(){
  var q = { deposit: [], withdraw: [], status: [] };
  function make(name){ return function(){ var n = q[name].shift(); if (n === 'THROW') throw new Error('network'); return Promise.resolve(n || { httpStatus: 200, data: { status: 1 } }); }; }
  return { deposit: make('deposit'), withdraw: make('withdraw'), status: make('status'), q: q };
}
function ctx(overrides){
  var bank = new Bank(), store = new PaymentStore(), client = mockClient();
  var cfg = Object.assign({ ready: true, secret: SECRET, depositMin: 1000, withdrawMin: 5000, withdrawDailyCap: 200000, publicId: 'pid', merchantId: 'mid', base: 'https://x/api' }, overrides || {});
  var pay = new Payments({ bank: bank, store: store, client: client, config: cfg });
  return { bank: bank, store: store, client: client, cfg: cfg, pay: pay };
}
function seedEarnings(bank, account, amt){
  bank.ledger.post('seed:' + account + ':' + amt, [
    { account: 'mint', bucket: 'earnings', amount: -amt, type: 'seed' },
    { account: account, bucket: 'earnings', amount: amt, type: 'seed' }
  ], {});
}

console.log('— gates: disabled + attestation required');
{
  var c = ctx({ ready: false });
  var r = await c.pay.startDeposit('A', { amount: 1000, provider: 'vodacom', phone: '0810000000' });
  eq(r.reason, 'payments_disabled', 'off when not ready');
  var c2 = ctx();
  var r2 = await c2.pay.startDeposit('A', { amount: 1000, provider: 'vodacom', phone: '0810000000' });
  eq(r2.reason, 'attestation_required', 'blocked without 18+/terms attestation');
}

console.log('— deposit happy path (direct-response success, no callback)');
{
  var c = ctx();
  c.store.setCompliance('A', '1');
  c.client.q.deposit.push({ data: { provider_result: { code: -8888 }, status: 2 } });   // direct-response success
  var r = await c.pay.startDeposit('A', { amount: 2000, provider: 'vodacom', phone: '0810000000' });
  ok(r.ok, 'deposit accepted');
  eq(c.bank.wallet('A').credit, 2000, 'Credit added exactly once');
  eq(c.store.get(r.order_id).status, 2, 'record marked success');
  ok(c.store.get(r.order_id).settled, 'settled');
  // a stray duplicate callback for an already-settled order must not double-credit
  c.pay.handleCallback(withSignature({ order_id: r.order_id, status: 2 }, SECRET));
  eq(c.bank.wallet('A').credit, 2000, 'duplicate delivery does not double-credit');
  ok(c.bank.ledger.verifyIntegrity() && totalZero(c.bank), 'integrity + zero');
}

console.log('— deposit pending, then async callback success (verified, idempotent)');
{
  var c = ctx();
  c.store.setCompliance('A', '1');
  c.client.q.deposit.push({ data: { status: 1 } });                        // in progress -> await callback
  var r = await c.pay.startDeposit('A', { amount: 3000, provider: 'vodacom', phone: '0810000000' });
  eq(c.bank.wallet('A').credit, 0, 'no credit while pending');

  var cb = withSignature({ order_id: r.order_id, status: 2, message: 'ok' }, SECRET);
  var res1 = c.pay.handleCallback(cb);
  eq(res1.http, 200, 'valid callback -> 200');
  eq(c.bank.wallet('A').credit, 3000, 'credited on the verified callback');
  var res2 = c.pay.handleCallback(cb);                                     // retried delivery
  eq(res2.http, 200, 'duplicate callback -> 200');
  eq(c.bank.wallet('A').credit, 3000, 'still credited exactly once');

  var tampered = withSignature({ order_id: r.order_id, status: 2 }, SECRET);
  tampered.order_id = 'dep_someone_else';                                   // change a signed field
  var bad = c.pay.handleCallback(tampered);
  eq(bad.http, 401, 'tampered callback rejected (401)');
  eq(c.store.callbacks.length, 3, 'every callback stored (incl. the rejected one)');
}

console.log('— withdrawal: hold -> callback success completes');
{
  var c = ctx();
  c.store.setCompliance('A', '1');
  seedEarnings(c.bank, 'A', 12000);
  c.client.q.withdraw.push({ data: { status: 1 } });                       // accepted, pending
  var r = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'orange', phone: '0840000000' });
  ok(r.ok, 'withdrawal accepted');
  eq(c.bank.wallet('A').earnings, 7000, 'earnings held immediately');
  eq(c.bank.held('A'), 5000, 'amount held');
  c.pay.handleCallback(withSignature({ order_id: r.order_id, status: 2 }, SECRET));
  eq(c.bank.held('A'), 0, 'hold released to the gateway on success');
  eq(c.bank.wallet('A').earnings, 7000, 'earnings unchanged (money left)');
  ok(c.bank.ledger.verifyIntegrity() && totalZero(c.bank), 'integrity + zero');
}

console.log('— withdrawal: failure refunds the hold; in_transit keeps it held');
{
  var c = ctx();
  c.store.setCompliance('A', '1');
  seedEarnings(c.bank, 'A', 20000);
  c.client.q.withdraw.push({ data: { status: 1 } });
  var r = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'airtel', phone: '0990000000' });
  c.pay.handleCallback(withSignature({ order_id: r.order_id, status: 3, message: 'declined' }, SECRET));
  eq(c.bank.wallet('A').earnings, 20000, 'failed withdrawal refunded to Earnings');
  eq(c.bank.held('A'), 0, 'nothing held');
  ok(c.store.get(r.order_id).settled, 'settled as failed');

  c.client.q.withdraw.push({ data: { status: 1 } });
  var r2 = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'airtel', phone: '0990000000' });
  c.pay.handleCallback(withSignature({ order_id: r2.order_id, status: 6 }, SECRET));   // in_transit
  eq(c.bank.held('A'), 5000, 'in_transit keeps the hold');
  ok(!c.store.get(r2.order_id).settled, 'not settled while in transit');
}

console.log('— reconciliation polls stale pending payments');
{
  var c = ctx();
  c.store.setCompliance('A', '1');
  seedEarnings(c.bank, 'A', 10000);
  c.client.q.withdraw.push({ data: { status: 1 } });
  var r = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'orange', phone: '0840000000' });
  c.store.get(r.order_id).created_ms -= 6 * 60 * 1000;                     // pretend it's 6 min old
  c.client.q.status.push({ data: { status: 2 } });                        // gateway now reports success
  var n = await c.pay.reconcile();
  eq(n, 1, 'one stale payment reconciled');
  ok(c.store.get(r.order_id).settled, 'settled after the status poll');
  eq(c.bank.held('A'), 0, 'completed');
}

console.log('— per-account daily withdrawal cap');
{
  var c = ctx({ withdrawDailyCap: 8000 });
  c.store.setCompliance('A', '1');
  seedEarnings(c.bank, 'A', 50000);
  c.client.q.withdraw.push({ data: { status: 1 } });
  var r1 = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'orange', phone: '0840000000' });
  ok(r1.ok, 'first within cap');
  var r2 = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'orange', phone: '0840000000' });
  eq(r2.reason, 'daily_cap', 'second exceeds the daily cap -> rejected');
  eq(c.bank.held('A'), 5000, 'only the first is held');
}

console.log('— gateway-unreachable withdrawal refunds the hold');
{
  var c = ctx();
  c.store.setCompliance('A', '1');
  seedEarnings(c.bank, 'A', 10000);
  c.client.q.withdraw.push('THROW');
  var r = await c.pay.startWithdrawal('A', { amount: 5000, provider: 'orange', phone: '0840000000' });
  ok(!r.ok && r.reason === 'gateway_error', 'reports gateway error');
  eq(c.bank.wallet('A').earnings, 10000, 'hold refunded when we never reached them');
  eq(c.bank.held('A'), 0, 'no dangling hold');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
