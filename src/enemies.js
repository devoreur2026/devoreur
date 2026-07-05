// The Darkness Eaters: patrolling wraiths that hear sprinting, notice you on
// line-of-sight, chase along a live BFS field toward the player, and kill on
// contact. Also owns the player pathfield the chase logic follows.
import { THREE } from './three.js';
import { KEEPER_COUNT, SIGHT_D, HEAR_D, KILL_D, WALK } from './config.js';
import { TX, id, bfs, randOpenCell, best, los } from './maze.js';
import { makeAgent, agentStep, pickPatrol, neighbors } from './agents.js';
import { scene, makeGlow } from './scene.js';
import { Sfx } from './audio.js';
import { player } from './player.js';
import { state } from './state.js';

/* ---- player pathfield (keepers hunt along it) ---- */
var pf = null, pfT = 0, lastPT = -1;
export function updateField(dt){
  pfT -= dt;
  var pt = id(TX(player.x), TX(player.z));
  if (pt !== lastPT || pfT <= 0 || !pf){
    pf = bfs(TX(player.x), TX(player.z));
    lastPT = pt; pfT = 0.35;
  }
}
function pickChase(a){
  var ns = neighbors(a.tx, a.tz), bx = a.tx, bz = a.tz, bv = 1e9;
  for (var i = 0; i < ns.length; i++){
    var v = pf ? pf[id(ns[i][0], ns[i][1])] : -1;
    if (v >= 0 && v < bv){ bv = v; bx = ns[i][0]; bz = ns[i][1]; }
  }
  if (bv === 1e9){ pickPatrol(a); return; }
  a.ttx = bx; a.ttz = bz;
}

/* ---- Darkness Eaters ---- */
export var keepers = [];
function keeperMesh(){
  var g = new THREE.Group();
  var bodyMat = new THREE.MeshStandardMaterial({ color: 0x07070d, roughness: 0.6, metalness: 0.1, emissive: 0x140826, emissiveIntensity: 0.6 });
  var body = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.4, 10), bodyMat); body.position.y = 1.2;
  var hood = new THREE.Mesh(new THREE.SphereGeometry(0.44, 10, 8), bodyMat); hood.position.y = 2.0;
  var eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4d1a });
  var e1 = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), eyeMat); e1.position.set(0.15, 2.04, 0.36);
  var e2 = e1.clone(); e2.position.x = -0.15;
  var aura = makeGlow(0x7a45ff, 3.6, 0.3); aura.position.y = 1.4;
  var eyeGlow = makeGlow(0xff5522, 1.1, 0.5); eyeGlow.position.set(0, 2.04, 0.3);
  g.add(body, hood, e1, e2, aura, eyeGlow);
  g.userData = { e1: e1, e2: e2, aura: aura, eyeGlow: eyeGlow, bodyMat: bodyMat };
  return g;
}
(function spawnKeepers(){
  var placed = [];
  for (var i = 0; i < KEEPER_COUNT; i++){
    var t = null, tries = 0;
    while (tries++ < 60){
      var cand = randOpenCell(best * 0.3, best * 0.95), ok = true;
      for (var j = 0; j < placed.length; j++){
        if (Math.abs(placed[j].x - cand.x) + Math.abs(placed[j].z - cand.z) < 10){ ok = false; break; }
      }
      if (ok){ t = cand; break; }
    }
    if (!t) t = randOpenCell(best * 0.3, best * 0.95);
    placed.push(t);
    var mesh = keeperMesh(); scene.add(mesh);
    keepers.push({ a: makeAgent(t.x, t.z, 3.1), g: mesh, state: 'patrol', lost: 0, senseT: Math.random() * 0.15, ph: Math.random() * 6 });
  }
})();

// `onKill` is injected by the main loop so enemies don't depend on game flow.
export function updateKeepers(dt, t, onKill){
  var nearest = 999;
  for (var i = 0; i < keepers.length; i++){
    var k = keepers[i];
    var dx = player.x - k.a.px, dz = player.z - k.a.pz;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < nearest) nearest = d;

    k.senseT -= dt;
    if (k.senseT <= 0){
      k.senseT = 0.14;
      if (state.playing && player.invuln <= 0){
        var hearR = (player.speed > WALK) ? 7.5 : HEAR_D;
        var noticed = d < hearR || (d < SIGHT_D && los(k.a.px, k.a.pz, player.x, player.z));
        if (noticed){
          if (k.state !== 'chase'){ k.state = 'chase'; Sfx.whisper(); }
          k.lost = 0;
        } else if (k.state === 'chase'){
          k.lost += 0.14;
          if (k.lost > 3.2) k.state = 'patrol';
        }
      } else if (k.state === 'chase'){
        k.state = 'patrol';
      }
    }

    k.a.speed = k.state === 'chase' ? 6.6 : 3.1;
    agentStep(k.a, dt, k.state === 'chase' ? pickChase : function(a){
      pickPatrol(a);
      if (Math.random() < 0.12) a.idle = 0.4 + Math.random() * 0.9;
    });

    var g = k.g, u = g.userData;
    g.position.set(k.a.px, Math.sin(t * 2 + k.ph) * 0.12 + 0.06, k.a.pz);
    var faceY = k.state === 'chase' ? Math.atan2(dx, dz) : Math.atan2(k.a.dirx, k.a.dirz);
    g.rotation.y += (faceY - g.rotation.y) * Math.min(1, dt * 6);
    var chase = k.state === 'chase';
    var sc = 1 + (chase ? (0.5 + 0.5 * Math.sin(t * 10 + k.ph)) * 0.7 : 0.15 * Math.sin(t * 3 + k.ph));
    u.e1.scale.setScalar(sc); u.e2.scale.setScalar(sc);
    u.eyeGlow.material.opacity = chase ? 0.9 : 0.45;
    u.aura.material.opacity = chase ? 0.5 : 0.28;
    u.bodyMat.emissiveIntensity = chase ? 1.1 : 0.5;

    if (state.playing && player.invuln <= 0 && d < KILL_D) onKill();
  }
  return nearest;
}
