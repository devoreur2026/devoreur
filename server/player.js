// Authoritative per-player state. The client sends where it *thinks* it is;
// this validates the move (speed cap + wall/path collision) before accepting.
// A rejected move leaves the server position unchanged, so cheats and lag
// spikes get snapped back on the next broadcast.
import { SPRINT, MOVE_TOLERANCE, RESPAWN_INVULN, PLAYER_R } from '../shared/config.js';

var PALETTE = [
  0x63d6ff, 0xff8f5e, 0xc07bff, 0x6ee7a8, 0xffd166, 0xff6b9d,
  0x8ab4ff, 0xffa8f0, 0x9be15d, 0xff5c5c, 0x5ef2ff, 0xd7a642
];

export class ServerPlayer {
  constructor(id, name, colorIndex, ws){
    this.id = id;
    this.name = name;
    this.color = PALETTE[colorIndex % PALETTE.length];
    this.ws = ws;
    this.x = 0; this.z = 0; this.yaw = 0;
    this.deaths = 0;
    this.invuln = RESPAWN_INVULN;
    this.speed = 0;          // server-measured, used for eater hearing
    this.lastInputT = 0;
    this.tile = -1;          // grid id of current tile (for field caching)
    this.field = null;       // BFS distance field from this player's tile
    this.fieldT = 0;
  }

  spawnAt(wx, wz){
    this.x = wx; this.z = wz; this.speed = 0;
    this.invuln = RESPAWN_INVULN;
    this.tile = -1; this.field = null; this.fieldT = 0;
  }

  // Validate a client-proposed position. Returns true if accepted.
  applyInput(maze, reqX, reqZ, reqYaw, now){
    this.yaw = reqYaw;                       // look direction isn't exploitable
    var dt = Math.min(0.5, Math.max(0.001, now - this.lastInputT));
    this.lastInputT = now;

    var dx = reqX - this.x, dz = reqZ - this.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var allowed = SPRINT * dt * MOVE_TOLERANCE + 0.05;
    if (dist > allowed){ this.speed = 0; return false; }         // speed cheat

    // sample the whole segment so you can't tunnel through a wall in one step
    var steps = Math.max(1, Math.ceil(dist / (PLAYER_R * 0.75)));
    for (var i = 1; i <= steps; i++){
      var f = i / steps;
      if (maze.blocked(this.x + dx * f, this.z + dz * f)){ this.speed = 0; return false; }
    }

    this.x = reqX; this.z = reqZ;
    this.speed = dist / dt;
    return true;
  }

  snapshot(){
    return {
      id: this.id, name: this.name, color: this.color,
      x: +this.x.toFixed(3), z: +this.z.toFixed(3), yaw: +this.yaw.toFixed(3),
      deaths: this.deaths, invuln: this.invuln > 0 ? 1 : 0
    };
  }
}
