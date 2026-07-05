// Authoritative per-player state. The client sends INPUT commands (not
// positions); the server re-simulates each one with the shared movement step,
// so a client can never teleport — it can only ask to move. Validation is
// latency-tolerant: each command is a small fixed step, speed is clamped to
// SPRINT (anti speed-hack), collision is resolved by the movement step
// (anti wall-clip), and a per-player time budget bounds total movement to real
// elapsed time (+ a little slack for jitter/batched packets). Nothing is
// "rejected" for lag — only clamped. Teleports are structurally impossible.
import { SPRINT, RESPAWN_INVULN, MAX_CMD_DT, MOVE_BUDGET_MAX, INPUT_STEP } from '../shared/config.js';
import { moveStep } from '../shared/movement.js';

var PALETTE = [
  0x63d6ff, 0xff8f5e, 0xc07bff, 0x6ee7a8, 0xffd166, 0xff6b9d,
  0x8ab4ff, 0xffa8f0, 0x9be15d, 0xff5c5c, 0x5ef2ff, 0xd7a642
];

function num(v, def){ return (typeof v === 'number' && isFinite(v)) ? v : def; }
function clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }

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
    this.lastSeq = 0;        // last input sequence processed (acked to the client)
    this.budget = INPUT_STEP;
    this.lastInputT = 0;     // real time of the last INPUT packet
    this.tile = -1;          // grid id of current tile (for field caching)
    this.field = null;       // BFS distance field from this player's tile
    this.fieldT = 0;
  }

  spawnAt(wx, wz){
    this.x = wx; this.z = wz; this.speed = 0;
    this.invuln = RESPAWN_INVULN;
    this.budget = INPUT_STEP;
    this.tile = -1; this.field = null; this.fieldT = 0;
  }

  // Process a batch of client input commands in order. `now` = seconds.
  applyCommands(maze, cmds, now){
    // credit the movement budget with the real time elapsed since the last
    // packet (capped) — this tolerates jitter and batched packets without
    // letting a client warp time to move faster than real.
    if (this.lastInputT) this.budget = Math.min(MOVE_BUDGET_MAX, this.budget + (now - this.lastInputT));
    this.lastInputT = now;

    var moved = false, maxSpeed = 0;
    for (var i = 0; i < cmds.length; i++){
      var c = cmds[i];
      var seq = num(c.seq, 0);
      if (seq <= this.lastSeq) continue;                 // stale or duplicate

      var dt = clamp(num(c.dt, 0), 0, MAX_CMD_DT);       // clamp per-step dt
      this.yaw = num(c.yaw, this.yaw);
      var allowed = Math.min(dt, this.budget);
      if (allowed > 0){
        var spd = clamp(num(c.spd, 0), 0, SPRINT);       // clamp speed (anti speed-hack)
        var np = moveStep(maze, this.x, this.z,
          { f: clamp(num(c.f, 0), -2, 2), s: clamp(num(c.s, 0), -2, 2), yaw: this.yaw, spd: spd, dt: allowed });
        var d = Math.sqrt((np.x - this.x) * (np.x - this.x) + (np.z - this.z) * (np.z - this.z));
        maxSpeed = Math.max(maxSpeed, d / allowed);
        this.x = np.x; this.z = np.z;
        this.budget -= allowed;
        moved = true;
      }
      this.lastSeq = seq;                                // always ack (even if budget-clamped)
    }
    if (moved) this.speed = maxSpeed; else this.speed = 0;
  }

  snapshot(){
    return {
      id: this.id, name: this.name, color: this.color,
      x: +this.x.toFixed(3), z: +this.z.toFixed(3), yaw: +this.yaw.toFixed(3),
      deaths: this.deaths, invuln: this.invuln > 0 ? 1 : 0,
      ack: this.lastSeq                                   // last input the client can prune/replay from
    };
  }
}
