// Game flow, driven by server events. Owns the start screen (name entry ->
// connect), maze (re)build on each ROUND, the server-decided death overlay,
// and the round-over win overlay with its countdown to the next maze.
import { state } from './state.js';
import { net } from './net.js';
import { buildMaze, canvas } from './scene.js';
import { player, setMaze, spawnAtStart, markers } from './player.js';
import { scene } from './scene.js';
import { Sfx } from './audio.js';

var ovStart = document.getElementById('ovStart');
var ovDeath = document.getElementById('ovDeath');
var ovWin = document.getElementById('ovWin');
var flashEl = document.getElementById('flash');
var hintEl = document.getElementById('hint');
var nameInput = document.getElementById('nameInput');
var winTitle = document.getElementById('winTitle');
var countdownEl = document.getElementById('countdown');

function lockPointer(){
  try { var p = canvas.requestPointerLock(); if (p && p.catch) p.catch(function(){}); } catch (e) {}
}
function clearMarkers(){
  for (var i = 0; i < markers.length; i++) scene.remove(markers[i]);
  markers.length = 0;
}

function start(){
  var name = (nameInput.value || '').trim() || 'Anon';
  Sfx.init();
  net.connect(name);
  ovStart.classList.add('hide');
  lockPointer();
  setTimeout(function(){ hintEl.classList.add('fade'); }, 9000);
}
document.getElementById('startBtn').addEventListener('click', start);
nameInput.addEventListener('keydown', function(e){ if (e.code === 'Enter') start(); });

/* ---- Low / High graphics toggle (default Low on phones) ---- */
var gfxLow = document.getElementById('gfxLow');
var gfxHigh = document.getElementById('gfxHigh');
var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
               (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
function setQuality(q){
  state.quality = q;
  gfxLow.classList.toggle('on', q === 'low');
  gfxHigh.classList.toggle('on', q === 'high');
}
gfxLow.addEventListener('click', function(){ setQuality('low'); });
gfxHigh.addEventListener('click', function(){ setQuality('high'); });
setQuality(isMobile ? 'low' : 'high');

// New maze for a round (initial join or after a countdown).
net.on('round', function(){
  var maze = buildMaze(net.grid, net.treasureT);
  setMaze(maze);
  spawnAtStart(net.startT);
  clearMarkers();
  ovDeath.classList.add('hide');
  ovWin.classList.add('hide');
  state.phase = 'playing';
  if (document.pointerLockElement !== canvas) lockPointer();
});

// The server caught us: it already respawned us at start; show the overlay.
net.on('killed', function(){
  if (state.phase === 'over') return;   // round already ending
  state.phase = 'dead';
  spawnAtStart(net.startT);
  Sfx.sting();
  flashEl.style.opacity = 0.75;
  setTimeout(function(){ flashEl.style.opacity = 0; }, 180);
  if (document.exitPointerLock) document.exitPointerLock();
  setTimeout(function(){ ovDeath.classList.remove('hide'); }, 550);
});
document.getElementById('respawnBtn').addEventListener('click', function(){
  ovDeath.classList.add('hide');
  state.phase = 'playing';
  lockPointer();
});

// Someone reached the treasure: freeze into the win overlay + countdown.
net.on('roundOver', function(m){
  state.phase = 'over';
  var mine = m.winnerId === net.id;
  winTitle.textContent = mine ? 'The Heart of the Maze is yours'
                              : (m.winnerName || 'Someone') + ' claimed the Heart';
  ovDeath.classList.add('hide');
  ovWin.classList.remove('hide');
  if (document.exitPointerLock) document.exitPointerLock();
  Sfx.chime();
});

// Keep the countdown fresh while the win overlay is up.
net.on('state', function(){
  if (state.phase === 'over' && net.round.phase === 'countdown'){
    countdownEl.textContent = net.round.timeLeft;
  }
});

// Room-wide toast for "<name> has found the Torn Map!"
var toastEl = document.getElementById('toast');
var toastTimer = null;
net.on('relic', function(m){
  toastEl.textContent = (m.name || 'Someone') + ' has found the Torn Map!';
  toastEl.classList.remove('hide');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.add('hide'); }, 3200);
  Sfx.blip();
});

export function toggleMute(){
  if (!Sfx.master) return;
  Sfx.muted = !Sfx.muted;
  Sfx.master.gain.value = Sfx.muted ? 0 : 0.85;
  document.getElementById('mute').textContent = Sfx.muted ? '×' : '♪';
}
document.getElementById('mute').addEventListener('click', toggleMute);
