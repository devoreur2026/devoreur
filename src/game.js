// Game flow: the start/death/win overlays and their buttons, the death and win
// transitions, respawn (which scatters nearby keepers), and mute toggling.
import { state } from './state.js';
import { player, resetYaw } from './player.js';
import { keepers } from './enemies.js';
import { WX, randOpenCell, best } from './maze.js';
import { Sfx } from './audio.js';
import { canvas } from './scene.js';
import { fmt } from './util.js';

var ovStart = document.getElementById('ovStart');
var ovDeath = document.getElementById('ovDeath');
var ovWin = document.getElementById('ovWin');
var flashEl = document.getElementById('flash');
var deathsEl = document.getElementById('deaths');
var hintEl = document.getElementById('hint');

document.getElementById('startBtn').addEventListener('click', function(){
  Sfx.init();
  ovStart.classList.add('hide');
  state.playing = true;
  try { canvas.requestPointerLock(); } catch (e) {}
  setTimeout(function(){ hintEl.classList.add('fade'); }, 9000);
});
document.getElementById('respawnBtn').addEventListener('click', function(){
  ovDeath.classList.add('hide');
  player.x = WX(1); player.z = WX(1); resetYaw();
  player.invuln = 3; player.stamina = 100; player.bob = 0;
  for (var i = 0; i < keepers.length; i++){
    var k = keepers[i]; k.state = 'patrol'; k.lost = 0;
    var d = Math.sqrt((k.a.px - player.x) * (k.a.px - player.x) + (k.a.pz - player.z) * (k.a.pz - player.z));
    if (d < 26){
      var t = randOpenCell(best * 0.45, best * 0.95);
      k.a.tx = t.x; k.a.tz = t.z; k.a.ttx = t.x; k.a.ttz = t.z;
      k.a.px = WX(t.x); k.a.pz = WX(t.z); k.a.from = -1;
    }
  }
  state.playing = true;
  try { canvas.requestPointerLock(); } catch (e) {}
});
document.getElementById('againBtn').addEventListener('click', function(){ location.reload(); });

export function toggleMute(){
  if (!Sfx.master) return;
  Sfx.muted = !Sfx.muted;
  Sfx.master.gain.value = Sfx.muted ? 0 : 0.85;
  document.getElementById('mute').textContent = Sfx.muted ? '×' : '♪';
}
document.getElementById('mute').addEventListener('click', toggleMute);

export function die(){
  state.playing = false; state.deaths++;
  deathsEl.textContent = state.deaths;
  Sfx.sting();
  flashEl.style.opacity = 0.75;
  setTimeout(function(){ flashEl.style.opacity = 0; }, 180);
  for (var i = 0; i < keepers.length; i++) keepers[i].state = 'patrol';
  if (document.exitPointerLock) document.exitPointerLock();
  setTimeout(function(){ ovDeath.classList.remove('hide'); }, 550);
}
export function win(){
  state.playing = false; state.ended = true;
  Sfx.chime();
  document.getElementById('winTime').textContent = fmt(state.time);
  document.getElementById('winDeaths').textContent = state.deaths;
  if (document.exitPointerLock) document.exitPointerLock();
  ovWin.classList.remove('hide');
}
