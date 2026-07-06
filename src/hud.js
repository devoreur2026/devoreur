// Heads-up display, driven by the server snapshot: stamina, danger/shield
// vignettes, proximity heartbeat, round timer, deaths, and the live roster of
// other players in the maze with their distance to you.
import { THREE } from './three.js';
import { player } from './player.js';
import { Sfx } from './audio.js';
import { state } from './state.js';
import { net } from './net.js';
import { fmt } from './util.js';
import { MAX_HEALTH } from '../shared/config.js';

var dangerEl = document.getElementById('danger');
var shieldEl = document.getElementById('shield');
var stamEl = document.getElementById('stam');
var healthEl = document.getElementById('health');
var livesLblEl = document.getElementById('livesLbl');
var livesEl = document.getElementById('lives');
var timerEl = document.getElementById('timer');
var botListEl = document.getElementById('botList');
var deathsEl = document.getElementById('deaths');

// nearest eater to the local player, from the latest snapshot
export function nearestEater(){
  var best = 999;
  for (var i = 0; i < net.eaters.length; i++){
    var e = net.eaters[i];
    var d = Math.sqrt((e.x - player.x) * (e.x - player.x) + (e.z - player.z) * (e.z - player.z));
    if (d < best) best = d;
  }
  return best;
}

var heartT = 0, hudT = 0;
export function updateHud(dt){
  var playing = state.phase === 'playing';
  var nearest = nearestEater();
  var me = net.self();

  stamEl.style.width = player.stamina + '%';
  // health is server-authoritative — read it straight from the snapshot
  var hp = me && typeof me.hp === 'number' ? me.hp : MAX_HEALTH;
  healthEl.style.width = Math.max(0, Math.min(1, hp / MAX_HEALTH)) * 100 + '%';
  // lives = staked/250; shown only while actively in the hunt
  var lv = me && me.spec === 0 ? (me.lives || 0) : 0;
  if (playing && lv > 0){
    livesLblEl.style.opacity = 1;
    livesEl.textContent = '◆'.repeat(Math.min(lv, 10)) + (lv > 10 ? ' ' + lv : '');
  } else {
    livesLblEl.style.opacity = 0;
  }
  dangerEl.style.opacity = playing ? Math.max(0, Math.min(0.85, 1 - nearest / 12)) : 0;
  shieldEl.style.opacity = (me && me.invuln) ? 0.5 : 0;

  if (playing && nearest < 12){
    heartT -= dt;
    if (heartT <= 0){
      var kf = Math.max(0.05, nearest / 12);
      heartT = 0.32 + 0.78 * kf;
      Sfx.beat(1 - kf);
    }
  }

  hudT -= dt;
  if (hudT <= 0){
    hudT = 0.25;
    timerEl.textContent = fmt(net.time);
    if (me) deathsEl.textContent = me.deaths;
    var html = '';
    for (var i = 0; i < net.players.length; i++){
      var p = net.players[i];
      if (p.id === net.id || p.spec) continue;   // skip yourself + spectators
      var d = Math.round(Math.sqrt((p.x - player.x) * (p.x - player.x) + (p.z - player.z) * (p.z - player.z)));
      html += '<div><span class="nm" style="color:#' + new THREE.Color(p.color).getHexString() + '">' +
              p.name + '</span><span class="ds">' + d + 'm</span></div>';
    }
    botListEl.innerHTML = html || '<div class="ds">no one else… yet</div>';
  }
}
