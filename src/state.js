// Shared mutable game-flow state. A single object so every module reads the
// same live values (playing/ended/deaths/time) without circular wiring.
export var state = {
  playing: false,
  ended: false,
  deaths: 0,
  time: 0
};
