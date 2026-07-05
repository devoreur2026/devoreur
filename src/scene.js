// Renderer, scene, camera, lights and all the static/animated world geometry:
// procedural stone textures (with moss/cracks), floor/ceiling, instanced walls,
// pooled flickering wall sconces, the torch, dust motes and the treasure
// chamber (Heart of the Maze, with gold light spill + drifting dust). Also the
// shared glow/name sprite helpers. The maze is (re)built from a server grid.
import { THREE } from './three.js';
import { G, CS, WH, EYE } from '../shared/config.js';
import { id, WX, createMaze } from '../shared/maze.js';
import { state } from './state.js';

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

/* ---- procedural stone texture (speckle, veins, grout, + optional moss/cracks) ---- */
function stoneTex(base, groutAlpha, moss){
  var c = document.createElement('canvas'); c.width = c.height = 256;
  var g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (var i = 0; i < 1400; i++){
    var a = Math.random() * 0.09;
    g.fillStyle = (Math.random() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + a.toFixed(3) + ')';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // dark veins
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1;
  for (var k = 0; k < 7; k++){
    g.beginPath();
    var x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    for (var s = 0; s < 8; s++){ x += (Math.random() - 0.5) * 44; y += (Math.random() - 0.5) * 44; g.lineTo(x, y); }
    g.stroke();
  }
  // extra hairline cracks
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.4;
  for (var cr = 0; cr < 5; cr++){
    g.beginPath();
    var cx = Math.random() * 256, cy = Math.random() * 256;
    g.moveTo(cx, cy);
    var seg = 5 + ((Math.random() * 5) | 0);
    for (var q = 0; q < seg; q++){ cx += (Math.random() - 0.5) * 30; cy += (Math.random() - 0.5) * 30; g.lineTo(cx, cy); }
    g.stroke();
  }
  // moss: soft greenish blotches
  if (moss){
    for (var mm = 0; mm < (18 * moss) | 0; mm++){
      var mx = Math.random() * 256, my = Math.random() * 256, mr = 6 + Math.random() * 22;
      var rg = g.createRadialGradient(mx, my, 0, mx, my, mr);
      var alpha = (0.05 + Math.random() * 0.11) * moss;
      rg.addColorStop(0, 'rgba(70,96,52,' + alpha.toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(70,96,52,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(mx, my, mr, 0, 6.28318); g.fill();
    }
  }
  g.strokeStyle = 'rgba(0,0,0,' + groutAlpha + ')'; g.lineWidth = 7;
  g.strokeRect(0, 0, 256, 256);
  var tx = new THREE.CanvasTexture(c);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

var floorTex = stoneTex('#10131c', 0.6, 0.55); floorTex.repeat.set(G, G);
var floor = new THREE.Mesh(
  new THREE.PlaneGeometry(G * CS, G * CS),
  new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.06, roughness: 0.95, metalness: 0.05 })
);
floor.rotation.x = -Math.PI / 2; scene.add(floor);

var ceilTex = stoneTex('#0a0c13', 0.45, 0); ceilTex.repeat.set(G, G);
var ceil = new THREE.Mesh(
  new THREE.PlaneGeometry(G * CS, G * CS),
  new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1, metalness: 0 })
);
ceil.rotation.x = Math.PI / 2; ceil.position.y = WH; scene.add(ceil);

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

/* ---- walls (instanced) — (re)built each round from the server grid ---- */
var wallTex = stoneTex('#181d2e', 0.5, 0.4);
var wallMat = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 0.09, roughness: 0.9, metalness: 0.08 });
var wallGeo = new THREE.BoxGeometry(CS, WH, CS);
var wallsMesh = null;
function buildWalls(maze){
  if (wallsMesh){ scene.remove(wallsMesh); wallsMesh.dispose(); }
  var grid = maze.grid;
  var wallList = [];
  for (var wz = 0; wz < G; wz++) for (var wx = 0; wx < G; wx++){
    if (grid[id(wx, wz)] !== 1) continue;
    if (!maze.isWall(wx - 1, wz) || !maze.isWall(wx + 1, wz) || !maze.isWall(wx, wz - 1) || !maze.isWall(wx, wz + 1)) wallList.push([wx, wz]);
  }
  wallsMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallList.length);
  var m = new THREE.Matrix4();
  var colArr = new Float32Array(wallList.length * 3);
  for (var i = 0; i < wallList.length; i++){
    m.setPosition(WX(wallList[i][0]), WH / 2, WX(wallList[i][1]));
    wallsMesh.setMatrixAt(i, m);
    var sh = 0.8 + Math.random() * 0.35;
    colArr[i * 3] = sh * 0.92; colArr[i * 3 + 1] = sh * 0.97; colArr[i * 3 + 2] = sh * 1.12;
  }
  wallsMesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
  scene.add(wallsMesh);
}

/* ---- wall sconces: many flame sprites, few pooled lights (perf) ---- */
var SCONCE_MAX_LIGHTS = 4;
var sconceBracketMat = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.8, metalness: 0.4 });
var sconceGroup = new THREE.Group(); scene.add(sconceGroup);
var sconceAnchors = [];
var sconceLights = [];
for (var sl = 0; sl < SCONCE_MAX_LIGHTS; sl++){
  var _l = new THREE.PointLight(0xff8a3c, 0, 9, 2); scene.add(_l);
  sconceLights.push({ light: _l, anchor: null });
}
function makeFlame(){
  var g = new THREE.Group();
  var bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), sconceBracketMat);
  var flame = makeGlow(0xff8a3c, 0.95, 0.85); flame.position.y = 0.14;
  var core = makeGlow(0xffe0a0, 0.42, 0.95); core.position.y = 0.14;
  g.add(bracket, flame, core);
  g.userData = { flame: flame, core: core };
  return g;
}
function buildSconces(maze){
  for (var i = sconceGroup.children.length - 1; i >= 0; i--){
    var grp = sconceGroup.children[i];
    grp.traverse(function(o){ if (o.material) o.material.dispose(); });
    sconceGroup.remove(grp);
  }
  sconceAnchors.length = 0;
  var grid = maze.grid, cap = 55;
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var wz = 1; wz < G - 1 && sconceAnchors.length < cap; wz++){
    for (var wx = 1; wx < G - 1 && sconceAnchors.length < cap; wx++){
      if (grid[id(wx, wz)] !== 1) continue;
      var od = null;
      for (var d = 0; d < 4; d++) if (!maze.isWall(wx + dirs[d][0], wz + dirs[d][1])){ od = dirs[d]; break; }
      if (!od) continue;
      if (Math.random() > 0.09) continue;          // sparse: occasional sconces
      var ax = WX(wx) + od[0] * (CS * 0.5 - 0.25);
      var az = WX(wz) + od[1] * (CS * 0.5 - 0.25);
      var grp = makeFlame(); grp.position.set(ax, WH * 0.5, az);
      sconceGroup.add(grp);
      sconceAnchors.push({ x: ax, y: WH * 0.5, z: az, g: grp, ph: Math.random() * 6, used: false });
    }
  }
}
function updateSconces(t, player){
  for (var i = 0; i < sconceAnchors.length; i++){
    var a = sconceAnchors[i];
    var fl = 0.72 + 0.22 * Math.sin(t * 9 + a.ph) + 0.1 * Math.sin(t * 23 + a.ph * 1.7);
    a.g.userData.flame.material.opacity = 0.7 * fl;
    a.g.userData.core.material.opacity = 0.85 * fl;
    var sc = 0.9 + 0.14 * Math.sin(t * 13 + a.ph);
    a.g.userData.flame.scale.set(0.95 * sc, 0.95 * sc, 1);
    a.used = false;
  }
  var pool = state.quality === 'high' ? sconceLights.length : 2;
  for (var p = 0; p < sconceLights.length; p++) sconceLights[p].anchor = null;
  for (var s = 0; s < pool; s++){
    var best = -1, bestD = 1e9;
    for (var j = 0; j < sconceAnchors.length; j++){
      var an = sconceAnchors[j];
      if (an.used) continue;
      var dx = an.x - player.x, dz = an.z - player.z, dd = dx * dx + dz * dz;
      if (dd < bestD){ bestD = dd; best = j; }
    }
    if (best < 0) break;
    sconceAnchors[best].used = true;
    sconceLights[s].anchor = sconceAnchors[best];
  }
  for (var q = 0; q < sconceLights.length; q++){
    var L = sconceLights[q];
    if (L.anchor){
      L.light.position.set(L.anchor.x, L.anchor.y, L.anchor.z);
      L.light.intensity = Math.max(0, 1.4 + 0.5 * Math.sin(t * 11 + L.anchor.ph) + 0.25 * Math.sin(t * 27 + L.anchor.ph * 2));
    } else L.light.intensity = 0;
  }
}

/* ---- ambient dust motes ---- */
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

/* ---- treasure: the Heart of the Maze (a distinct, glowing chamber) ---- */
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

  // gold light spilling across the floor (flat additive disc)
  var spill = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 28),
    new THREE.MeshBasicMaterial({ map: glowMap, color: 0xffb84d, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  spill.rotation.x = -Math.PI / 2; spill.position.y = 0.05;
  treasure.add(spill); treasure.userData.spill = spill;

  var aura = makeGlow(0xffce6b, 7, 0.5); aura.position.y = 1;
  treasure.add(aura); treasure.userData.aura = aura;
  var tl = new THREE.PointLight(0xffc866, 1.4, 16, 2); tl.position.y = 1.3;
  treasure.add(tl); treasure.userData.light = tl;
  var spillLight = new THREE.PointLight(0xffb060, 0.9, 26, 2); spillLight.position.y = 0.6;
  treasure.add(spillLight); treasure.userData.spillLight = spillLight;

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

  /* chamber dust drifting in the gold light */
  var CN = 46, cp = new Float32Array(CN * 3);
  for (var j = 0; j < CN; j++){
    cp[j * 3] = (Math.random() - 0.5) * 6;
    cp[j * 3 + 1] = 0.2 + Math.random() * 3.4;
    cp[j * 3 + 2] = (Math.random() - 0.5) * 6;
  }
  var cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  var cdust = new THREE.Points(cg, new THREE.PointsMaterial({
    color: 0xffd9a0, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  treasure.add(cdust); treasure.userData.cdust = cdust;
})();
scene.add(treasure);

/* ---- (re)build the maze for a round from a server-sent grid ---- */
export function buildMaze(grid, treasureT){
  var maze = createMaze(grid);
  buildWalls(maze);
  buildSconces(maze);
  treasure.position.set(WX(treasureT.x), 0, WX(treasureT.z));
  return maze;
}

/* ---- per-frame world animation (torch follows the player) ---- */
export function animateWorld(dt, t, player){
  torch.position.set(
    player.x - Math.sin(player.yaw) * 0.4,
    EYE + 0.15,
    player.z - Math.cos(player.yaw) * 0.4
  );
  torch.intensity = 1.55 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23 + 1.7) * 0.08;

  updateSconces(t, player);

  var u = treasure.userData;
  var pulse = 0.8 + 0.2 * Math.sin(t * 2.4);
  u.heart.scale.setScalar(0.9 + 0.18 * Math.sin(t * 3));
  u.light.intensity = 1.2 + 0.5 * Math.sin(t * 2.4);
  u.spillLight.intensity = 0.7 + 0.3 * pulse;
  u.aura.material.opacity = 0.35 + 0.2 * pulse;
  u.spill.material.opacity = 0.4 + 0.18 * pulse;
  u.spill.scale.setScalar(1 + 0.04 * Math.sin(t * 1.7));

  var sp = u.sparks.geometry.attributes.position;
  for (var i = 0; i < sp.count; i++){
    var y = sp.getY(i) + dt * (0.5 + (i % 5) * 0.14);
    if (y > 2.4) y = 0.1;
    sp.setY(i, y);
  }
  sp.needsUpdate = true;

  var cd = u.cdust.geometry.attributes.position;
  for (var m = 0; m < cd.count; m++){
    var cy = cd.getY(m) + dt * (0.12 + (m % 4) * 0.04);
    if (cy > 3.6) cy = 0.2;
    cd.setY(m, cy);
    cd.setX(m, cd.getX(m) + Math.sin(t * 0.5 + m) * dt * 0.05);
  }
  cd.needsUpdate = true;

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
