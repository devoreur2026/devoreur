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

/* ---- first-run controls coach: once per device, shows how to move/look ---- */
var COACH_KEY = 'devoreur.coached';
function showCoachIfFirstTime(){
  try { if (localStorage.getItem(COACH_KEY)) return false; } catch (e) { return false; }
  var ov = document.getElementById('ovCoach');
  if (!ov) return false;
  document.getElementById('coachMob').classList.toggle('hide', !isMobile);   // phone: on-screen drag
  document.getElementById('coachDesk').classList.toggle('hide', isMobile);   // laptop: keys + mouse
  ov.classList.remove('hide');
  state.uiBusy = true;                                   // freeze movement while it reads
  if (document.exitPointerLock) document.exitPointerLock();
  return true;
}
(function(){
  var btn = document.getElementById('coachBtn');
  if (!btn) return;
  function ready(){
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {}
    document.getElementById('ovCoach').classList.add('hide');
    state.uiBusy = false;
    lockPointer();                                       // gesture-driven -> re-locks on desktop
  }
  btn.addEventListener('click', ready);
  btn.addEventListener('touchend', function(e){ e.preventDefault(); ready(); });
})();

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
  if (showCoachIfFirstTime()) return;                    // first time: teach controls, coach locks after "Prêt"
  if (document.pointerLockElement !== canvas) lockPointer();
});

// The server caught us: it already respawned us (SPAWN sets the new position).
var reviveArmed = 0;   // price to buy 4 more lives, when out of lives
net.on('killed', function(m){
  if (state.phase === 'over') return;   // round already ending
  var out = !!(m && m.out);
  var lives = m && typeof m.lives === 'number' ? m.lives : 0;
  document.getElementById('deathTitle').textContent =
    (m && m.by === 'fireball') ? (m.byName || 'Quelqu\'un') + ' vous a brûlé' : 'Un Dévoreur de Lumière vous a trouvé';
  var dl = document.getElementById('deathLives');
  var rb = document.getElementById('respawnBtn');
  var rv = document.getElementById('reviveBtn');
  document.getElementById('reviveMsg').textContent = '';
  reviveArmed = out ? (m.price || 1000) : 0;
  if (out){
    dl.textContent = "Vous n'avez plus de vies";
    rb.textContent = 'Observer';                 // roam as a ghost for the rest of the round
    rb.classList.remove('hide');
    rv.textContent = 'Payer ' + (m.price || 1000) + ' pour 4 vies de plus';
    rv.classList.remove('hide');
  } else {
    dl.textContent = '♥ ' + lives + (lives === 1 ? ' VIE RESTANTE' : ' VIES RESTANTES');
    rb.textContent = 'Renaître';
    rb.classList.remove('hide');
    rv.classList.add('hide');
  }
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
document.getElementById('reviveBtn').addEventListener('click', function(){
  var price = reviveArmed || 1000;
  var credit = (net.wallet && net.wallet.credit) || 0;
  if (credit < price){
    document.getElementById('reviveMsg').textContent = 'Crédit insuffisant — ajoutez des fonds dans votre portefeuille';
    return;
  }
  net.revive();                       // server buys another life-pack + respawns us
  ovDeath.classList.add('hide');
  state.phase = 'playing';
  lockPointer();
});

// Round over: a win, OR the 10-minute limit with the pot rolling over.
net.on('roundOver', function(m){
  state.phase = 'over';
  var rollover = !m.winnerId && (m.rolled || 0) > 0;
  if (rollover){
    winTitle.textContent = 'Le Cœur garde son trésor';
  } else {
    var mine = m.winnerId === net.id;
    winTitle.textContent = mine ? 'Le Cœur du labyrinthe est à vous'
                                : (m.winnerName || 'Quelqu\'un') + ' a réclamé le Cœur';
  }
  // round summary: pot breakdown / rollover, and per-player net + entry paid
  var box = document.getElementById('summaryBox');
  if (m.players){
    var head = rollover
      ? 'Personne n\'a atteint le Cœur — la cagnotte monte à ' + m.rolled + ' CDF pour la prochaine session.'
      : 'Cagnotte ' + (m.pot || 0) + (m.topup ? ' + ' + m.topup + ' bonus' : '') +
        ' → ' + (m.winnerName || '—') + ' remporte ' + (m.target || 0) + ' CDF';
    var rows = m.players.slice().sort(function(a, b){ return b.net - a.net; }).map(function(p){
      var me = p.id === net.id;
      var entry = p.entry ? ' <span style="color:#5c5675">· entrée ' + p.entry + '</span>' : '';
      return '<div class="' + (me ? 'me' : '') + '">' + (me ? '▸ ' : '') + p.name + entry + ' &nbsp; ' +
             (p.net >= 0 ? '+' : '') + p.net + '</div>';
    }).join('');
    box.innerHTML = '<div style="color:var(--lime);margin-bottom:8px">' + head + '</div>' + rows;
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

// Quit: leave the round and return to the home screen. Two taps (arms first) so
// you can't forfeit your entry with an accidental tap.
var quitBtn = document.getElementById('quitBtn');
var quitArmed = false, quitTimer = null;
function disarmQuit(){ quitArmed = false; quitBtn.textContent = '⏻'; quitBtn.classList.remove('armed'); if (quitTimer){ clearTimeout(quitTimer); quitTimer = null; } }
quitBtn.addEventListener('click', function(){
  if (!quitArmed){
    quitArmed = true; quitBtn.textContent = 'Quitter ?'; quitBtn.classList.add('armed');
    quitTimer = setTimeout(disarmQuit, 2500);
    return;
  }
  disarmQuit();
  state.phase = 'menu';        // mark a clean exit so the close isn't treated as a drop
  net.disconnect();            // server removes us; the close handler returns us home
});

export function toggleMute(){
  if (!Sfx.master) return;
  Sfx.muted = !Sfx.muted;
  Sfx.master.gain.value = Sfx.muted ? 0 : 0.85;
  document.getElementById('mute').textContent = Sfx.muted ? '×' : '♪';
}
document.getElementById('mute').addEventListener('click', toggleMute);
