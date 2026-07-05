// Entry point: the render/update loop. Predicts the local player, reconciles
// with the server's authoritative position, sends inputs, and renders the
// interpolated remote players and eaters from the latest snapshot.
import { THREE } from './three.js';
import { MSG } from '../shared/protocol.js';
import { state } from './state.js';
import { renderer, scene, camera, animateWorld } from './scene.js';
import { player, updatePlayer, applyCamera, reconcile } from './player.js';
import { net } from './net.js';
import * as remotePlayers from './remotePlayers.js';
import * as eaters from './eaters.js';
import { updateHud } from './hud.js';
import './game.js';   // registers server-event hooks + overlay buttons

var clock = new THREE.Clock(), t = 0, lastSend = 0;
var SEND_HZ = 30;

function loop(){
  requestAnimationFrame(loop);
  var dt = Math.min(0.05, clock.getDelta());
  t += dt;

  if (state.phase === 'playing'){
    updatePlayer(dt);
    var me = net.self();
    if (me) reconcile(me.x, me.z);            // snap back if the server disagrees
    if (t - lastSend > 1 / SEND_HZ){
      lastSend = t;
      net.send({ t: MSG.INPUT, x: player.x, z: player.z, yaw: player.yaw });
    }
  } else if (state.phase === 'menu'){
    player.yaw += dt * 0.05;                  // slow drift behind the start screen
  }

  remotePlayers.sync(net.players, net.id);
  remotePlayers.render(dt);
  eaters.sync(net.eaters);
  eaters.render(dt, t);
  animateWorld(dt, t, player);
  applyCamera();
  updateHud(dt);
  renderer.render(scene, camera);
}
loop();

window.addEventListener('resize', function(){
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
