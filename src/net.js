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
  econ: { pot: 0, paid: 0, bonus: false, bonusPot: 500000 },
  wallet: { credit: 0, earnings: 0, fireballs: 0 },
  spectating: false,
  rev: 0,                     // bumped on every STATE so the client reconciles once per snapshot
  _n: 0,

  _hooks: {},
  onError: null,                     // set by the UI to surface a handler failure visibly
  // Multiple modules subscribe to the same event — keep ALL of them, not just
  // the last (a single-handler map silently dropped game.js's 'round'/'state').
  on: function(type, fn){ (this._hooks[type] || (this._hooks[type] = [])).push(fn); },
  _emit: function(type, m){
    var hs = this._hooks[type];
    if (!hs) return;
    for (var i = 0; i < hs.length; i++){
      try { hs[i](m); }
      catch (e){
        console.error('[net] handler for "' + type + '" threw:', e);
        if (this.onError){ try { this.onError(type, e); } catch (e2) {} }   // don't hang silently
      }
    }
  },

  connect: function(token){
    var self = this;
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    console.info('[join] connecting to ' + proto + '://' + location.host + '/ws');
    this.ws = new WebSocket(proto + '://' + location.host + '/ws');
    this.ws.onopen = function(){
      self.connected = true;
      console.info('[join] socket open → sending join');
      self.send({ t: MSG.JOIN, token: token });   // server verifies + derives the name
    };
    this.ws.onmessage = function(ev){ delayed(function(){ self._recv(ev.data); }); };
    this.ws.onclose = function(ev){
      self.connected = false;
      console.info('[join] socket closed (code ' + (ev && ev.code) + ')');
      self._emit('close', ev);
    };
    this.ws.onerror = function(e){ console.warn('[join] socket error', e); };
  },

  _recv: function(data){
    var m;
    try { m = JSON.parse(data); } catch (e) { console.warn('[net] bad message', e); return; }
    switch (m.t){
      case MSG.AUTH_ERROR:
        console.warn('[join] auth error: ' + m.message);
        this._emit('authError', m);
        break;
      case MSG.WELCOME:
        this.id = m.id; this.color = m.color; this.name = m.name;
        console.info('[join] welcome id=' + m.id + ' name=' + m.name);
        this._emit('welcome', m);
        break;
      case MSG.ROUND:
        this.seed = m.seed;
        this.grid = Uint8Array.from(atob(m.grid), function(c){ return c.charCodeAt(0); });
        this.treasureT = m.treasure;
        this.spectating = false;
        console.info('[join] round received (grid ' + this.grid.length + ' cells) → entering');
        this._emit('round', m);
        break;
      case MSG.SPAWN:
        this._emit('spawn', m);        // randomized spawn point (join / round / respawn)
        break;
      case MSG.STATE:
        this.time = m.time;
        this.players = m.players;
        this.eaters = m.eaters;
        this.round = m.round;
        if (m.econ) this.econ = m.econ;
        this.rev++;
        this._emit('state', m);
        break;
      case MSG.KILLED:
        this._emit('killed', m);
        break;
      case MSG.ROUND_OVER:
        this._emit('roundOver', m);
        break;
      case MSG.WALLET:
        this.wallet = { credit: m.credit, earnings: m.earnings, fireballs: m.fireballs };
        this._emit('wallet', this.wallet);
        break;
      case MSG.SPECTATE:
        this.spectating = true;
        this._emit('spectate', m);
        break;
      case MSG.HISTORY_DATA:
        this._emit('history', m.rows || []);
        break;
      case MSG.KILLFEED:
        this._emit('killfeed', m.text);
        break;
      case MSG.FIREBALL:
        this._emit('fireball', m);
        break;
      case MSG.FIREBALL_END:
        this._emit('fireballEnd', m);
        break;
    }
  },

  send: function(obj){
    var ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    var s = JSON.stringify(obj);
    delayed(function(){ if (ws.readyState === 1) ws.send(s); });
  },

  nonce: function(){ return Date.now().toString(36) + '-' + (++this._n); },
  throwFireball: function(yaw){ this.send({ t: MSG.THROW, id: this.nonce(), yaw: yaw }); },
  buyFireballs: function(){ this.send({ t: MSG.SHOP, packs: 1, nonce: this.nonce() }); },
  transfer: function(amount){ this.send({ t: MSG.TRANSFER, amount: amount, nonce: this.nonce() }); },
  revive: function(){ this.send({ t: MSG.REVIVE, nonce: this.nonce() }); },   // out of lives -> buy another pack
  requestHistory: function(){ this.send({ t: MSG.HISTORY }); },
  // leave the game: close the socket (server removes us); the close handler
  // returns us to the home screen.
  disconnect: function(){ this.spectating = false; if (this.ws){ try { this.ws.close(); } catch (e) {} } },

  // find my own authoritative snapshot in the latest STATE
  self: function(){
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === this.id) return this.players[i];
    return null;
  }
};
