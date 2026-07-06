// HTTP routes for payments. All player-facing endpoints require a verified
// Supabase session (Bearer token) and are rate-limited. The callback endpoint is
// authenticated by the HMAC signature, not a session.
import { PROVIDERS } from '../shared/payments.js';

function sendJSON(res, code, obj){
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// read a JSON body (cap 64KB)
function readBody(req){
  return new Promise(function(resolve){
    var data = '', tooBig = false;
    req.on('data', function(ch){ data += ch; if (data.length > 65536){ tooBig = true; req.destroy(); } });
    req.on('end', function(){ if (tooBig) return resolve(null); try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(null); } });
    req.on('error', function(){ resolve(null); });
  });
}

// simple fixed-window rate limiter, keyed by account (or IP) + bucket
function makeLimiter(max, windowMs){
  var hits = new Map();
  return function(key){
    var now = Date.now(), e = hits.get(key);
    if (!e || now - e.start >= windowMs){ hits.set(key, { start: now, n: 1 }); return true; }
    if (e.n >= max) return false;
    e.n++; return true;
  };
}

export function makePaymentApi(opts){
  var payments = opts.payments, store = opts.store, cfg = opts.config, verifyToken = opts.verifyToken;
  var limitMoney = makeLimiter(12, 60 * 1000);   // deposit/withdraw/status per account/min
  var limitAttest = makeLimiter(6, 60 * 1000);

  function publicBase(req){
    if (cfg.publicUrl) return cfg.publicUrl;
    var proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    return proto + '://' + req.headers.host;
  }
  async function auth(req){
    var h = req.headers['authorization'] || '';
    var token = h.indexOf('Bearer ') === 0 ? h.slice(7) : null;
    if (!token) return null;
    try { return await verifyToken(token); } catch (e) { return null; }
  }

  // returns true if it handled the request
  return async function handle(req, res, urlPath){
    if (urlPath.indexOf('/api/pay/') !== 0 && urlPath !== '/api/unipesa/callback') return false;

    // --- callback: signature-authenticated, no session ---
    if (urlPath === '/api/unipesa/callback'){
      if (req.method !== 'POST') { sendJSON(res, 405, { ok: false }); return true; }
      var body = await readBody(req);
      if (body == null){ sendJSON(res, 400, { ok: false, reason: 'bad_body' }); return true; }
      var r = payments.handleCallback(body);
      sendJSON(res, r.http || (r.ok ? 200 : 400), { ok: !!r.ok });
      return true;
    }

    // --- public config (no session needed) ---
    if (urlPath === '/api/pay/config' && req.method === 'GET'){
      sendJSON(res, 200, {
        enabled: !!cfg.ready, depositMin: cfg.depositMin, withdrawMin: cfg.withdrawMin,
        dailyCap: cfg.withdrawDailyCap, providers: PROVIDERS
      });
      return true;
    }

    // everything below requires a verified session
    var user = await auth(req);
    if (!user){ sendJSON(res, 401, { ok: false, reason: 'unauthenticated' }); return true; }
    var account = user.sub;

    if (urlPath === '/api/pay/me' && req.method === 'GET'){
      sendJSON(res, 200, { attested: store.hasCompliance(account), payments: store.listByAccount(account, 50) });
      return true;
    }
    if (urlPath === '/api/pay/attest' && req.method === 'POST'){
      if (!limitAttest(account)){ sendJSON(res, 429, { ok: false, reason: 'rate_limited' }); return true; }
      var b = await readBody(req);
      if (!b || b.accept !== true){ sendJSON(res, 400, { ok: false, reason: 'must_accept' }); return true; }
      store.setCompliance(account, '1');
      sendJSON(res, 200, { ok: true, attested: true });
      return true;
    }
    if (urlPath === '/api/pay/deposit' && req.method === 'POST'){
      if (!cfg.ready){ sendJSON(res, 403, { ok: false, reason: 'payments_disabled' }); return true; }
      if (!limitMoney(account)){ sendJSON(res, 429, { ok: false, reason: 'rate_limited' }); return true; }
      var d = await readBody(req);
      if (!d){ sendJSON(res, 400, { ok: false, reason: 'bad_body' }); return true; }
      var rd = await payments.startDeposit(account, { amount: d.amount | 0, provider: d.provider, phone: d.phone, callbackUrl: publicBase(req) + '/api/unipesa/callback' });
      sendJSON(res, rd.ok ? 200 : 400, rd);
      return true;
    }
    if (urlPath === '/api/pay/withdraw' && req.method === 'POST'){
      if (!cfg.ready){ sendJSON(res, 403, { ok: false, reason: 'payments_disabled' }); return true; }
      if (!limitMoney(account)){ sendJSON(res, 429, { ok: false, reason: 'rate_limited' }); return true; }
      var w = await readBody(req);
      if (!w){ sendJSON(res, 400, { ok: false, reason: 'bad_body' }); return true; }
      var rw = await payments.startWithdrawal(account, { amount: w.amount | 0, provider: w.provider, phone: w.phone, callbackUrl: publicBase(req) + '/api/unipesa/callback' });
      sendJSON(res, rw.ok ? 200 : 400, rw);
      return true;
    }
    if (urlPath === '/api/pay/status' && req.method === 'POST'){
      if (!limitMoney(account)){ sendJSON(res, 429, { ok: false, reason: 'rate_limited' }); return true; }
      var s = await readBody(req);
      var rec = s && s.order_id ? store.get(s.order_id) : null;
      if (!rec || rec.account !== account){ sendJSON(res, 404, { ok: false, reason: 'not_found' }); return true; }
      var rs = await payments.pollStatus(s.order_id);
      sendJSON(res, 200, rs);
      return true;
    }
    sendJSON(res, 404, { ok: false, reason: 'not_found' });
    return true;
  };
}
