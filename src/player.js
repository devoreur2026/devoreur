// The local player: movement/stamina/collision, camera application, and all
// input (keyboard, mouse + pointer-lock, touch sticks). Also droppable beacons,
// since dropping one is an input action (E / on-screen).
import { THREE } from './three.js';
import { EYE, WALK, SPRINT } from './config.js';
import { WX, isWall, blocked } from './maze.js';
import { Sfx } from './audio.js';
import { camera, canvas, scene, makeGlow } from './scene.js';
import { state } from './state.js';
import { toggleMute } from './game.js';

export var player = { x: WX(1), z: WX(1), yaw: 0, pitch: 0, stamina: 100, bob: 0, moving: false, speed: 0, invuln: 0 };
export function resetYaw(){
  player.yaw = !isWall(1, 2) ? Math.PI : -Math.PI / 2;
  player.pitch = 0;
}
resetYaw();

var keys = {}, footTimer = 0;

/* ---- beacons ---- */
export var markers = [];
export function dropMarker(){
  if (!state.playing) return;
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
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', function(e){ keys[e.code] = false; });
window.addEventListener('blur', function(){ keys = {}; dragging = false; });

var dragging = false, lastMX = 0, lastMY = 0;
canvas.addEventListener('mousedown', function(e){
  dragging = true; lastMX = e.clientX; lastMY = e.clientY;
  if (state.playing && document.pointerLockElement !== canvas){
    try { canvas.requestPointerLock(); } catch (err) {}
  }
});
window.addEventListener('mouseup', function(){ dragging = false; });
window.addEventListener('mousemove', function(e){
  if (!state.playing) return;
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

export function updatePlayer(dt){
  var f = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
  var s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (keys.ArrowLeft) player.yaw += 2.4 * dt;
  if (keys.ArrowRight) player.yaw -= 2.4 * dt;
  f += -mvVec.y; s += mvVec.x;
  var len = Math.sqrt(f * f + s * s);
  player.moving = len > 0.01;
  var wantSprint = (keys.ShiftLeft || keys.ShiftRight || len > 1.4) && player.moving;
  var spd = WALK;
  if (wantSprint && player.stamina > 2){
    spd = SPRINT;
    player.stamina = Math.max(0, player.stamina - 24 * dt);
  } else {
    player.stamina = Math.min(100, player.stamina + (player.moving ? 9 : 16) * dt);
  }
  player.speed = player.moving ? spd : 0;
  if (player.moving){
    var inv = 1 / Math.max(1, len), fx = f * inv, sx = s * inv;
    var sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    var dx = (-sin * fx + cos * sx) * spd * dt;
    var dz = (-cos * fx - sin * sx) * spd * dt;
    var nx = player.x + dx; if (!blocked(nx, player.z)) player.x = nx;
    var nz = player.z + dz; if (!blocked(player.x, nz)) player.z = nz;
    player.bob += spd * dt * 1.35;
    footTimer -= dt;
    if (footTimer <= 0){ footTimer = spd > WALK ? 0.3 : 0.46; Sfx.step(spd > WALK); }
  } else {
    footTimer = 0.1;
  }
}
export function applyCamera(){
  camera.position.set(player.x, EYE + Math.sin(player.bob) * 0.05, player.z);
  camera.rotation.set(player.pitch, player.yaw, Math.sin(player.bob * 0.5) * 0.008, 'YXZ');
}
