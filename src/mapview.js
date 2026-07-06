// Always-on minimap HUD (bottom-left): a top-down view of the real maze walls,
// your own position + facing, and the Heart of the Maze in gold. Drawn every
// round from the server-sent grid. The static maze (walls + treasure) is cached
// to an offscreen canvas per round and re-blitted each frame; only the player
// marker is redrawn live.
import { G } from '../shared/config.js';
import { TX } from '../shared/maze.js';
import { net } from './net.js';
import { state } from './state.js';
import { player } from './player.js';

var canvas = document.getElementById('mapCanvas');
var ctx = canvas.getContext('2d');

var cacheCanvas = document.createElement('canvas');
var cachedGrid = null, cachedSize = 0, cachedTreasure = null;

function targetSize(){
  var vw = window.innerWidth, vh = window.innerHeight;
  var s = Math.round(Math.min(vw, vh) * 0.24);
  // phones: a much smaller minimap so it doesn't dominate the screen
  var phone = vw <= 640 || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  return phone ? Math.max(92, Math.min(132, s)) : Math.max(150, Math.min(230, s));
}

// Bake the walls + treasure marker (static for the round) into an offscreen canvas.
function buildStatic(s){
  cacheCanvas.width = cacheCanvas.height = s;
  var c = cacheCanvas.getContext('2d');
  var g = net.grid, cell = s / G;
  c.clearRect(0, 0, s, s);
  c.fillStyle = 'rgba(6,8,13,0.82)'; c.fillRect(0, 0, s, s);
  c.fillStyle = '#b4ad86';                                  // corridors (parchment)
  for (var z = 0; z < G; z++) for (var x = 0; x < G; x++){
    if (g[z * G + x] === 0) c.fillRect(x * cell, z * cell, cell + 0.6, cell + 0.6);
  }
  var tt = net.treasureT;                                   // Heart of the Maze (gold)
  if (tt){
    var gx = tt.x * cell + cell / 2, gy = tt.z * cell + cell / 2, r = Math.max(3, cell * 0.9);
    c.fillStyle = '#ffce6b'; c.beginPath(); c.arc(gx, gy, r * 0.55, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(255,206,107,0.7)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(gx, gy, r, 0, 6.283); c.stroke();
  }
  cachedGrid = net.grid; cachedSize = s; cachedTreasure = tt;
}

export function update(){
  if (!net.grid || state.phase === 'menu'){ canvas.classList.add('hide'); return; }
  canvas.classList.remove('hide');

  var s = targetSize();
  if (canvas.width !== s){ canvas.width = canvas.height = s; }
  if (net.grid !== cachedGrid || cachedSize !== s || net.treasureT !== cachedTreasure) buildStatic(s);

  var cell = s / G;
  ctx.clearRect(0, 0, s, s);
  ctx.drawImage(cacheCanvas, 0, 0);

  // live player marker + facing (cyan)
  var cx = TX(player.x) * cell + cell / 2, cy = TX(player.z) * cell + cell / 2;
  var L = cell * 2.0;
  ctx.strokeStyle = '#5ef2ff'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - Math.sin(player.yaw) * L, cy - Math.cos(player.yaw) * L); ctx.stroke();
  ctx.fillStyle = '#5ef2ff'; ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, cell * 0.6), 0, 6.283); ctx.fill();
}
