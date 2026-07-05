// The single, deterministic movement step shared by client prediction, client
// replay, and the server simulation. Given a position and an input command it
// returns the next position, resolving wall collision the same way on both
// sides. Because it's identical everywhere, the client can replay its own
// unacknowledged inputs and land exactly where the server will.
//
// cmd = { dt, f, s, yaw, spd }
//   f  = forward axis  (-1..1, + is forward)
//   s  = strafe axis   (-1..1, + is right)
//   yaw= look yaw at the time of the input
//   spd= speed for this step (walk/sprint/0). The server clamps this to SPRINT.
export function moveStep(maze, x, z, cmd){
  var f = cmd.f, s = cmd.s;
  var len = Math.sqrt(f * f + s * s);
  if (len > 0.0001){
    var inv = 1 / Math.max(1, len), fx = f * inv, sx = s * inv;
    var sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
    var dx = (-sin * fx + cos * sx) * cmd.spd * cmd.dt;
    var dz = (-cos * fx - sin * sx) * cmd.spd * cmd.dt;
    var nx = x + dx; if (!maze.blocked(nx, z)) x = nx;   // axis-separated: slide along walls
    var nz = z + dz; if (!maze.blocked(x, nz)) z = nz;
  }
  return { x: x, z: z };
}
