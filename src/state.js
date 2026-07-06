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
// uiBusy is true while a full-screen UI (the wallet) is open — movement and
// throwing are locked so you're not driving blind behind the overlay.
export var state = { phase: 'menu', quality: 'high', uiBusy: false };
