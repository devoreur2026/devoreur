// UMBRA server: serves the static client and hosts the authoritative
// multiplayer over WebSockets. One process, one command (`npm start`).
import './env.js';   // must be first: loads .env before auth.js reads SUPABASE_*
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MAX_PLAYERS } from '../shared/config.js';
import { DEV_GRANT, ENTRY_BASE, ROUND_LIMIT } from '../shared/economy.js';
import { MSG } from '../shared/protocol.js';
import { verifyToken, authConfig, authConfigured } from './auth.js';
import { bank } from './bankInstance.js';
import { initLedgerStore, ledgerPersistenceConfigured } from './ledgerStore.js';
import { payments, paymentConfigObj, paymentStore, logPaymentStatus } from './paymentsInstance.js';
import { makePaymentApi } from './paymentRoutes.js';
import { initPaymentStore, paymentPersistenceConfigured } from './paymentStoreSupabase.js';

var paymentApi = makePaymentApi({ payments: payments, store: paymentStore, config: paymentConfigObj, verifyToken: verifyToken });

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..');   // project root (serves index.html, src/, shared/)
var PORT = process.env.PORT || 5173;
var DEV = process.env.UMBRA_DEV === '1';    // dev-only test-Credit grant

if (!authConfigured()){
  console.error('\n[!] Supabase auth is NOT configured — nobody can play until you set env vars:');
  console.error('    SUPABASE_URL              = https://<project-ref>.supabase.co');
  console.error('    SUPABASE_PUBLISHABLE_KEY  = <your publishable key (sb_publishable_...)>');
  console.error('    (locally: put them in .env  —  on Render: add them as environment variables)\n');
}

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};

var server = http.createServer(async (req, res) => {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);

  // payment endpoints (/api/pay/* + the Unipesa callback) — self-contained
  if (await paymentApi(req, res, urlPath)) return;

  // Public client config (Supabase URL + publishable anon key) from env vars.
  if (urlPath === '/api/config'){
    var cfg = authConfig();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ supabaseUrl: cfg.url || null, supabaseAnonKey: cfg.anonKey || null }));
    return;
  }

  // Live preview of the round a joiner would enter (current price / pot / timer)
  // for the join screen.
  if (urlPath === '/api/round'){
    var rm = rooms.find(function(r){ return r.hasRoom(); });
    var info = rm ? rm.roundInfo() : { price: ENTRY_BASE, pot: 0, elapsed: 0, limit: ROUND_LIMIT, open: true, paid: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(info));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  var filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)){ res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err){ res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---- multiplayer ---- */
var rooms = [];
function assignRoom(){
  for (var i = 0; i < rooms.length; i++) if (rooms[i].hasRoom()) return rooms[i];
  var r = new Room('room-' + (rooms.length + 1));
  rooms.push(r);
  return r;
}

function rejectAuth(ws, message){
  if (ws.readyState === 1){ ws.send(JSON.stringify({ t: MSG.AUTH_ERROR, message: message })); }
  try { ws.close(); } catch (e) {}
}

var wss = new WebSocketServer({ server: server, path: '/ws' });
wss.on('connection', (ws) => {
  var room = null, player = null, joining = false;

  ws.on('message', (buf) => {
    var msg;
    try { msg = JSON.parse(buf.toString()); } catch (e) { return; }

    if (msg.t === MSG.JOIN && !player && !joining){
      // Server-side gate: no verified Supabase token -> no play. The name comes
      // from the verified account (display name), not from the client.
      joining = true;
      verifyToken(msg.token).then((user) => {
        if (ws.readyState !== 1) return;             // client gave up while we verified
        room = assignRoom();
        player = room.addPlayer(user.name, user.sub, ws);
        console.log('[join] "' + user.name + '" (' + user.email + ') -> ' + room.name + ' (' + room.size + '/' + MAX_PLAYERS + ')');
      }).catch((err) => {
        console.log('[join rejected] ' + (err && err.message ? err.message : err));
        rejectAuth(ws, (err && err.message) || 'Sign in to play.');
      });
      return;
    }
    if (!player) return;

    if (msg.t === MSG.INPUT && Array.isArray(msg.cmds) && msg.cmds.length <= 64){
      room.onInput(player, msg.cmds);
      return;
    }
    if (msg.t === MSG.SHOP){
      var s = bank.buyFireballs(player.account, 1, '' + msg.nonce);
      room.sendWallet(player);
      room.send(ws, { t: MSG.SHOP, ok: s.ok, reason: s.reason || null });
      return;
    }
    if (msg.t === MSG.TRANSFER){
      bank.transfer(player.account, msg.amount | 0, '' + msg.nonce);
      room.sendWallet(player);
      return;
    }
    if (msg.t === MSG.HISTORY){
      room.send(ws, { t: MSG.HISTORY_DATA, rows: bank.history(player.account, 60) });
      return;
    }
    if (msg.t === MSG.GRANT){
      if (!DEV) return;                              // impossible in production
      bank.grant(player.account, DEV_GRANT, 'grant:' + player.account + ':' + msg.nonce);
      room.sendWallet(player);
      return;
    }
    if (msg.t === MSG.THROW){
      room.throwFireball(player, msg);               // validated server-side (fireball commit)
      return;
    }
  });

  ws.on('close', () => {
    if (room && player){
      room.removePlayer(player.id);
      console.log('[left] "' + player.name + '" (' + room.size + ' left in ' + room.name + ')');
    }
  });
  ws.on('error', () => {});
});

// Load the durable ledger from Supabase (if a service-role key is configured),
// rebuilding wallets before anyone can play. In-memory stays authoritative.
if (ledgerPersistenceConfigured()){
  initLedgerStore(bank.ledger)
    .catch((e) => console.error('[ledger] Supabase persistence FAILED to init — running in-memory only:', e && e.message));
} else {
  console.log('[ledger] in-memory only (set SUPABASE_SECRET_KEY to persist the ledger in Supabase).');
}

// payments status + durable store + reconciliation loop (only when enabled)
logPaymentStatus(paymentConfigObj);
if (paymentConfigObj.enabled && paymentPersistenceConfigured()){
  initPaymentStore(paymentStore)
    .catch(function(e){ console.error('[payments] Supabase persistence FAILED to init — in-memory only (records lost on restart):', e && e.message); });
}
if (paymentConfigObj.ready){
  setInterval(function(){
    payments.reconcile().catch(function(e){ console.error('[payments reconcile]', e && e.message); });
  }, 60 * 1000);
}

server.listen(PORT, () => {
  console.log('UMBRA server (game + web) running at http://localhost:' + PORT);
  console.log('Open two browser tabs there to test multiplayer.');
});
