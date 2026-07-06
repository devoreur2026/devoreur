// Game flow, driven by server events. Owns the start screen (name entry ->
// connect), maze (re)build on each ROUND, the server-decided death overlay,
// and the round-over win overlay with its countdown to the next maze.
import { state } from './state.js';
import { net } from './net.js';
import { buildMaze, canvas } from './scene.js';
import { player, setMaze, spawnTo, markers } from './player.js';
import { scene } from './scene.js';
import { Sfx } from './audio.js';
import { clear as clearFireballs } from './fireballs.js';

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

// The server places us at a randomized spawn (join / round / respawn).
net.on('spawn', function(m){ spawnTo(m.x, m.z); });

// New maze for a round (initial join or after a countdown). Position comes from
// the SPAWN message the server sends alongside.
net.on('round', function(){
  var maze = buildMaze(net.grid, net.treasureT);
  setMaze(maze);
  clearMarkers();
  clearFireballs();
  ovStart.classList.add('hide');     // admitted -> leave the start/auth screen
  ovDeath.classList.add('hide');
  ovWin.classList.add('hide');
  state.phase = 'playing';
  if (document.pointerLockElement !== canvas) lockPointer();
});

// The server caught us: it already respawned us (SPAWN sets the new position).
net.on('killed', function(m){
  if (state.phase === 'over') return;   // round already ending
  document.getElementById('deathTitle').textContent =
    (m && m.by === 'fireball') ? (m.byName || 'Someone') + ' burned you' : 'A Darkness Eater found you';
  state.phase = 'dead';
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

// Round over: a win, OR the 10-minute limit with the pot rolling over.
net.on('roundOver', function(m){
  state.phase = 'over';
  var rollover = !m.winnerId && (m.rolled || 0) > 0;
  if (rollover){
    winTitle.textContent = 'The Heart keeps its treasure';
  } else {
    var mine = m.winnerId === net.id;
    winTitle.textContent = mine ? 'The Heart of the Maze is yours'
                                : (m.winnerName || 'Someone') + ' claimed the Heart';
  }
  // round summary: pot breakdown / rollover, and per-player net + entry paid
  var box = document.getElementById('summaryBox');
  if (m.players){
    var head = rollover
      ? 'No one reached the Heart — the pot grows to ' + m.rolled + ' CDF for the next round.'
      : 'Pot ' + (m.pot || 0) + (m.topup ? ' + ' + m.topup + ' bonus' : '') +
        ' → ' + (m.winnerName || '—') + ' won ' + (m.target || 0) + ' CDF';
    var rows = m.players.slice().sort(function(a, b){ return b.net - a.net; }).map(function(p){
      var me = p.id === net.id;
      var entry = p.entry ? ' <span style="color:#565b6e">· entry ' + p.entry + '</span>' : '';
      return '<div class="' + (me ? 'me' : '') + '">' + (me ? '▸ ' : '') + p.name + entry + ' &nbsp; ' +
             (p.net >= 0 ? '+' : '') + p.net + '</div>';
    }).join('');
    box.innerHTML = '<div style="color:var(--gold);margin-bottom:8px">' + head + '</div>' + rows;
  } else box.innerHTML = '';
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
