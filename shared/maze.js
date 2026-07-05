// Isomorphic maze: seeded generation (server) + grid-bound query helpers used
// by both sides. The server generates a maze from a seed and ships the grid to
// clients; the client wraps that grid with the same queries for local
// movement prediction. Coordinate helpers (WX/TX/HALF) are pure and static.
import { N, G, CS, PLAYER_R } from './config.js';
import { makePRNG } from './prng.js';

export var HALF = (G - 1) / 2;
export function id(x, z){ return z * G + x; }
export function WX(t){ return (t - HALF) * CS; }
export function TX(w){ return Math.round(w / CS) + HALF; }

// Wrap a grid (Uint8Array of length G*G, 1=wall 0=open) with query helpers.
export function createMaze(grid){
  function isWall(tx, tz){ return tx < 0 || tz < 0 || tx >= G || tz >= G || grid[id(tx, tz)] === 1; }
  function solidAt(x, z){ return isWall(TX(x), TX(z)); }
  function blocked(x, z){
    return solidAt(x - PLAYER_R, z - PLAYER_R) || solidAt(x + PLAYER_R, z - PLAYER_R) ||
           solidAt(x - PLAYER_R, z + PLAYER_R) || solidAt(x + PLAYER_R, z + PLAYER_R);
  }
  function los(ax, az, bx, bz){
    var dx = bx - ax, dz = bz - az, dist = Math.sqrt(dx * dx + dz * dz);
    var steps = Math.ceil(dist / 1.2);
    for (var i = 1; i < steps; i++){
      var t = i / steps;
      if (solidAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }
  function bfs(sx, sz){
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
  function neighbors(tx, tz){
    var r = [];
    if (!isWall(tx + 1, tz)) r.push([tx + 1, tz]);
    if (!isWall(tx - 1, tz)) r.push([tx - 1, tz]);
    if (!isWall(tx, tz + 1)) r.push([tx, tz + 1]);
    if (!isWall(tx, tz - 1)) r.push([tx, tz - 1]);
    return r;
  }
  // Pick a random open cell whose distance from the spawn field is in [minD,maxD].
  function randOpenCell(dS, minD, maxD, rnd){
    rnd = rnd || Math.random;
    for (var i = 0; i < 800; i++){
      var x = 1 + 2 * ((rnd() * N) | 0), z = 1 + 2 * ((rnd() * N) | 0);
      var v = dS[id(x, z)];
      if (v >= minD && v <= maxD) return { x: x, z: z };
    }
    return { x: G - 2, z: G - 2 };
  }
  return { grid: grid, id: id, WX: WX, TX: TX, HALF: HALF,
           isWall: isWall, solidAt: solidAt, blocked: blocked, los: los,
           bfs: bfs, neighbors: neighbors, randOpenCell: randOpenCell };
}

// Generate a fresh maze from a numeric seed. Returns the grid plus the derived
// spawn/treasure cells and distance fields the simulation needs.
export function generateMaze(seed){
  var rnd = makePRNG(seed);
  var grid = new Uint8Array(G * G); grid.fill(1);

  // recursive-backtracker carve
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
      var d = opts[(rnd() * opts.length) | 0];
      grid[id(cx + d[0] / 2, cz + d[1] / 2)] = 0;
      grid[id(cx + d[0], cz + d[1])] = 0;
      st.push([cx + d[0], cz + d[1]]);
    }
  })();

  // braid: knock out ~10% of walls so eaters can circle and routes multiply
  (function braid(){
    var removed = 0, want = Math.floor(N * N * 0.10), tries = 0;
    while (removed < want && tries++ < 20000){
      var x = 1 + ((rnd() * (G - 2)) | 0), z = 1 + ((rnd() * (G - 2)) | 0);
      if (grid[id(x, z)] !== 1) continue;
      var h = grid[id(x - 1, z)] === 0 && grid[id(x + 1, z)] === 0;
      var v = grid[id(x, z - 1)] === 0 && grid[id(x, z + 1)] === 0;
      if (h !== v){ grid[id(x, z)] = 0; removed++; }
    }
  })();

  var maze = createMaze(grid);
  var startT = { x: 1, z: 1 };
  var dS = maze.bfs(1, 1);
  var treasureT = { x: 1, z: 1 }, best = -1;
  for (var tz0 = 1; tz0 < G; tz0 += 2) for (var tx0 = 1; tx0 < G; tx0 += 2){
    var v0 = dS[id(tx0, tz0)];
    if (v0 > best){ best = v0; treasureT = { x: tx0, z: tz0 }; }
  }
  var tField = maze.bfs(treasureT.x, treasureT.z);
  return { grid: grid, maze: maze, dS: dS, tField: tField,
           startT: startT, treasureT: treasureT, best: best, rnd: rnd };
}
