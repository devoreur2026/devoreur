// HTTP wallet endpoints so a signed-in player can view balances/history and move
// Earnings->Credit WITHOUT joining a room (the in-game path stays on the socket).
// Session-gated (Supabase Bearer token) + rate-limited. Backed by the shared Bank.
function sendJSON(res, code, obj){
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req){
  return new Promise(function(resolve){
    var data = '', tooBig = false;
    req.on('data', function(ch){ data += ch; if (data.length > 16384){ tooBig = true; req.destroy(); } });
    req.on('end', function(){ if (tooBig) return resolve(null); try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(null); } });
    req.on('error', function(){ resolve(null); });
  });
}
function makeLimiter(max, windowMs){
  var hits = new Map();
  return function(key){
    var now = Date.now(), e = hits.get(key);
    if (!e || now - e.start >= windowMs){ hits.set(key, { start: now, n: 1 }); return true; }
    if (e.n >= max) return false;
    e.n++; return true;
  };
}

export function makeWalletApi(opts){
  var bank = opts.bank, verifyToken = opts.verifyToken;
  var limit = makeLimiter(40, 60 * 1000);

  async function auth(req){
    var h = req.headers['authorization'] || '';
    var token = h.indexOf('Bearer ') === 0 ? h.slice(7) : null;
    if (!token) return null;
    try { return await verifyToken(token); } catch (e) { return null; }
  }
  function walletPayload(account){
    var w = bank.wallet(account);
    var history = bank.history(account, 40).map(function(r){ return { type: r.type, amount: r.amount, bucket: r.bucket }; });
    return { ok: true, credit: w.credit, earnings: w.earnings, fireballs: bank.fireballs(account), history: history };
  }

  return async function handle(req, res, urlPath){
    if (urlPath !== '/api/wallet' && urlPath !== '/api/wallet/transfer' && urlPath !== '/api/wallet/shop') return false;
    var user = await auth(req);
    if (!user){ sendJSON(res, 401, { ok: false, reason: 'unauthenticated' }); return true; }
    var account = user.sub;
    if (!limit(account)){ sendJSON(res, 429, { ok: false, reason: 'rate_limited' }); return true; }

    if (urlPath === '/api/wallet' && req.method === 'GET'){
      sendJSON(res, 200, walletPayload(account));
      return true;
    }
    if (urlPath === '/api/wallet/transfer' && req.method === 'POST'){
      var b = await readBody(req);
      if (!b){ sendJSON(res, 400, { ok: false, reason: 'bad_body' }); return true; }
      var r = bank.transfer(account, b.amount | 0, 'http:' + (b.nonce || ''));   // idempotent per nonce
      if (!r.ok){ sendJSON(res, 400, { ok: false, reason: r.reason || 'failed' }); return true; }
      sendJSON(res, 200, walletPayload(account));
      return true;
    }
    if (urlPath === '/api/wallet/shop' && req.method === 'POST'){
      var bs = await readBody(req);
      if (!bs){ sendJSON(res, 400, { ok: false, reason: 'bad_body' }); return true; }
      var rs = bank.buyFireballs(account, 1, 'http:' + (bs.nonce || ''));         // 1 pack (10), idempotent per nonce
      if (!rs.ok){ sendJSON(res, 400, { ok: false, reason: rs.reason || 'failed' }); return true; }
      sendJSON(res, 200, walletPayload(account));
      return true;
    }
    sendJSON(res, 404, { ok: false, reason: 'not_found' });
    return true;
  };
}
