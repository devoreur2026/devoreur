// Unipesa signing (HMAC-SHA512 over the doc's key+value concatenation, nested
// prefixing, signature excluded) + phone normalization + amount formatting.
import { signatureBase, signParams, verifySignature, withSignature } from '../server/unipesa/sign.js';
import { normalizePhone, formatAmount, providerById, providerByKey, STATUS } from '../shared/payments.js';
import { UnipesaClient } from '../server/unipesa/client.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

console.log('— signature base string (key+value, order, exclusion, nesting)');
{
  eq(signatureBase({ public_id: 'abc', amount: '1000.00', currency: 'CDF', country: 'CD' }),
     'public_idabcamount1000.00currencyCDFcountryCD', 'flat params concatenate key+value in order');
  eq(signatureBase({ a: '1', signature: 'zzz', b: '2' }), 'a1b2', 'top-level signature is excluded');
  eq(signatureBase({ order_id: 'dep_1', customer: { phone: '243810000000', name: 'Zed' } }),
     'order_iddep_1customer.phone243810000000customer.nameZed', 'nested object uses parent.child prefix');
  eq(signatureBase({ a: { b: { c: '9' } } }), 'a.b.c9', 'deep nesting recurses');
  eq(signatureBase({ a: '1', meta: { signature: 'x' } }), 'a1meta.signaturex', 'nested "signature" is NOT excluded');
  eq(signatureBase({ x: 1, y: 2 }), 'x1y2', 'numeric values stringify');
}

console.log('— HMAC-SHA512 output shape + determinism');
{
  var sig = signParams({ a: '1', b: '2' }, 'secret');
  eq(sig.length, 128, 'sha512 hex is 128 chars');
  ok(/^[0-9a-f]+$/.test(sig), 'lowercase hex');
  eq(sig, signParams({ a: '1', b: '2' }, 'secret'), 'deterministic');
  ok(sig !== signParams({ a: '1', b: '2' }, 'other'), 'depends on the secret');
  ok(sig !== signParams({ a: '1', b: '3' }, 'secret'), 'depends on the params');
}

console.log('— verify: valid / tampered value / tampered signature / missing / duplicate');
{
  var secret = 'e4104008-secret';
  var req = withSignature({ public_id: 'pid', order_id: 'dep_1', amount: '1000.00', provider: 14 }, secret);
  ok(typeof req.signature === 'string' && req.signature.length === 128, 'withSignature attaches a signature');
  ok(verifySignature(req, secret), 'a correctly signed payload verifies');
  ok(verifySignature(req, secret), 'verifies again (idempotent, no mutation)');

  var tampered = Object.assign({}, req, { amount: '999999.00' });
  ok(!verifySignature(tampered, secret), 'a tampered amount fails verification');

  var badsig = Object.assign({}, req, { signature: req.signature.replace(/.$/, req.signature.slice(-1) === 'a' ? 'b' : 'a') });
  ok(!verifySignature(badsig, secret), 'a tampered signature fails');
  ok(!verifySignature(Object.assign({}, req, { signature: undefined }), secret), 'missing signature fails');
  ok(!verifySignature(req, 'wrong-secret'), 'wrong secret fails');
}

console.log('— phone normalization per provider');
{
  // Vodacom -> 243 + national
  eq(normalizePhone('vodacom', '0810000000').phone, '243810000000', 'vodacom from 0-prefixed');
  eq(normalizePhone('vodacom', '243810000000').phone, '243810000000', 'vodacom from full intl');
  eq(normalizePhone('vodacom', '810000000').phone, '243810000000', 'vodacom from bare national');
  eq(normalizePhone('vodacom', '+243 81 000 0000').phone, '243810000000', 'strips spaces/plus');
  // Orange / Africell -> leading 0, 10 digits
  eq(normalizePhone('orange', '243840000000').phone, '0840000000', 'orange -> 0 + national');
  eq(normalizePhone('africell', '900000000').phone, '0900000000', 'africell -> 0 + national');
  // Airtel -> bare 9-digit national
  eq(normalizePhone('airtel', '0990000000').phone, '990000000', 'airtel -> bare national');
  // invalids
  ok(!normalizePhone('vodacom', '12345').ok, 'too short rejected');
  ok(!normalizePhone('vodacom', '').ok, 'empty rejected');
  ok(!normalizePhone('nope', '0810000000').ok, 'unknown provider rejected');
}

console.log('— amount formatting + provider lookup + statuses');
{
  eq(formatAmount(1000), '1000.00', 'integer CDF -> two decimals');
  eq(formatAmount(5000), '5000.00', 'formats 5000');
  eq(providerByKey('airtel').id, 17, 'airtel id 17');
  ok(!providerByKey('simulator'), 'no simulator provider selectable in production');
  eq(providerById(9).key, 'vodacom', 'id 9 -> vodacom');
  eq(STATUS.SUCCESS, 2, 'success is status 2');
}

console.log('— outgoing payment_c2b body matches the Unipesa v5.7.2 doc exactly');
{
  var captured = null;
  var fakeFetch = function(url, opts){ captured = { url: url, body: JSON.parse(opts.body) }; return Promise.resolve({ status: 200, text: function(){ return Promise.resolve('{"status":1}'); } }); };
  var c = new UnipesaClient({ base: 'https://api.example/v1', publicId: 'PUB', merchantId: 'MID', secret: 'SEC' }, fakeFetch);
  await c.deposit('dep_abc', 100, 17, '990000000', 'https://devoreur.com/api/unipesa/callback');

  eq(captured.url, 'https://api.example/v1/PUB/payment_c2b', 'public_id is in the URL path (not the body)');
  var b = captured.body;
  eq(Object.keys(b).join(','), 'merchant_id,customer_id,order_id,amount,currency,country,callback_url,provider_id,signature', 'exact doc fields in doc order');
  eq(b.customer_id, '990000000', 'PHONE is sent as customer_id');
  eq(b.provider_id, 17, 'provider_id carries the numeric id');
  eq(typeof b.provider_id, 'number', 'provider_id is an INTEGER, not a string');
  eq(b.amount, '100.00', 'amount is a two-decimal string');
  eq(b.merchant_id, 'MID', 'merchant_id present');
  ok(!('phone' in b) && !('provider' in b) && !('public_id' in b) && !('msisdn' in b), 'no phone/provider/public_id/msisdn keys');
  ok(verifySignature(b, 'SEC'), 'signature verifies over exactly the sent body');
}

// b2c mirrors the same field convention
{
  var cap2 = null;
  var ff = function(url, opts){ cap2 = JSON.parse(opts.body); return Promise.resolve({ status: 200, text: function(){ return Promise.resolve('{"status":1}'); } }); };
  var c2 = new UnipesaClient({ base: 'https://api.example/v1', publicId: 'PUB', merchantId: 'MID', secret: 'SEC' }, ff);
  await c2.withdraw('wd_abc', 5000, 10, '0840000000', 'https://cb');
  eq(cap2.customer_id, '0840000000', 'b2c also sends phone as customer_id');
  eq(cap2.provider_id, 10, 'b2c provider_id is the integer id');
  ok(!('phone' in cap2) && !('public_id' in cap2), 'b2c has no phone/public_id keys');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
