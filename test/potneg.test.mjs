// Reproduce a negative pot by fuzzing the real Room through the full round
// lifecycle: entries, kills, quits (abort/refund), wins, expiries, kick+newRound
// (rollover). A pot must NEVER go negative, and the ledger must stay balanced.
import { Room } from '../server/room.js';
import { Bank } from '../server/bank.js';
import { PHASE } from '../shared/protocol.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function mkws(){ return { readyState: 1, closed: false, send: function(){}, close: function(){ this.closed = true; this.readyState = 3; }, }; }

function negativePot(bank){
  for (var [k, v] of bank.ledger.bal){ if (k.indexOf('pot:') === 0 && v < 0) return k + '=' + v; }
  return null;
}
function totalZero(bank){ var s = 0, r = bank.ledger.rows; for (var i = 0; i < r.length; i++) s += r[i].amount; return s === 0; }

// deterministic PRNG so a failure is reproducible
var seed = 123456789;
function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(a){ return a[(rnd() * a.length) | 0]; }

var bank = new Bank();
var room = new Room('fz', bank); clearInterval(room.timer);
var accounts = ['A', 'B', 'C', 'D'];
accounts.forEach(function(a){ bank.grant(a, 1000000, 'g' + a); });   // deep pockets
var conns = {};   // account -> {player, ws}  currently in the room

function endStep(op){
  var neg = negativePot(bank);
  if (neg){ console.log('  ✗ NEGATIVE POT after ' + op + ' -> ' + neg); failed++; return false; }
  if (!bank.ledger.verifyIntegrity()){ console.log('  ✗ integrity broken after ' + op); failed++; return false; }
  if (!totalZero(bank)){ console.log('  ✗ total != 0 after ' + op); failed++; return false; }
  return true;
}

console.log('— fuzzing 4000 round-lifecycle operations for a negative pot');
var forced = 0;
for (var step = 0; step < 4000; step++){
  var op = pick(['join', 'join', 'kill', 'quit', 'quit', 'win', 'expire', 'tick', 'tick']);
  try {
    if (op === 'join'){
      var acc = pick(accounts);
      if (!conns[acc] && room.phase === PHASE.PLAYING){ var w = mkws(); conns[acc] = { player: room.addPlayer(acc, acc, w), ws: w }; }
    } else if (op === 'kill'){
      var keys = Object.keys(conns);
      if (keys.length){ var p = conns[pick(keys)].player; p.invuln = 0; p.eaterHitCd = 0; if (p.health > 0 && p.paid) room.hitByEater(p.id); }
    } else if (op === 'quit'){
      var ks = Object.keys(conns);
      if (ks.length){ var a2 = pick(ks); room.removePlayer(conns[a2].player.id); delete conns[a2]; }
    } else if (op === 'win'){
      var kk = Object.keys(conns).filter(function(a){ return conns[a].player.paid; });
      if (kk.length && room.phase === PHASE.PLAYING){ room.endRound(conns[pick(kk)].player); }
    } else if (op === 'expire'){
      if (room.phase === PHASE.PLAYING){ room.endRound(null); }
    } else if (op === 'tick'){
      if (room.phase === PHASE.COUNTDOWN){ room.countdown = 0.01; room.lastTick = Date.now() - 1000; }
      else { room.lastTick = Date.now() - 100; }
      room.tick();
      // kick empties the room -> forget our tracked players
      if (room.players.size === 0) conns = {};
    }
  } catch (e){
    console.log('  ✗ THREW on ' + op + ' at step ' + step + ': ' + e.message);
    failed++; break;
  }
  if (!endStep(op + '@' + step)){ break; }
}
ok(failed === 0, 'no negative pot / imbalance across 4000 ops');

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
