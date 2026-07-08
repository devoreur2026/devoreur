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
  c.fillStyle = '#9a90c2';                                  // corridors (soft lavender)
  for (var z = 0; z < G; z++) for (var x = 0; x < G; x++){
    if (g[z * G + x] === 0) c.fillRect(x * cell, z * cell, cell + 0.6, cell + 0.6);
  }
  // Heart of the Maze is drawn live in update() (glowy + blinky), not baked here.
  cachedGrid = net.grid; cachedSize = s; cachedTreasure = net.treasureT;
}

// Live, animated Heart of the Maze marker: a pulsing lime glow that blinks.
function drawTreasure(ctx, cell, t){
  var tt = net.treasureT;
  if (!tt) return;
  var gx = tt.x * cell + cell / 2, gy = tt.z * cell + cell / 2;
  var r = Math.max(3, cell * 0.9);
  // pulse: 0..1 breathing, plus a faster blink flicker on the core
  var pulse = 0.5 + 0.5 * Math.sin(t * 0.006);            // slow breathe
  var blink = 0.55 + 0.45 * Math.sin(t * 0.013);          // faster blink
  var glowR = r * (1.7 + pulse * 1.3);

  ctx.save();
  // outer glow halo
  var grad = ctx.createRadialGradient(gx, gy, r * 0.2, gx, gy, glowR);
  grad.addColorStop(0, 'rgba(182,255,58,' + (0.55 * blink).toFixed(3) + ')');
  grad.addColorStop(0.5, 'rgba(182,255,58,' + (0.22 * blink).toFixed(3) + ')');
  grad.addColorStop(1, 'rgba(182,255,58,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(gx, gy, glowR, 0, 6.283); ctx.fill();

  // pulsing ring
  ctx.strokeStyle = 'rgba(182,255,58,' + (0.5 + 0.5 * pulse).toFixed(3) + ')';
  ctx.lineWidth = 1.5 + pulse;
  ctx.beginPath(); ctx.arc(gx, gy, r * (1.0 + pulse * 0.35), 0, 6.283); ctx.stroke();

  // bright blinking core
  ctx.globalAlpha = 0.6 + 0.4 * blink;
  ctx.fillStyle = '#eaffb0';
  ctx.beginPath(); ctx.arc(gx, gy, r * (0.5 + 0.12 * pulse), 0, 6.283); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#b6ff3a';
  ctx.beginPath(); ctx.arc(gx, gy, r * 0.34, 0, 6.283); ctx.fill();
  ctx.restore();
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

  // live Heart of the Maze marker (glowy + blinky)
  drawTreasure(ctx, cell, (typeof performance !== 'undefined' ? performance.now() : 0));

  // live player marker + facing (cyan)
  var cx = TX(player.x) * cell + cell / 2, cy = TX(player.z) * cell + cell / 2;
  var L = cell * 2.0;
  ctx.strokeStyle = '#5ef2ff'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - Math.sin(player.yaw) * L, cy - Math.cos(player.yaw) * L); ctx.stroke();
  ctx.fillStyle = '#5ef2ff'; ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, cell * 0.6), 0, 6.283); ctx.fill();
}
