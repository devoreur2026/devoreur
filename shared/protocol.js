// Wire protocol shared by client and server. All messages are JSON objects
// with a `t` (type) field. Kept in one place so both sides never disagree.
export var MSG = {
  // client -> server
  JOIN:   'join',    // { name }
  INPUT:  'input',   // { cmds:[{ seq, dt, f, s, yaw, spd }] }  fixed-step inputs; server simulates

  // server -> client
  WELCOME:    'welcome',   // { id, color }
  ROUND:      'round',     // { seed, grid(base64), treasure:{x,z}, start:{x,z} }  (new maze)
  STATE:      'state',     // { time, players:[{...,ack}], eaters:[...], round:{phase,timeLeft,winner} }
  KILLED:     'killed',    // { }  -> you were caught; server respawned you at start
  ROUND_OVER: 'roundOver'  // { winnerId, winnerName }
};

// Round phases carried inside STATE.round.phase
export var PHASE = { PLAYING: 'playing', COUNTDOWN: 'countdown' };
