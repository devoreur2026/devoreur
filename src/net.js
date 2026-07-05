// Client networking. Opens the WebSocket, keeps the latest authoritative
// snapshot (players, eaters, round), and dispatches server events to hooks the
// rest of the client registers via net.on(type, fn).
import { MSG } from '../shared/protocol.js';

export var net = {
  ws: null,
  connected: false,
  id: 0,
  color: 0xffffff,

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

  _hooks: {},
  on: function(type, fn){ this._hooks[type] = fn; },
  _emit: function(type, m){ if (this._hooks[type]) this._hooks[type](m); },

  connect: function(name){
    var self = this;
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(proto + '://' + location.host + '/ws');
    this.ws.onopen = function(){
      self.connected = true;
      self.ws.send(JSON.stringify({ t: MSG.JOIN, name: name }));
    };
    this.ws.onmessage = function(ev){ self._recv(ev.data); };
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
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  },

  // find my own authoritative snapshot in the latest STATE
  self: function(){
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === this.id) return this.players[i];
    return null;
  }
};
