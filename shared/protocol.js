// Wire protocol shared by client and server. All messages are JSON objects
// with a `t` (type) field. Kept in one place so both sides never disagree.
export var MSG = {
  // client -> server
  JOIN:     'join',      // { token }  Supabase access token; server verifies + derives the name
  INPUT:    'input',     // { cmds:[{ seq, dt, f, s, yaw, spd }] }  fixed-step inputs; server simulates
  SHOP:     'shop',      // { packs, nonce }   buy fireball packs (idempotent per nonce)
  TRANSFER: 'transfer',  // { amount, nonce }  earnings -> credit
  GRANT:    'grant',     // { nonce }          dev-only: add test Credit (UMBRA_DEV)
  HISTORY:  'history',   // { }                request ledger history
  THROW:    'throw',     // { id, x, z, yaw }  throw a fireball (server validates + simulates)

  // server -> client
  AUTH_ERROR: 'authError', // { message }  join rejected (missing/invalid/expired token)
  WELCOME:    'welcome',   // { id, color, name }
  ROUND:      'round',     // { seed, grid(base64), treasure:{x,z}, start:{x,z} }  (new maze)
  STATE:      'state',     // { time, players, eaters, fireballs, econ, round }
  KILLED:     'killed',    // { by }  -> caught; respawned at start
  ROUND_OVER: 'roundOver', // { winnerId, winnerName, pot, target, topup, paid, bonus, players:[{id,name,net}] }
  WALLET:     'wallet',    // { credit, earnings, fireballs }  (private, on change)
  SPECTATE:   'spectate',  // { reason }  you're not in this paid round
  HISTORY_DATA:'historyData', // { rows:[...] }  ledger rows for the wallet UI
  KILLFEED:   'killfeed',  // { text }  "X burned Y"
  FIREBALL:   'fb',        // { id, x, z, dx, dz, speed, range, owner }  a projectile was thrown
  FIREBALL_END:'fbEnd'     // { id, x, z, hit }  projectile expired/hit
};

// Round phases carried inside STATE.round.phase
export var PHASE = { PLAYING: 'playing', COUNTDOWN: 'countdown' };
