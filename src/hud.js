// Heads-up display: stamina bar, danger/shield vignettes, the proximity
// heartbeat, the timer and the live hunter distance list.
import { THREE } from './three.js';
import { bots } from './bots.js';
import { player } from './player.js';
import { Sfx } from './audio.js';
import { state } from './state.js';
import { fmt } from './util.js';

var dangerEl = document.getElementById('danger');
var shieldEl = document.getElementById('shield');
var stamEl = document.getElementById('stam');
var timerEl = document.getElementById('timer');
var botListEl = document.getElementById('botList');

var heartT = 0, hudT = 0;
export function updateHud(dt, nearest){
  stamEl.style.width = player.stamina + '%';
  var danger = state.playing ? Math.max(0, Math.min(0.85, 1 - nearest / 12)) : 0;
  dangerEl.style.opacity = danger;
  shieldEl.style.opacity = player.invuln > 0 ? 0.5 : 0;
  if (state.playing && nearest < 12){
    heartT -= dt;
    if (heartT <= 0){
      var k = Math.max(0.05, nearest / 12);
      heartT = 0.32 + 0.78 * k;
      Sfx.beat(1 - k);
    }
  }
  hudT -= dt;
  if (hudT <= 0){
    hudT = 0.25;
    timerEl.textContent = fmt(state.time);
    var html = '';
    for (var i = 0; i < bots.length; i++){
      var b = bots[i];
      var d = Math.round(Math.sqrt(
        (b.a.px - player.x) * (b.a.px - player.x) + (b.a.pz - player.z) * (b.a.pz - player.z)));
      html += '<div><span class="nm" style="color:#' + new THREE.Color(b.def.c).getHexString() + '">' +
              b.def.n + '</span><span class="ds">' + d + 'm</span></div>';
    }
    botListEl.innerHTML = html;
  }
}
