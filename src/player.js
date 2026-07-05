// The local player with real client-side prediction + reconciliation.
//
// Every frame we emit fixed-timestep input commands (60Hz), each with a
// sequence id, integrate them locally with the shared movement step, keep them
// in a history buffer, and send them to the server. Each server snapshot acks
// the last input it processed; on receiving one we set ourselves to the server
// position and REPLAY every still-unacknowledged input — so we end up where the
// server will be once it catches up, instead of snapping to a stale position.
// Any remaining correction is blended out over ~100ms via a decaying visual
// offset (no teleporting), and we render-interpolate between sim steps so the
// camera stays smooth regardless of frame rate.
import { THREE } from './three.js';
import { EYE, WALK, SPRINT, INPUT_STEP } from '../shared/config.js';
import { WX } from '../shared/maze.js';
import { moveStep } from '../shared/movement.js';
import { Sfx } from './audio.js';
import { camera, canvas, scene, makeGlow } from './scene.js';
import { state } from './state.js';

var STEP = INPUT_STEP;          // fixed input timestep (seconds)
var MAX_STEPS = 5;              // per-frame step cap (drops backlog after a stall)
var CORRECT_TAU = 10;           // offset decay rate (~100ms blend)
var SNAP = 2.5;                 // above this, a correction is a real jump (respawn/teleport) -> snap

// public: x/z are the RENDER position (used by camera, HUD, world). Movement
// prediction lives in the private px/pz below.
export var player = { x: 0, z: 0, yaw: 0, pitch: 0, stamina: 100, bob: 0, moving: false, speed: 0, invuln: 0 };

var maze = null;
export function setMaze(m){ maze = m; }

// prediction state
var px = 0, pz = 0;             // latest simulated step position
var ppx = 0, ppz = 0;          // previous step position (for render interpolation)
var ox = 0, oz = 0;            // smooth correction offset (decays to 0)
var acc = 0, seq = 0;
var history = [];              // unacked input commands, in order

export function resetYaw(){
  player.yaw = (maze && !maze.isWall(1, 2)) ? Math.PI : -Math.PI / 2;
  player.pitch = 0;
}
export function spawnAtStart(startT){
  px = ppx = WX(startT.x); pz = ppz = WX(startT.z);
  ox = oz = 0; acc = 0; history.length = 0;
  player.x = px; player.z = pz;
  player.stamina = 100; player.bob = 0;
  resetYaw();
}

var keys = {}, footTimer = 0;

/* ---- beacons (local only) ---- */
export var markers = [];
export function dropMarker(){
  if (state.phase !== 'playing') return;
  var mk;
  if (markers.length >= 15){
    mk = markers.shift();
  } else {
    mk = new THREE.Group();
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0x5ef2ff }));
    cone.position.y = 0.28;
    var gl = makeGlow(0x5ef2ff, 1.7, 0.65); gl.position.y = 0.35;
    mk.add(cone, gl);
    scene.add(mk);
  }
  mk.position.set(player.x, 0, player.z);
  markers.push(mk);
  Sfx.blip();
}

window.addEventListener('keydown', function(e){
  keys[e.code] = true;
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyE') dropMarker();
  // (mute lives on the ♪ button; the minimap is always on — see mapview.js)
});
window.addEventListener('keyup', function(e){ keys[e.code] = false; });
window.addEventListener('blur', function(){ keys = {}; dragging = false; });

var dragging = false, lastMX = 0, lastMY = 0;
canvas.addEventListener('mousedown', function(e){
  dragging = true; lastMX = e.clientX; lastMY = e.clientY;
  if (state.phase === 'playing' && document.pointerLockElement !== canvas){
    try { var pl = canvas.requestPointerLock(); if (pl && pl.catch) pl.catch(function(){}); } catch (err) {}
  }
});
window.addEventListener('mouseup', function(){ dragging = false; });
window.addEventListener('mousemove', function(e){
  if (state.phase !== 'playing') return;
  var mx = 0, my = 0;
  if (document.pointerLockElement === canvas){
    mx = e.movementX || 0; my = e.movementY || 0;
  } else if (dragging){
    mx = e.clientX - lastMX; my = e.clientY - lastMY;
    lastMX = e.clientX; lastMY = e.clientY;
  } else return;
  player.yaw -= mx * 0.0023;
  player.pitch -= my * 0.0021;
  player.pitch = Math.max(-1.25, Math.min(1.25, player.pitch));
});
canvas.addEventListener('contextmenu', function(e){ e.preventDefault(); });

/* touch: left half = move stick, right half = look */
var mvId = null, lkId = null, mvO = null, lkO = null, mvVec = { x: 0, y: 0 };
canvas.addEventListener('touchstart', function(e){
  for (var i = 0; i < e.changedTouches.length; i++){
    var t = e.changedTouches[i];
    if (t.clientX < window.innerWidth / 2 && mvId === null){ mvId = t.identifier; mvO = { x: t.clientX, y: t.clientY }; }
    else if (lkId === null){ lkId = t.identifier; lkO = { x: t.clientX, y: t.clientY }; }
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', function(e){
  for (var i = 0; i < e.changedTouches.length; i++){
    var t = e.changedTouches[i];
    if (t.identifier === mvId){
      mvVec.x = Math.max(-1, Math.min(1, (t.clientX - mvO.x) / 55));
      mvVec.y = Math.max(-1, Math.min(1, (t.clientY - mvO.y) / 55));
    } else if (t.identifier === lkId){
      player.yaw -= (t.clientX - lkO.x) * 0.005;
      player.pitch -= (t.clientY - lkO.y) * 0.004;
      player.pitch = Math.max(-1.25, Math.min(1.25, player.pitch));
      lkO = { x: t.clientX, y: t.clientY };
    }
  }
  e.preventDefault();
}, { passive: false });
function endTouch(e){
  for (var i = 0; i < e.changedTouches.length; i++){
    var t = e.changedTouches[i];
    if (t.identifier === mvId){ mvId = null; mvVec.x = 0; mvVec.y = 0; }
    if (t.identifier === lkId) lkId = null;
  }
}
canvas.addEventListener('touchend', endTouch);
canvas.addEventListener('touchcancel', endTouch);

// Build one fixed-step input command from the current controls, resolving
// sprint/stamina and driving footsteps/head-bob.
function buildCmd(sdt){
  var f = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
  var s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (keys.ArrowLeft) player.yaw += 2.4 * sdt;
  if (keys.ArrowRight) player.yaw -= 2.4 * sdt;
  f += -mvVec.y; s += mvVec.x;
  var len = Math.sqrt(f * f + s * s);
  player.moving = len > 0.01;
  var wantSprint = (keys.ShiftLeft || keys.ShiftRight || len > 1.4) && player.moving;
  var spd = WALK;
  if (wantSprint && player.stamina > 2){
    spd = SPRINT;
    player.stamina = Math.max(0, player.stamina - 24 * sdt);
  } else {
    player.stamina = Math.min(100, player.stamina + (player.moving ? 9 : 16) * sdt);
  }
  if (!player.moving) spd = 0;
  player.speed = spd;
  if (player.moving){
    player.bob += spd * sdt * 1.35;
    footTimer -= sdt;
    if (footTimer <= 0){ footTimer = spd > WALK ? 0.3 : 0.46; Sfx.step(spd > WALK); }
  } else {
    footTimer = 0.1;
  }
  return { dt: sdt, f: f, s: s, yaw: player.yaw, spd: spd };
}

// Advance prediction by fixed steps; returns the new commands to send.
export function collectInputs(dt){
  var out = [];
  if (state.phase !== 'playing' || !maze) return out;
  acc += dt;
  var n = 0;
  while (acc >= STEP && n < MAX_STEPS){
    acc -= STEP; n++;
    var cmd = buildCmd(STEP);
    ppx = px; ppz = pz;
    var np = moveStep(maze, px, pz, cmd);
    px = np.x; pz = np.z;
    cmd.seq = ++seq;
    history.push(cmd);
    out.push(cmd);
  }
  if (n === MAX_STEPS) acc = 0;   // stall backlog dropped, matching the server budget
  return out;
}

// On a fresh snapshot: prune acked inputs, reset to the server position, and
// replay the rest. Correction is absorbed into the visual offset (blended out),
// not snapped — unless it's a real jump (respawn/kill/teleport).
export function reconcile(sx, sz, ack){
  if (!maze || typeof ack !== 'number') return;
  while (history.length && history[0].seq <= ack) history.shift();
  var cx = sx, cz = sz;
  for (var i = 0; i < history.length; i++){
    var np = moveStep(maze, cx, cz, history[i]);
    cx = np.x; cz = np.z;
  }
  var shiftX = cx - px, shiftZ = cz - pz;
  px = cx; pz = cz;
  ppx += shiftX; ppz += shiftZ;   // translate the interp segment...
  ox -= shiftX; oz -= shiftZ;     // ...and compensate so the screen doesn't jump
  if (ox * ox + oz * oz > SNAP * SNAP){ ox = 0; oz = 0; ppx = px; ppz = pz; }
}

export function updateOffset(dt){
  var k = Math.min(1, dt * CORRECT_TAU);
  ox += (0 - ox) * k; oz += (0 - oz) * k;
}

export function applyCamera(){
  var alpha = acc / STEP; if (alpha > 1) alpha = 1;
  player.x = ppx + (px - ppx) * alpha + ox;
  player.z = ppz + (pz - ppz) * alpha + oz;
  camera.position.set(player.x, EYE + Math.sin(player.bob) * 0.05, player.z);
  camera.rotation.set(player.pitch, player.yaw, Math.sin(player.bob * 0.5) * 0.008, 'YXZ');
}
