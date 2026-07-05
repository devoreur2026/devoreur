// Server-side grid-walking movement, reused from the original client agents.js.
// Now parameterized by a maze instance and a seeded rng so the simulation is
// deterministic and lives entirely on the authoritative server.
export function makeAgent(maze, tx, tz, speed){
  return { tx: tx, tz: tz, ttx: tx, ttz: tz, from: -1,
           px: maze.WX(tx), pz: maze.WX(tz), dirx: 0, dirz: 1, speed: speed, idle: 0 };
}
export function pickPatrol(maze, rnd, a){
  var ns = maze.neighbors(a.tx, a.tz), opts = [];
  for (var i = 0; i < ns.length; i++) if (maze.id(ns[i][0], ns[i][1]) !== a.from) opts.push(ns[i]);
  if (!opts.length) opts = ns;
  var p = opts[(rnd() * opts.length) | 0];
  a.ttx = p[0]; a.ttz = p[1];
}
export function agentStep(maze, a, dt, pick){
  if (a.idle > 0){ a.idle -= dt; return; }
  var gx = maze.WX(a.ttx), gz = maze.WX(a.ttz);
  var dx = gx - a.px, dz = gz - a.pz, d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.12){
    a.px = gx; a.pz = gz;
    var cur = maze.id(a.tx, a.tz), nxt = maze.id(a.ttx, a.ttz);
    if (cur !== nxt) a.from = cur;
    a.tx = a.ttx; a.tz = a.ttz;
    pick(a);
  } else {
    var mv = Math.min(d, a.speed * dt);
    a.px += dx / d * mv; a.pz += dz / d * mv;
    a.dirx = dx / d; a.dirz = dz / d;
  }
}
