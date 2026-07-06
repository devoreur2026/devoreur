// Constants shared by the authoritative server and the browser client.
// This file is isomorphic: pure data, no Node- or browser-specific APIs.
export var N = 41;                 // maze cells per side (bigger, harder mazes)
export var G = N * 2 + 1;          // tile grid (walls + corridors) -> 83x83
export var CS = 6, WH = 7;         // corridor size, wall height
export var EYE = 1.7, PLAYER_R = 0.6;
export var WALK = 5.4, SPRINT = 8.6;
export var KEEPER_COUNT = 4;
export var EATER_ADD_INTERVAL = 300;   // seconds: a new eater joins the hunt every 5 min
export var MAX_EATERS = 12;            // ...but cap the swarm so a 1-hour round stays winnable
export var KILL_D = 1.35, SIGHT_D = 16, HEAR_D = 4.5;
export var EATER_PATROL = 3.1, EATER_CHASE = 6.6;

// --- multiplayer / server ---
export var TICK_HZ = 20;                 // authoritative broadcast rate
export var TICK_DT = 1 / TICK_HZ;
export var MAX_PLAYERS = 12;             // per room
export var WIN_DIST = 2.0;               // reach the treasure within this
export var RESPAWN_INVULN = 3;           // seconds of grace after (re)spawn
export var ROUND_COUNTDOWN = 10;         // seconds between rounds
// health & damage (server-authoritative; full on spawn/respawn, no regen)
export var MAX_HEALTH = 6;               // full health
export var FIREBALL_DAMAGE = 2;          // 1/3 of max -> 3 fireball hits kill
export var EATER_DAMAGE = 3;             // 1/2 of max -> 2 eater contacts kill
export var EATER_HIT_INTERVAL = 1.0;     // min seconds between eater contact hits (contact is continuous)
// randomized spawns (open, public map): far from the Heart and from other players
export var SPAWN_HEART_FRAC = 0.45;      // spawn at least this fraction of the treasure BFS depth away
export var SPAWN_MIN_PLAYER_DIST = 14;   // world units from any active player
export var FIELD_REFRESH = 0.35;         // how often a player's chase field is rebuilt

// --- input / prediction ---
export var INPUT_HZ = 60;                // fixed input timestep rate
export var INPUT_STEP = 1 / INPUT_HZ;    // seconds per input command
export var MAX_CMD_DT = 0.05;            // server clamps any single input's dt to this
export var MOVE_BUDGET_MAX = 0.4;        // accumulated movement-time tolerance (jitter/batching)
