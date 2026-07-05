// Procedural maze: carve a perfect maze, braid it for loops, then derive the
// spawn/treasure cells and the distance fields agents navigate along. Also
// exposes tile<->world coordinate helpers and collision/line-of-sight queries.
import { N, G, CS, PLAYER_R } from './config.js';

export var grid = new Uint8Array(G * G); grid.fill(1);
export function id(x, z){ return z * G + x; }

(function carve(){
  var st = [[1, 1]]; grid[id(1, 1)] = 0;
  var dirs = [[2,0],[-2,0],[0,2],[0,-2]];
  while (st.length){
    var c = st[st.length - 1], cx = c[0], cz = c[1], opts = [];
    for (var i = 0; i < 4; i++){
      var nx = cx + dirs[i][0], nz = cz + dirs[i][1];
      if (nx > 0 && nz > 0 && nx < G - 1 && nz < G - 1 && grid[id(nx, nz)] === 1) opts.push(dirs[i]);
    }
    if (!opts.length){ st.pop(); continue; }
    var d = opts[(Math.random() * opts.length) | 0];
    grid[id(cx + d[0] / 2, cz + d[1] / 2)] = 0;
    grid[id(cx + d[0], cz + d[1])] = 0;
    st.push([cx + d[0], cz + d[1]]);
  }
})();

/* braid: knock out ~10% of walls so keepers can circle and routes multiply */
(function braid(){
  var removed = 0, want = Math.floor(N * N * 0.10), tries = 0;
  while (removed < want && tries++ < 20000){
    var x = 1 + ((Math.random() * (G - 2)) | 0), z = 1 + ((Math.random() * (G - 2)) | 0);
    if (grid[id(x, z)] !== 1) continue;
    var h = grid[id(x - 1, z)] === 0 && grid[id(x + 1, z)] === 0;
    var v = grid[id(x, z - 1)] === 0 && grid[id(x, z + 1)] === 0;
    if (h !== v){ grid[id(x, z)] = 0; removed++; }
  }
})();

export function bfs(sx, sz){
  var d = new Int32Array(G * G); d.fill(-1);
  var q = new Int32Array(G * G), qs = 0, qe = 0;
  d[id(sx, sz)] = 0; q[qe++] = id(sx, sz);
  while (qs < qe){
    var c = q[qs++], cx = c % G, dv = d[c] + 1;
    if (cx > 0 && grid[c - 1] === 0 && d[c - 1] < 0){ d[c - 1] = dv; q[qe++] = c - 1; }
    if (cx < G - 1 && grid[c + 1] === 0 && d[c + 1] < 0){ d[c + 1] = dv; q[qe++] = c + 1; }
    if (c - G >= 0 && grid[c - G] === 0 && d[c - G] < 0){ d[c - G] = dv; q[qe++] = c - G; }
    if (c + G < G * G && grid[c + G] === 0 && d[c + G] < 0){ d[c + G] = dv; q[qe++] = c + G; }
  }
  return d;
}

export var startT = { x: 1, z: 1 };
export var dS = bfs(1, 1);
export var treasureT = { x: 1, z: 1 }, best = -1;
for (var tz0 = 1; tz0 < G; tz0 += 2) for (var tx0 = 1; tx0 < G; tx0 += 2){
  var v0 = dS[id(tx0, tz0)];
  if (v0 > best){ best = v0; treasureT = { x: tx0, z: tz0 }; }
}
export var tField = bfs(treasureT.x, treasureT.z);   // bots drift along this

export var HALF = (G - 1) / 2;
export function WX(t){ return (t - HALF) * CS; }
export function TX(w){ return Math.round(w / CS) + HALF; }
export function isWall(tx, tz){ return tx < 0 || tz < 0 || tx >= G || tz >= G || grid[id(tx, tz)] === 1; }
export function solidAt(x, z){ return isWall(TX(x), TX(z)); }
export function blocked(x, z){
  return solidAt(x - PLAYER_R, z - PLAYER_R) || solidAt(x + PLAYER_R, z - PLAYER_R) ||
         solidAt(x - PLAYER_R, z + PLAYER_R) || solidAt(x + PLAYER_R, z + PLAYER_R);
}
export function los(ax, az, bx, bz){
  var dx = bx - ax, dz = bz - az, dist = Math.sqrt(dx * dx + dz * dz);
  var steps = Math.ceil(dist / 1.2);
  for (var i = 1; i < steps; i++){
    var t = i / steps;
    if (solidAt(ax + dx * t, az + dz * t)) return false;
  }
  return true;
}
export function randOpenCell(minD, maxD){
  for (var i = 0; i < 800; i++){
    var x = 1 + 2 * ((Math.random() * N) | 0), z = 1 + 2 * ((Math.random() * N) | 0);
    var v = dS[id(x, z)];
    if (v >= minD && v <= maxD) return { x: x, z: z };
  }
  return { x: G - 2, z: G - 2 };
}
