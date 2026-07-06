// HTTP wallet endpoints: balances, Earnings->Credit transfer, and fireball
// purchase all work over HTTP (so the wallet works from the home screen, with no
// game socket). Session-gated. Backed by the shared Bank.
import { Readable } from 'stream';
import { Bank } from '../server/bank.js';
import { makeWalletApi } from '../server/walletRoutes.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }

function mkApi(){
  var bank = new Bank();
  bank.grant('A', 5000, 'g1');                                   // 5000 Credit
  bank.ledger.post('seedE', [                                   // 900 Earnings
    { account: 'mint', bucket: 'earnings', amount: -900, type: 'seed' },
    { account: 'A', bucket: 'earnings', amount: 900, type: 'seed' }
  ], {});
  var verifyToken = function(t){ return t === 'good' ? Promise.resolve({ sub: 'A' }) : Promise.reject(new Error('bad')); };
  return { api: makeWalletApi({ bank: bank, verifyToken: verifyToken }), bank: bank };
}
function mkReq(method, path, opts){
  opts = opts || {};
  var r = Readable.from([opts.body != null ? JSON.stringify(opts.body) : '']);
  r.method = method; r.url = path;
  r.headers = opts.token ? { authorization: 'Bearer ' + opts.token } : {};
  return r;
}
function mkRes(){ return { code: 0, body: '', writeHead: function(c){ this.code = c; }, end: function(s){ this.body = s || ''; } }; }
async function call(api, method, path, opts){ var res = mkRes(); await api(mkReq(method, path, opts), res, path); return { code: res.code, json: res.body ? JSON.parse(res.body) : null }; }

console.log('— wallet read requires a session');
{
  var c = mkApi();
  eq((await call(c.api, 'GET', '/api/wallet')).code, 401, 'no token -> 401');
  var w = await call(c.api, 'GET', '/api/wallet', { token: 'good' });
  eq(w.code, 200, 'ok with token');
  eq(w.json.credit, 5000, 'credit'); eq(w.json.earnings, 900, 'earnings'); eq(w.json.fireballs, 0, 'no fireballs yet');
}

console.log('— buy fireballs over HTTP (the reported break)');
{
  var c = mkApi();
  var r = await call(c.api, 'POST', '/api/wallet/shop', { token: 'good', body: { nonce: 'n1' } });
  eq(r.code, 200, 'purchase ok');
  eq(r.json.fireballs, 10, 'got 10 fireballs');
  eq(r.json.credit, 4900, 'credit -100');
  eq(c.bank.fireballs('A'), 10, 'inventory persisted on the account');
  // idempotent per nonce (double-click safe)
  var again = await call(c.api, 'POST', '/api/wallet/shop', { token: 'good', body: { nonce: 'n1' } });
  eq(again.json.fireballs, 10, 'same nonce does not double-buy');
  eq(again.json.credit, 4900, 'no double charge');
}

console.log('— move Earnings -> Credit over HTTP (the other reported break)');
{
  var c = mkApi();
  var r = await call(c.api, 'POST', '/api/wallet/transfer', { token: 'good', body: { amount: 500, nonce: 'x1' } });
  eq(r.code, 200, 'transfer ok');
  eq(r.json.earnings, 400, 'earnings -500'); eq(r.json.credit, 5500, 'credit +500');
  // too much -> clean rejection (so the UI can message it, not fail silently)
  var bad = await call(c.api, 'POST', '/api/wallet/transfer', { token: 'good', body: { amount: 999999, nonce: 'x2' } });
  eq(bad.code, 400, 'over-transfer rejected'); eq(bad.json.reason, 'insufficient', 'reason surfaced');
}

console.log('— not-enough-credit purchase rejects cleanly');
{
  var c = mkApi();
  // drain credit first
  await call(c.api, 'POST', '/api/wallet/transfer', { token: 'good', body: { amount: 900, nonce: 't' } }); // credit 5900
  // spend it down via many buys would be tedious; instead grant a broke account
  c.bank.grant('A', 0, 'noop');
  // simulate broke by a fresh api with tiny credit
  var c2 = (function(){ var b = new Bank(); b.grant('A', 50, 'g'); var vt = function(t){ return t==='good'?Promise.resolve({sub:'A'}):Promise.reject(new Error('x')); }; return { api: makeWalletApi({ bank: b, verifyToken: vt }) }; })();
  var r = await call(c2.api, 'POST', '/api/wallet/shop', { token: 'good', body: { nonce: 'n' } });
  eq(r.code, 400, 'broke purchase rejected'); eq(r.json.reason, 'insufficient', 'reason surfaced');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
