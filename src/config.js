// Tunable constants for the whole game. Raise N for an even bigger maze.
export var N = 25;                 // maze cells per side
export var G = N * 2 + 1;          // tile grid (walls + corridors) -> 51x51
export var CS = 6, WH = 7;         // corridor size, wall height
export var EYE = 1.7, PLAYER_R = 0.6;
export var WALK = 5.4, SPRINT = 8.6;
export var KEEPER_COUNT = 4, BOT_COUNT = 3;
export var KILL_D = 1.35, SIGHT_D = 16, HEAR_D = 4.5;
