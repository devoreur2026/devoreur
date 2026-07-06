// Renders the *other* networked players in the room. Reuses the body + name
// tag visuals from the old bots, but positions come from the server snapshot
// and are smoothly interpolated so movement doesn't stutter at 20Hz.
import { THREE } from './three.js';
import { scene, makeGlow, nameSprite } from './scene.js';
import { player } from './player.js';
import { MAX_HEALTH } from '../shared/config.js';

var entries = new Map();   // id -> { g, tx, tz, tyaw, tag }

function healthSprite(color){
  var m = new THREE.SpriteMaterial({ color: color, depthTest: true, depthWrite: false, transparent: true });
  var s = new THREE.Sprite(m);
  return s;
}
function makeMesh(name, color){
  var g = new THREE.Group();
  var col = new THREE.Color(color);
  var bodyMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), roughness: 0.7, metalness: 0.2 });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.25, 10), bodyMat); body.position.y = 0.85;
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.65), roughness: 0.6 }));
  head.position.y = 1.72;
  var visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), new THREE.MeshBasicMaterial({ color: color }));
  visor.position.set(0, 1.74, 0.24);
  var lantern = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  lantern.position.set(0.42, 1.05, 0.14);
  var lg = makeGlow(0xffc37a, 1.6, 0.7); lg.position.copy(lantern.position);
  var tag = nameSprite(name, '#' + col.getHexString()); tag.position.y = 2.4;
  // small health bar above the head — only visible when the player is wounded
  var barBg = healthSprite(0x0a0c12); barBg.material.opacity = 0.6; barBg.scale.set(0.78, 0.13, 1); barBg.position.y = 2.12; barBg.renderOrder = 1;
  var barFill = healthSprite(0x6ee7a8); barFill.scale.set(0.72, 0.09, 1); barFill.position.y = 2.12; barFill.renderOrder = 2;
  g.add(body, head, visor, lantern, lg, tag, barBg, barFill);
  g.userData.tag = tag; g.userData.barBg = barBg; g.userData.barFill = barFill;
  return g;
}
// left-anchored fill + green->amber->red, hidden at full health
function setHealthBar(g, hp){
  var frac = Math.max(0, Math.min(1, (typeof hp === 'number' ? hp : MAX_HEALTH) / MAX_HEALTH));
  var bg = g.userData.barBg, fill = g.userData.barFill;
  bg.visible = fill.visible = frac < 1;
  fill.scale.x = 0.72 * frac;
  fill.position.x = -0.36 * (1 - frac);
  fill.material.color.setHex(frac > 0.5 ? 0x6ee7a8 : frac > 0.25 ? 0xffd166 : 0xe8574a);
}

// Reconcile the scene with the latest roster (everyone except me).
export function sync(players, selfId){
  var seen = {};
  for (var i = 0; i < players.length; i++){
    var p = players[i];
    if (p.id === selfId || p.spec) continue;   // don't render yourself or spectators (ghosts)
    seen[p.id] = true;
    var e = entries.get(p.id);
    if (!e){
      var g = makeMesh(p.name, p.color); scene.add(g);
      e = { g: g, tx: p.x, tz: p.z, tyaw: p.yaw };
      e.g.position.set(p.x, 0, p.z);
      entries.set(p.id, e);
    }
    e.tx = p.x; e.tz = p.z; e.tyaw = p.yaw;
    setHealthBar(e.g, p.hp);              // wounded indicator (server-authoritative hp)
  }
  // drop players who left
  for (var id of entries.keys()){
    if (!seen[id]){
      var gone = entries.get(id);
      scene.remove(gone.g);
      entries.delete(id);
    }
  }
}

function lerpAngle(a, b, t){
  var d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function render(dt){
  var k = Math.min(1, dt * 12);   // exponential smoothing toward latest snapshot
  for (var e of entries.values()){
    e.g.position.x += (e.tx - e.g.position.x) * k;
    e.g.position.z += (e.tz - e.g.position.z) * k;
    e.g.rotation.y = lerpAngle(e.g.rotation.y, e.tyaw, k);
    // Everyone spawns on the same start cell; fade a player out when they're
    // basically inside your camera so their name tag doesn't fill the screen.
    var dx = e.g.position.x - player.x, dz = e.g.position.z - player.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    e.g.visible = d > 0.6;
    e.g.userData.tag.material.opacity = Math.max(0, Math.min(1, (d - 1.0) / 2.5));
  }
}
