// Entry point: owns the render/update loop, advances the shared clock/state,
// checks the win condition, and wires the keeper kill callback to game.die.
import { THREE } from './three.js';
import { state } from './state.js';
import { renderer, scene, camera, treasure, animateWorld } from './scene.js';
import { player, updatePlayer, applyCamera } from './player.js';
import { updateField, updateKeepers } from './enemies.js';
import { updateBots } from './bots.js';
import { updateHud } from './hud.js';
import { die, win } from './game.js';

var clock = new THREE.Clock(), t = 0;
function loop(){
  requestAnimationFrame(loop);
  var dt = Math.min(0.05, clock.getDelta());
  t += dt;

  if (state.playing){
    state.time += dt;
    player.invuln = Math.max(0, player.invuln - dt);
    updatePlayer(dt);
    updateField(dt);
    var ddx = treasure.position.x - player.x, ddz = treasure.position.z - player.z;
    if (Math.sqrt(ddx * ddx + ddz * ddz) < 2.0) win();
  } else if (!state.ended){
    player.yaw += dt * 0.05;   // slow drift on menus
  }

  var nearest = updateKeepers(dt, t, die);
  updateBots(dt, t);
  animateWorld(dt, t, player);
  applyCamera();
  updateHud(dt, nearest);
  renderer.render(scene, camera);
}
loop();

window.addEventListener('resize', function(){
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
