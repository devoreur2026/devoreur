// Renderer, scene, camera, lights and all the static/animated world geometry:
// procedural stone textures, floor/ceiling, instanced walls, the torch, dust
// motes and the treasure (Heart of the Maze). Also the shared glow/name sprite
// helpers reused by keepers and bots, and the per-frame world animation.
import { THREE } from './three.js';
import { G, CS, WH, EYE } from './config.js';
import { grid, id, isWall, WX, treasureT } from './maze.js';

export var canvas = document.getElementById('c');
export var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

export var scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);
scene.fog = new THREE.FogExp2(0x04050a, 0.052);
export var camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 140);

scene.add(new THREE.AmbientLight(0x1c2340, 0.6));
scene.add(new THREE.HemisphereLight(0x27304d, 0x0a0c12, 0.35));
export var torch = new THREE.PointLight(0xffa050, 1.7, 26, 2);
scene.add(torch);

/* ---- procedural stone texture ---- */
function stoneTex(base, groutAlpha){
  var c = document.createElement('canvas'); c.width = c.height = 256;
  var g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (var i = 0; i < 1400; i++){
    var a = Math.random() * 0.09;
    g.fillStyle = (Math.random() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + a.toFixed(3) + ')';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1;
  for (var k = 0; k < 7; k++){
    g.beginPath();
    var x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    for (var s = 0; s < 8; s++){ x += (Math.random() - 0.5) * 44; y += (Math.random() - 0.5) * 44; g.lineTo(x, y); }
    g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,' + groutAlpha + ')'; g.lineWidth = 7;
  g.strokeRect(0, 0, 256, 256);
  var tx = new THREE.CanvasTexture(c);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

var floorTex = stoneTex('#10131c', 0.6); floorTex.repeat.set(G, G);
var floor = new THREE.Mesh(
  new THREE.PlaneGeometry(G * CS, G * CS),
  new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.06, roughness: 0.95, metalness: 0.05 })
);
floor.rotation.x = -Math.PI / 2; scene.add(floor);

var ceilTex = stoneTex('#0a0c13', 0.45); ceilTex.repeat.set(G, G);
var ceil = new THREE.Mesh(
  new THREE.PlaneGeometry(G * CS, G * CS),
  new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1, metalness: 0 })
);
ceil.rotation.x = Math.PI / 2; ceil.position.y = WH; scene.add(ceil);

/* ---- walls (instanced) ---- */
var wallTex = stoneTex('#181d2e', 0.5);
var wallMat = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 0.09, roughness: 0.9, metalness: 0.08 });
var wallList = [];
for (var wz = 0; wz < G; wz++) for (var wx = 0; wx < G; wx++){
  if (grid[id(wx, wz)] !== 1) continue;
  if (!isWall(wx - 1, wz) || !isWall(wx + 1, wz) || !isWall(wx, wz - 1) || !isWall(wx, wz + 1)) wallList.push([wx, wz]);
}
var walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, WH, CS), wallMat, wallList.length);
(function placeWalls(){
  var m = new THREE.Matrix4();
  var colArr = new Float32Array(wallList.length * 3);
  for (var i = 0; i < wallList.length; i++){
    m.setPosition(WX(wallList[i][0]), WH / 2, WX(wallList[i][1]));
    walls.setMatrixAt(i, m);
    var sh = 0.8 + Math.random() * 0.35;
    colArr[i * 3] = sh * 0.92; colArr[i * 3 + 1] = sh * 0.97; colArr[i * 3 + 2] = sh * 1.12;
  }
  walls.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
})();
scene.add(walls);

/* ---- shared glow sprite ---- */
var glowMap = (function(){
  var c = document.createElement('canvas'); c.width = c.height = 128;
  var g = c.getContext('2d');
  var gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
export function makeGlow(color, scale, opacity){
  var s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMap, color: color, transparent: true, opacity: opacity,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  s.scale.set(scale, scale, 1);
  return s;
}
export function nameSprite(text, colorCss){
  var c = document.createElement('canvas'); c.width = 256; c.height = 64;
  var g = c.getContext('2d');
  g.font = '600 30px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = colorCss; g.shadowBlur = 14;
  g.fillStyle = '#f2ecd9'; g.fillText(text, 128, 34);
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(2.7, 0.68, 1);
  return s;
}

/* ---- dust motes ---- */
var DN = 280, dustPos = new Float32Array(DN * 3);
for (var di = 0; di < DN; di++){
  dustPos[di * 3] = (Math.random() - 0.5) * 40;
  dustPos[di * 3 + 1] = 0.3 + Math.random() * (WH - 1);
  dustPos[di * 3 + 2] = (Math.random() - 0.5) * 40;
}
var dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
export var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x8fa8ff, size: 0.07, transparent: true, opacity: 0.35, depthWrite: false
}));
scene.add(dust);

/* ---- treasure: the Heart of the Maze ---- */
export var treasure = new THREE.Group();
(function buildTreasure(){
  var gold = new THREE.MeshStandardMaterial({ color: 0xd7a642, metalness: 0.85, roughness: 0.28, emissive: 0x3a2405, emissiveIntensity: 1 });
  var iron = new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.9, roughness: 0.4 });
  var base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.95), gold); base.position.y = 0.38;
  var lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.32, 0.95), gold);
  lid.position.set(0, 0.86, -0.2); lid.rotation.x = -0.6;
  var band = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.14, 0.99), iron); band.position.y = 0.4;
  var heart = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), new THREE.MeshBasicMaterial({ color: 0xffd97a }));
  heart.position.y = 0.78;
  treasure.add(base, lid, band, heart);
  treasure.userData.heart = heart;
  var aura = makeGlow(0xffce6b, 7, 0.5); aura.position.y = 1;
  treasure.add(aura); treasure.userData.aura = aura;
  var tl = new THREE.PointLight(0xffc866, 1.4, 16, 2); tl.position.y = 1.3;
  treasure.add(tl); treasure.userData.light = tl;
  /* rising sparks */
  var SN = 50, sp = new Float32Array(SN * 3);
  for (var i = 0; i < SN; i++){
    sp[i * 3] = (Math.random() - 0.5) * 1.6;
    sp[i * 3 + 1] = Math.random() * 2.2;
    sp[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
  }
  var sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  var sparks = new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xffd97a, size: 0.09, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  treasure.add(sparks); treasure.userData.sparks = sparks;
})();
treasure.position.set(WX(treasureT.x), 0, WX(treasureT.z));
scene.add(treasure);

/* ---- per-frame world animation (torch follows the player) ---- */
export function animateWorld(dt, t, player){
  torch.position.set(
    player.x - Math.sin(player.yaw) * 0.4,
    EYE + 0.15,
    player.z - Math.cos(player.yaw) * 0.4
  );
  torch.intensity = 1.55 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23 + 1.7) * 0.08;

  var u = treasure.userData;
  var pulse = 0.8 + 0.2 * Math.sin(t * 2.4);
  u.heart.scale.setScalar(0.9 + 0.18 * Math.sin(t * 3));
  u.light.intensity = 1.2 + 0.5 * Math.sin(t * 2.4);
  u.aura.material.opacity = 0.35 + 0.2 * pulse;
  var sp = u.sparks.geometry.attributes.position;
  for (var i = 0; i < sp.count; i++){
    var y = sp.getY(i) + dt * (0.5 + (i % 5) * 0.14);
    if (y > 2.4) y = 0.1;
    sp.setY(i, y);
  }
  sp.needsUpdate = true;

  var dp = dust.geometry.attributes.position;
  for (var j = 0; j < dp.count; j++){
    var x = dp.getX(j), y2 = dp.getY(j) + dt * 0.06, z = dp.getZ(j);
    x += Math.sin(t * 0.3 + j) * dt * 0.12;
    if (y2 > WH - 0.4) y2 = 0.3;
    if (x - player.x > 20) x -= 40; if (player.x - x > 20) x += 40;
    if (z - player.z > 20) z -= 40; if (player.z - z > 20) z += 40;
    dp.setXYZ(j, x, y2, z);
  }
  dp.needsUpdate = true;
}
