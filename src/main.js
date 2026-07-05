// Entry point: the render/update loop. Predicts the local player, reconciles
// with the server's authoritative position, sends inputs, and renders the
// interpolated remote players and eaters from the latest snapshot.
import { THREE } from './three.js';
import { MSG } from '../shared/protocol.js';
import { state } from './state.js';
import { renderer, scene, camera, animateWorld } from './scene.js';
import { player, collectInputs, updateOffset, applyCamera, reconcile } from './player.js';
import { net } from './net.js';
import * as remotePlayers from './remotePlayers.js';
import * as eaters from './eaters.js';
import * as postfx from './postfx.js';
import * as mapview from './mapview.js';
import { updateHud } from './hud.js';
import './game.js';   // registers server-event hooks + overlay buttons

window.UMBRA = { net, player, state };   // dev handle for debugging/inspection

var clock = new THREE.Clock(), t = 0, lastSend = 0, lastRev = 0;
var SEND_HZ = 30;                                  // batch fixed-step inputs into ~30 packets/s
var sendBuf = [];

function loop(){
  requestAnimationFrame(loop);
  var dt = Math.min(0.05, clock.getDelta());       // clamp dt: a frame drop can't make one giant step
  t += dt;

  if (state.phase === 'playing'){
    var cmds = collectInputs(dt);                  // fixed-step prediction -> new input commands
    for (var i = 0; i < cmds.length; i++) sendBuf.push(cmds[i]);
    if (sendBuf.length && t - lastSend > 1 / SEND_HZ){
      lastSend = t;
      net.send({ t: MSG.INPUT, cmds: sendBuf });
      sendBuf = [];
    }
    if (net.rev !== lastRev){                       // reconcile once per fresh snapshot
      lastRev = net.rev;
      var me = net.self();
      if (me) reconcile(me.x, me.z, me.ack);
    }
  } else if (state.phase === 'menu'){
    player.yaw += dt * 0.05;                        // slow drift behind the start screen
  }
  updateOffset(dt);                                 // blend out any correction over ~100ms

  applyCamera();                                    // sets player.x/z (render pos) + camera
  remotePlayers.sync(net.players, net.id);
  remotePlayers.render(dt);
  eaters.sync(net.eaters);
  eaters.render(dt, t);
  animateWorld(dt, t, player);
  mapview.update();
  updateHud(dt);

  if (state.quality === 'high') postfx.render(t);   // bloom + grain + vignette
  else renderer.render(scene, camera);              // lighter path for phones
}
loop();

window.addEventListener('resize', function(){
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});
