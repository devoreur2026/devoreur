// One active session per account. A new join TAKES OVER: any existing session
// for that account is displaced (its player removed, its socket closed), so a
// stale reconnect can't leave a duplicate "you" in the maze, and opening a
// second device/browser ends the first. Single-threaded server => no races.

export function makeSessions(){ return new Map(); }   // account -> { ws, room, player }

// Register `session` for `account`, displacing any existing one via displace(prev).
export function claimSession(sessions, account, session, displace){
  var prev = sessions.get(account);
  if (prev && prev.ws !== session.ws && displace) displace(prev);
  sessions.set(account, session);
  return session;
}

// On socket close, release the session ONLY if this ws is still the active one.
// A displaced socket closing later must NOT remove the new player. Returns the
// released session (so the caller can remove its player) or null.
export function releaseSession(sessions, account, ws){
  var cur = sessions.get(account);
  if (cur && cur.ws === ws){ sessions.delete(account); return cur; }
  return null;
}

export var DISPLACED_CODE = 4001;   // WebSocket close code: "playing elsewhere now"
