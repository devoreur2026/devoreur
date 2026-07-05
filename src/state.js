// Client-side UI/game phase. The authoritative game state lives on the server
// (see net.js); this only tracks what the local UI is doing.
//   'menu'      -> start screen, not connected/playing
//   'playing'   -> in the maze, controlling the player
//   'dead'      -> caught by an eater, death overlay up (awaiting respawn)
//   'over'      -> round won by someone, win overlay + countdown up
//
// `quality` drives the visual tier: 'high' enables post-processing (bloom +
// film grain + vignette) and the full particle/lighting budget; 'low' keeps
// the lighter look for phones (direct render, fewer lights/particles).
// `mapOpen` is true while the Torn Map carrier is reading the map — movement is
// locked (reading is a risk) and the overlay is shown.
export var state = { phase: 'menu', quality: 'high', mapOpen: false };
