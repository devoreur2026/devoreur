// Wire protocol shared by client and server. All messages are JSON objects
// with a `t` (type) field. Kept in one place so both sides never disagree.
export var MSG = {
  // client -> server
  JOIN:   'join',    // { token }  Supabase access token; server verifies + derives the name
  INPUT:  'input',   // { cmds:[{ seq, dt, f, s, yaw, spd }] }  fixed-step inputs; server simulates

  // server -> client
  AUTH_ERROR: 'authError', // { message }  join rejected (missing/invalid/expired token)
  WELCOME:    'welcome',   // { id, color, name }
  ROUND:      'round',     // { seed, grid(base64), treasure:{x,z}, start:{x,z} }  (new maze)
  STATE:      'state',     // { time, players:[{...,ack}], eaters:[...], round:{...} }
  KILLED:     'killed',    // { }  -> you were caught; server respawned you at start
  ROUND_OVER: 'roundOver'  // { winnerId, winnerName }
};

// Round phases carried inside STATE.round.phase
export var PHASE = { PLAYING: 'playing', COUNTDOWN: 'countdown' };
