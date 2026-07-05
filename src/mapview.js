// The Torn Map overlay. Only the relic carrier can open it: hold M (or hold the
// on-screen MAP button on touch). While it's open, movement is locked
// (state.mapOpen) — reading is a risk. It draws a top-down view of the actual
// maze walls, the carrier's own position + facing, and the Heart of the Maze
// in gold. All "who carries it" truth comes from the server snapshot (net.map).
import { G } from '../shared/config.js';
import { TX } from '../shared/maze.js';
import { net } from './net.js';
import { state } from './state.js';
import { player } from './player.js';

var canvas = document.getElementById('mapCanvas');
var ctx = canvas.getContext('2d');
var btn = document.getElementById('mapBtn');
var tag = document.getElementById('relicTag');

function isCarrier(){ return net.id !== 0 && net.map && net.map.c === net.id; }

function resize(){
  var s = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.82);
  canvas.width = canvas.height = s;
}
function open(){
  if (!isCarrier() || state.phase !== 'playing') return;
  state.mapOpen = true;
  resize();
  canvas.classList.remove('hide');
}
function close(){
  state.mapOpen = false;
  canvas.classList.add('hide');
}

document.addEventListener('keydown', function(e){ if (e.code === 'KeyM' && !e.repeat) open(); });
document.addEventListener('keyup', function(e){ if (e.code === 'KeyM') close(); });
btn.addEventListener('pointerdown', function(e){ e.preventDefault(); open(); });
btn.addEventListener('pointerup', close);
btn.addEventListener('pointerleave', close);
window.addEventListener('blur', close);
window.addEventListener('resize', function(){ if (state.mapOpen) resize(); });

function draw(){
  var g = net.grid; if (!g) return;
  var s = canvas.width, cell = s / G;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(6,8,13,0.97)'; ctx.fillRect(0, 0, s, s);

  // open corridors drawn light (parchment); walls stay dark
  ctx.fillStyle = '#b9ad86';
  for (var z = 0; z < G; z++) for (var x = 0; x < G; x++){
    if (g[z * G + x] === 0) ctx.fillRect(x * cell, z * cell, cell + 0.6, cell + 0.6);
  }
  ctx.strokeStyle = 'rgba(255,206,107,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, s - 2, s - 2);

  // Heart of the Maze (gold)
  var tt = net.treasureT;
  if (tt){
    var gx = tt.x * cell + cell / 2, gy = tt.z * cell + cell / 2, r = Math.max(4, cell * 0.9);
    ctx.fillStyle = '#ffce6b'; ctx.beginPath(); ctx.arc(gx, gy, r * 0.55, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,206,107,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(gx, gy, r, 0, 6.283); ctx.stroke();
  }

  // the carrier's own position + facing (cyan)
  var cx = TX(player.x) * cell + cell / 2, cy = TX(player.z) * cell + cell / 2;
  var L = cell * 1.8;
  ctx.strokeStyle = '#5ef2ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - Math.sin(player.yaw) * L, cy - Math.cos(player.yaw) * L); ctx.stroke();
  ctx.fillStyle = '#5ef2ff'; ctx.beginPath(); ctx.arc(cx, cy, Math.max(2.5, cell * 0.55), 0, 6.283); ctx.fill();

  // title
  ctx.fillStyle = 'rgba(255,206,107,0.92)';
  ctx.font = '600 ' + Math.round(s * 0.032) + 'px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THE TORN MAP', s / 2, s * 0.062);
}

export function update(){
  var carrier = isCarrier();
  if (carrier && state.phase === 'playing') btn.classList.remove('hide'); else btn.classList.add('hide');
  tag.classList.toggle('hide', !(carrier && state.phase === 'playing' && !state.mapOpen));
  if (state.mapOpen && (!carrier || state.phase !== 'playing')) close();   // lost the map / round ended
  if (state.mapOpen) draw();
}
