// Grid-walking agent movement shared by Darkness Eaters and bots: each agent
// steps tile-to-tile, and a `pick` callback chooses the next tile on arrival.
import { isWall, WX, id } from './maze.js';

export function makeAgent(tx, tz, speed){
  return { tx: tx, tz: tz, ttx: tx, ttz: tz, from: -1,
           px: WX(tx), pz: WX(tz), dirx: 0, dirz: 1, speed: speed, idle: 0 };
}
export function neighbors(tx, tz){
  var r = [];
  if (!isWall(tx + 1, tz)) r.push([tx + 1, tz]);
  if (!isWall(tx - 1, tz)) r.push([tx - 1, tz]);
  if (!isWall(tx, tz + 1)) r.push([tx, tz + 1]);
  if (!isWall(tx, tz - 1)) r.push([tx, tz - 1]);
  return r;
}
export function pickPatrol(a){
  var ns = neighbors(a.tx, a.tz), opts = [];
  for (var i = 0; i < ns.length; i++) if (id(ns[i][0], ns[i][1]) !== a.from) opts.push(ns[i]);
  if (!opts.length) opts = ns;
  var p = opts[(Math.random() * opts.length) | 0];
  a.ttx = p[0]; a.ttz = p[1];
}
export function agentStep(a, dt, pick){
  if (a.idle > 0){ a.idle -= dt; return; }
  var gx = WX(a.ttx), gz = WX(a.ttz);
  var dx = gx - a.px, dz = gz - a.pz, d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.12){
    a.px = gx; a.pz = gz;
    var cur = id(a.tx, a.tz), nxt = id(a.ttx, a.ttz);
    if (cur !== nxt) a.from = cur;
    a.tx = a.ttx; a.tz = a.ttz;
    pick(a);
  } else {
    var mv = Math.min(d, a.speed * dt);
    a.px += dx / d * mv; a.pz += dz / d * mv;
    a.dirx = dx / d; a.dirz = dz / d;
  }
}
