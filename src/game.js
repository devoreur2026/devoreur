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
var winTitle = document.getElementById('winTitle');
var countdownEl = document.getElementById('countdown');

function lockPointer(){
  try { var p = canvas.requestPointerLock(); if (p && p.catch) p.catch(function(){}); } catch (e) {}
}
function clearMarkers(){
  for (var i = 0; i < markers.length; i++) scene.remove(markers[i]);
  markers.length = 0;
}

// Called by the auth UI once signed in. `token` is the verified Supabase access
// token; the server derives the player name from it. The overlay stays up until
// the server admits us (the 'round' handler hides it) so a rejection can surface.
export function enterMaze(token){
  Sfx.init();
  lockPointer();                 // best-effort (we're inside the Enter click)
  net.connect(token);
  setTimeout(function(){ hintEl.classList.add('fade'); }, 9000);
}

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

// Show who we're signed in as, in-game.
net.on('welcome', function(){ document.getElementById('whoami').textContent = net.name ? '◈ ' + net.name : ''; });

// New maze for a round (initial join or after a countdown).
net.on('round', function(){
  var maze = buildMaze(net.grid, net.treasureT);
  setMaze(maze);
  spawnAtStart(net.startT);
  clearMarkers();
  ovStart.classList.add('hide');     // admitted -> leave the start/auth screen
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

export function toggleMute(){
  if (!Sfx.master) return;
  Sfx.muted = !Sfx.muted;
  Sfx.master.gain.value = Sfx.muted ? 0 : 0.85;
  document.getElementById('mute').textContent = Sfx.muted ? '×' : '♪';
}
document.getElementById('mute').addEventListener('click', toggleMute);
