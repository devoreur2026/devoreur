// Client-side UI/game phase. The authoritative game state lives on the server
// (see net.js); this only tracks what the local UI is doing.
//   'menu'      -> start screen, not connected/playing
//   'playing'   -> in the maze, controlling the player
//   'dead'      -> caught by an eater, death overlay up (awaiting respawn)
//   'over'      -> round won by someone, win overlay + countdown up
export var state = { phase: 'menu' };
