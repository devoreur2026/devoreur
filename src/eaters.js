// Renders the Darkness Eaters from server snapshots. The AI lives on the
// server; here we only build the meshes, interpolate their positions/facing,
// and drive the chase visuals (eye pulse, aura, emissive) from the chase flag.
import { THREE } from './three.js';
import { scene, makeGlow } from './scene.js';

var list = [];   // { g, u, tx, tz, try_, chase, ph }

function makeMesh(){
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

// Match the number of meshes to the server's eater count and set targets.
export function sync(eaters){
  while (list.length < eaters.length){
    var g = makeMesh(); scene.add(g);
    list.push({ g: g, u: g.userData, tx: 0, tz: 0, try_: 0, chase: 0, ph: Math.random() * 6 });
  }
  while (list.length > eaters.length){
    var gone = list.pop(); scene.remove(gone.g);
  }
  for (var i = 0; i < eaters.length; i++){
    var s = eaters[i], e = list[i];
    e.tx = s.x; e.tz = s.z; e.try_ = s.ry; e.chase = s.chase;
  }
}

function lerpAngle(a, b, t){
  var d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function render(dt, t){
  var k = Math.min(1, dt * 12);
  for (var i = 0; i < list.length; i++){
    var e = list[i], u = e.u, chase = e.chase;
    e.g.position.x += (e.tx - e.g.position.x) * k;
    e.g.position.z += (e.tz - e.g.position.z) * k;
    e.g.position.y = Math.sin(t * 2 + e.ph) * 0.12 + 0.06;
    e.g.rotation.y = lerpAngle(e.g.rotation.y, e.try_, k);

    var sc = 1 + (chase ? (0.5 + 0.5 * Math.sin(t * 10 + e.ph)) * 0.7 : 0.15 * Math.sin(t * 3 + e.ph));
    u.e1.scale.setScalar(sc); u.e2.scale.setScalar(sc);
    u.eyeGlow.material.opacity = chase ? 0.9 : 0.45;
    u.aura.material.opacity = chase ? 0.5 : 0.28;
    u.bodyMat.emissiveIntensity = chase ? 1.1 : 0.5;
  }
}
