// Simulated rival hunters. They drift toward the treasure along its distance
// field, wander and pause, and show a name tag + lantern glow. Placeholder for
// real networked players in the eventual server build.
import { THREE } from './three.js';
import { BOT_COUNT } from './config.js';
import { tField, id, randOpenCell, best } from './maze.js';
import { makeAgent, agentStep, pickPatrol, neighbors } from './agents.js';
import { scene, makeGlow, nameSprite } from './scene.js';

var botDefs = [
  { n: 'NOVA', c: 0x63d6ff }, { n: 'ORYX', c: 0xff8f5e }, { n: 'VEX', c: 0xc07bff }
];
export var bots = [];
function botMesh(def){
  var g = new THREE.Group();
  var col = new THREE.Color(def.c);
  var bodyMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), roughness: 0.7, metalness: 0.2 });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.25, 10), bodyMat); body.position.y = 0.85;
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.65), roughness: 0.6 }));
  head.position.y = 1.72;
  var visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), new THREE.MeshBasicMaterial({ color: def.c }));
  visor.position.set(0, 1.74, 0.24);
  var lantern = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  lantern.position.set(0.42, 1.05, 0.14);
  var lg = makeGlow(0xffc37a, 1.6, 0.7); lg.position.copy(lantern.position);
  var tag = nameSprite(def.n, '#' + col.getHexString()); tag.position.y = 2.4;
  g.add(body, head, visor, lantern, lg, tag);
  return g;
}
function pickBot(a){
  var ns = neighbors(a.tx, a.tz);
  var here = tField[id(a.tx, a.tz)];
  if (Math.random() < 0.3 && here > 18){
    var bx = a.tx, bz = a.tz, bv = 1e9;
    for (var i = 0; i < ns.length; i++){
      var v = tField[id(ns[i][0], ns[i][1])];
      if (v >= 0 && v < bv){ bv = v; bx = ns[i][0]; bz = ns[i][1]; }
    }
    a.ttx = bx; a.ttz = bz;
  } else pickPatrol(a);
  if (Math.random() < 0.18) a.idle = 0.6 + Math.random() * 1.6;
}
(function spawnBots(){
  for (var i = 0; i < BOT_COUNT; i++){
    var t = randOpenCell(best * 0.12, best * 0.8);
    var mesh = botMesh(botDefs[i]); scene.add(mesh);
    bots.push({ a: makeAgent(t.x, t.z, 4.4), g: mesh, def: botDefs[i], ph: Math.random() * 6 });
  }
})();

export function updateBots(dt, t){
  for (var i = 0; i < bots.length; i++){
    var b = bots[i];
    agentStep(b.a, dt, pickBot);
    b.g.position.set(b.a.px, 0, b.a.pz);
    if (b.a.idle > 0){
      b.g.rotation.y += Math.sin(t * 1.4 + b.ph) * dt * 1.2;
    } else {
      var faceY = Math.atan2(b.a.dirx, b.a.dirz);
      b.g.rotation.y += (faceY - b.g.rotation.y) * Math.min(1, dt * 7);
    }
  }
}
