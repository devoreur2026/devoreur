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
import { MSG } from '../shared/protocol.js';
import { verifyToken, authConfig, authConfigured } from './auth.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..');   // project root (serves index.html, src/, shared/)
var PORT = process.env.PORT || 5173;

if (!authConfigured()){
  console.error('\n[!] Supabase auth is NOT configured — nobody can play until you set env vars:');
  console.error('    SUPABASE_URL       = https://<project-ref>.supabase.co');
  console.error('    SUPABASE_ANON_KEY  = <your publishable/anon key>');
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

var server = http.createServer((req, res) => {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);

  // Public client config (Supabase URL + publishable anon key) from env vars.
  if (urlPath === '/api/config'){
    var cfg = authConfig();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ supabaseUrl: cfg.url || null, supabaseAnonKey: cfg.anonKey || null }));
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
        player = room.addPlayer(user.name, ws);
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

server.listen(PORT, () => {
  console.log('UMBRA server (game + web) running at http://localhost:' + PORT);
  console.log('Open two browser tabs there to test multiplayer.');
});
