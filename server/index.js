// UMBRA server: serves the static client and hosts the authoritative
// multiplayer over WebSockets. One process, one command (`npm start`).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MAX_PLAYERS } from '../shared/config.js';
import { MSG } from '../shared/protocol.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..');   // project root (serves index.html, src/, shared/)
var PORT = process.env.PORT || 5173;

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

var wss = new WebSocketServer({ server: server, path: '/ws' });
wss.on('connection', (ws) => {
  var room = null, player = null;

  ws.on('message', (buf) => {
    var msg;
    try { msg = JSON.parse(buf.toString()); } catch (e) { return; }

    if (msg.t === MSG.JOIN && !player){
      var name = ('' + (msg.name || 'Anon')).slice(0, 16).trim() || 'Anon';
      room = assignRoom();
      player = room.addPlayer(name, ws);
      console.log('[join] "' + name + '" -> ' + room.name + ' (' + room.size + '/' + MAX_PLAYERS + ')');
      return;
    }
    if (!player) return;

    if (msg.t === MSG.INPUT){
      if (typeof msg.x === 'number' && typeof msg.z === 'number' && typeof msg.yaw === 'number'){
        room.onInput(player, msg.x, msg.z, msg.yaw);
      }
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
