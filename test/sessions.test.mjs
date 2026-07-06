// One-session-per-account: takeover on a new join, no duplicate on reconnect,
// and a displaced socket's later close is a no-op.
import { makeSessions, claimSession, releaseSession } from '../server/sessions.js';

var passed = 0, failed = 0;
function ok(c, m){ if (c) passed++; else { failed++; console.log('  ✗ ' + m); } }
function eq(a, b, m){ ok(a === b, m + '  (got ' + a + ', want ' + b + ')'); }

// a fake room that tracks its players by id
function room(){ return { players: new Set(), removePlayer: function(id){ this.players.delete(id); } }; }
function sess(ws, room, id){ return { ws: ws, room: room, player: { id: id } }; }

console.log('— second device takes over; the first is displaced exactly once');
{
  var S = makeSessions();
  var r = room(); r.players.add(1); r.players.add(2);
  var displaced = [];
  claimSession(S, 'A', sess('ws1', r, 1), function(prev){ displaced.push(prev); r.removePlayer(prev.player.id); prev.closed = true; });
  eq(displaced.length, 0, 'first join displaces nobody');
  claimSession(S, 'A', sess('ws2', r, 2), function(prev){ displaced.push(prev); r.removePlayer(prev.player.id); prev.ws = prev.ws; });
  eq(displaced.length, 1, 'second join displaces the first');
  eq(displaced[0].ws, 'ws1', 'the FIRST session was displaced');
  eq(r.players.has(1), false, 'first player removed from the room (no duplicate)');
  eq(r.players.has(2), true, 'second player remains');
  eq(S.get('A').ws, 'ws2', 'the active session is now ws2');
}

console.log('— a displaced socket closing later does NOT remove the new player');
{
  var S = makeSessions();
  var r = room(); r.players.add(1); r.players.add(2);
  claimSession(S, 'A', sess('ws1', r, 1), function(){});
  claimSession(S, 'A', sess('ws2', r, 2), function(prev){ r.removePlayer(prev.player.id); });   // ws1 displaced
  // ws1 (old) close fires late
  var rel1 = releaseSession(S, 'A', 'ws1');
  eq(rel1, null, 'displaced ws1 close releases nothing');
  eq(r.players.has(2), true, 'new player (2) untouched by the old close');
  eq(S.has('A'), true, 'session still active (ws2)');
  // ws2 (current) close fires
  var rel2 = releaseSession(S, 'A', 'ws2');
  ok(rel2 && rel2.ws === 'ws2', 'current ws2 close releases its session');
  eq(S.has('A'), false, 'account no longer has an active session');
}

console.log('— clean reconnect: drop releases, rejoin is a plain claim (no duplicate)');
{
  var S = makeSessions();
  var r = room(); r.players.add(1);
  claimSession(S, 'A', sess('ws1', r, 1), function(){});
  releaseSession(S, 'A', 'ws1'); r.removePlayer(1);        // socket dropped, cleaned up
  var displaced = 0;
  claimSession(S, 'A', sess('ws2', r, 2), function(){ displaced++; });   // rejoin
  eq(displaced, 0, 'rejoin after a clean drop displaces nobody');
  eq(r.players.size, 0, 'old player gone before rejoin adds the new one');
}

console.log('\n' + (failed === 0 ? '=== PASS ===' : '=== FAIL ===') + '  ' + passed + ' checks passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
