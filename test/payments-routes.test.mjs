// HTTP layer for payments: auth gate, routing, body parsing, rate limit, and a
// simulator deposit + signed callback all the way through the route handler.
import { Readable } from 'stream';
import { Bank } from '../server/bank.js';
import { PaymentStore } from '../server/paymentStore.js';
import { Payments } from '../server/payments.js';
import { makePaymentApi } from '../server/paymentRoutes.js';
import { withSignature } from '../server/unipesa/sign.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }

var SECRET = 'routes-secret';
function mockClient(){ var q = []; return { deposit: function(){ return Promise.resolve(q.shift() || { data: { status: 1 } }); }, withdraw: function(){ return Promise.resolve({ data: { status: 1 } }); }, status: function(){ return Promise.resolve({ data: { status: 1 } }); }, q: q }; }
function mkApi(){
  var bank = new Bank(), store = new PaymentStore(), client = mockClient();
  var cfg = { ready: true, secret: SECRET, depositMin: 1000, withdrawMin: 5000, withdrawDailyCap: 200000, publicId: 'pid', merchantId: 'mid', base: 'https://x/api', publicUrl: 'https://devoreur.com' };
  var pay = new Payments({ bank: bank, store: store, client: client, config: cfg });
  var verifyToken = function(t){ if (t === 'good') return Promise.resolve({ sub: 'A', name: 'AA', email: 'a@x.com' }); return Promise.reject(new Error('bad')); };
  return { api: makePaymentApi({ payments: pay, store: store, config: cfg, verifyToken: verifyToken }), bank: bank, store: store, client: client };
}
function mkReq(method, path, opts){
  opts = opts || {};
  var r = Readable.from([opts.body != null ? JSON.stringify(opts.body) : '']);
  r.method = method; r.url = path;
  r.headers = Object.assign({ host: 'devoreur.com', 'x-forwarded-proto': 'https' }, opts.token ? { authorization: 'Bearer ' + opts.token } : {});
  return r;
}
function mkRes(){ return { code: 0, body: '', writeHead: function(c){ this.code = c; }, end: function(s){ this.body = s || ''; } }; }
async function call(api, method, path, opts){ var res = mkRes(); await api(mkReq(method, path, opts), res, path); return { code: res.code, json: res.body ? JSON.parse(res.body) : null }; }

console.log('— config is public; money endpoints need a session');
{
  var c = mkApi();
  eq((await call(c.api, 'GET', '/api/pay/config')).json.enabled, true, 'config enabled');
  eq((await call(c.api, 'POST', '/api/pay/deposit', { body: { amount: 1000, provider: 'vodacom', phone: '0810000000' } })).code, 401, 'no token -> 401');
  eq((await call(c.api, 'POST', '/api/pay/deposit', { token: 'bad', body: {} })).code, 401, 'bad token -> 401');
}

console.log('— attestation gate, then a direct-success deposit through the route');
{
  var c = mkApi();
  eq((await call(c.api, 'POST', '/api/pay/deposit', { token: 'good', body: { amount: 2000, provider: 'vodacom', phone: '0810000000' } })).json.reason, 'attestation_required', 'blocked before attesting');
  var att = await call(c.api, 'POST', '/api/pay/attest', { token: 'good', body: { accept: true } });
  eq(att.code, 200, 'attest ok'); ok(att.json.attested, 'attested');
  c.client.q.push({ data: { provider_result: { code: -8888 }, status: 2 } });   // simulator success
  var dep = await call(c.api, 'POST', '/api/pay/deposit', { token: 'good', body: { amount: 2000, provider: 'vodacom', phone: '0810000000' } });
  eq(dep.code, 200, 'deposit accepted');
  eq(c.bank.wallet('A').credit, 2000, 'Credit applied via the route');
  var me = await call(c.api, 'GET', '/api/pay/me', { token: 'good' });
  eq(me.json.payments.length, 1, 'shows in history'); ok(me.json.attested, 'me shows attested');
}

console.log('— callback endpoint: signed 200, unsigned 401');
{
  var c = mkApi();
  c.store.setCompliance('A', '1');
  c.client.q.push({ data: { status: 1 } });
  var dep = await call(c.api, 'POST', '/api/pay/deposit', { token: 'good', body: { amount: 3000, provider: 'vodacom', phone: '0810000000' } });
  var oid = dep.json.order_id;
  var good = await call(c.api, 'POST', '/api/unipesa/callback', { body: withSignature({ order_id: oid, status: 2 }, SECRET) });
  eq(good.code, 200, 'signed callback -> 200');
  eq(c.bank.wallet('A').credit, 3000, 'credited via callback route');
  var bad = await call(c.api, 'POST', '/api/unipesa/callback', { body: { order_id: oid, status: 2 } });
  eq(bad.code, 401, 'unsigned callback -> 401');
}

console.log('— rate limiting on money endpoints');
{
  var c = mkApi();
  c.store.setCompliance('A', '1');
  var got429 = false;
  for (var i = 0; i < 20; i++){
    c.client.q.push({ data: { status: 1 } });
    var r = await call(c.api, 'POST', '/api/pay/deposit', { token: 'good', body: { amount: 1000, provider: 'vodacom', phone: '0810000000' } });
    if (r.code === 429){ got429 = true; break; }
  }
  ok(got429, 'excessive requests are rate-limited (429)');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
