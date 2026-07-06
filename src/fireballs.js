// Renders fireball projectiles from the server's FIREBALL / FIREBALL_END events.
// Each projectile is a bright core + a glowing comet trail that flies along the
// server-defined line (smooth, no per-frame network updates); on end it bursts.
import { THREE } from './three.js';
import { scene, makeGlow } from './scene.js';
import { net } from './net.js';

var shots = new Map();   // id -> { g, x, z, dx, dz, speed }
var bursts = [];         // { s, life }

function makeShot(){
  var g = new THREE.Group();
  var core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  var glow = makeGlow(0xff7a1e, 2.0, 0.95);
  g.add(core, glow);
  // comet trail: additive glows trailing behind along -dir (set each frame)
  var trail = [];
  for (var i = 0; i < 4; i++){ var t = makeGlow(0xff5510, 1.5 - i * 0.28, 0.6 - i * 0.12); g.add(t); trail.push(t); }
  g.userData.trail = trail;
  g.position.y = 1.3;
  return g;
}

net.on('fireball', function(m){
  var g = makeShot(); g.position.set(m.x, 1.3, m.z); scene.add(g);
  shots.set(m.id, { g: g, x: m.x, z: m.z, dx: m.dx, dz: m.dz, speed: m.speed });
});
net.on('fireballEnd', function(m){
  var s = shots.get(m.id);
  if (s){ scene.remove(s.g); shots.delete(m.id); }
  // burst at the end point (bigger on a kill)
  var b = makeGlow(m.hit ? 0xffb060 : 0xff6020, m.hit ? 3.2 : 1.8, 0.9);
  b.position.set(m.x, 1.3, m.z); scene.add(b);
  bursts.push({ s: b, life: 0.35, max: 0.35 });
});

export function render(dt){
  for (var s of shots.values()){
    s.x += s.dx * s.speed * dt;
    s.z += s.dz * s.speed * dt;
    s.g.position.x = s.x; s.g.position.z = s.z;
    var trail = s.g.userData.trail;
    for (var i = 0; i < trail.length; i++){
      var back = (i + 1) * 0.5;
      trail[i].position.set(-s.dx * back, 0, -s.dz * back);   // local offset behind travel
    }
  }
  for (var j = bursts.length - 1; j >= 0; j--){
    var b = bursts[j]; b.life -= dt;
    if (b.life <= 0){ scene.remove(b.s); bursts.splice(j, 1); continue; }
    var k = b.life / b.max;
    b.s.material.opacity = 0.9 * k;
    b.s.scale.setScalar((b.s.scale.x || 3) * (1 + dt * 2));   // expand
  }
}

// clear everything on a new round
export function clear(){
  for (var s of shots.values()) scene.remove(s.g);
  shots.clear();
  for (var i = 0; i < bursts.length; i++) scene.remove(bursts[i].s);
  bursts.length = 0;
}
