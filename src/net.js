// Client networking. Opens the WebSocket, keeps the latest authoritative
// snapshot (players, eaters, round), and dispatches server events to hooks the
// rest of the client registers via net.on(type, fn).
//
// Dev-only artificial latency: add ?lag=200 (one-way ms) and optionally
// &jitter=60 to the URL to delay traffic in BOTH directions by lag±jitter,
// simulating a ~2*lag round trip — used to reproduce/verify the netcode.
import { MSG } from '../shared/protocol.js';

var _q = new URLSearchParams(location.search);
var LAG = Math.max(0, +_q.get('lag') || 0);
var JIT = Math.max(0, +_q.get('jitter') || 0);
function delayed(fn){
  if (!LAG && !JIT) { fn(); return; }
  setTimeout(fn, LAG + Math.random() * JIT);
}

if (LAG || JIT){   // visible reminder that traffic is being throttled
  var badge = document.createElement('div');
  badge.textContent = 'SIM LAG ' + LAG + (JIT ? '±' + JIT : '') + 'ms';
  badge.style.cssText = 'position:fixed;left:18px;bottom:14px;z-index:20;font:11px/1 monospace;' +
    'letter-spacing:.15em;color:#ff8f5e;background:rgba(0,0,0,.45);padding:5px 9px;' +
    'border:1px solid rgba(255,143,94,.4);pointer-events:none';
  var add = function(){ if (document.body) document.body.appendChild(badge); };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
}

export var net = {
  ws: null,
  connected: false,
  id: 0,
  color: 0xffffff,
  lagMs: LAG,                 // exposed so the HUD can show a sim-lag badge

  // current maze (from the latest ROUND message)
  grid: null,
  treasureT: null,
  startT: null,
  seed: 0,

  // latest STATE snapshot
  time: 0,
  players: [],
  eaters: [],
  round: { phase: 'playing', timeLeft: 0, winner: null },
  rev: 0,                     // bumped on every STATE so the client reconciles once per snapshot

  _hooks: {},
  on: function(type, fn){ this._hooks[type] = fn; },
  _emit: function(type, m){ if (this._hooks[type]) this._hooks[type](m); },

  connect: function(name){
    var self = this;
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(proto + '://' + location.host + '/ws');
    this.ws.onopen = function(){
      self.connected = true;
      self.send({ t: MSG.JOIN, name: name });
    };
    this.ws.onmessage = function(ev){ delayed(function(){ self._recv(ev.data); }); };
    this.ws.onclose = function(){ self.connected = false; self._emit('close'); };
    this.ws.onerror = function(){};
  },

  _recv: function(data){
    var m;
    try { m = JSON.parse(data); } catch (e) { return; }
    switch (m.t){
      case MSG.WELCOME:
        this.id = m.id; this.color = m.color;
        this._emit('welcome', m);
        break;
      case MSG.ROUND:
        this.seed = m.seed;
        this.grid = Uint8Array.from(atob(m.grid), function(c){ return c.charCodeAt(0); });
        this.treasureT = m.treasure;
        this.startT = m.start;
        this._emit('round', m);
        break;
      case MSG.STATE:
        this.time = m.time;
        this.players = m.players;
        this.eaters = m.eaters;
        this.round = m.round;
        this.rev++;
        this._emit('state', m);
        break;
      case MSG.KILLED:
        this._emit('killed', m);
        break;
      case MSG.ROUND_OVER:
        this._emit('roundOver', m);
        break;
    }
  },

  send: function(obj){
    var ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    var s = JSON.stringify(obj);
    delayed(function(){ if (ws.readyState === 1) ws.send(s); });
  },

  // find my own authoritative snapshot in the latest STATE
  self: function(){
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === this.id) return this.players[i];
    return null;
  }
};
