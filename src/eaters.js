// Renders the Darkness Eaters from server snapshots (the AI lives on the
// server). Each Eater is a tattered floating-cloak silhouette with animated
// distortion, ember eyes that leave faint light trails while chasing, and a
// wispy smoke trail. Particles/trails are High-graphics only; the cloak +
// eyes render on both tiers (the cloak shader is cheap).
import { THREE } from './three.js';
import { scene, makeGlow } from './scene.js';
import { state } from './state.js';

var CLOAK_H = 2.6;

/* ---- shared assets ---- */
var cloakGeo = new THREE.ConeGeometry(0.95, CLOAK_H, 20, 12, true);
var hoodMat = new THREE.MeshStandardMaterial({ color: 0x07070d, roughness: 0.7, metalness: 0.05, emissive: 0x140826, emissiveIntensity: 0.5 });
var eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4d1a });

var CLOAK_VERT = [
  'uniform float uTime; uniform float uChase;',
  'varying float vY; varying vec3 vNormalV;',
  'void main(){',
  '  vec3 p = position;',
  '  float yy = (p.y + ' + (CLOAK_H * 0.5).toFixed(3) + ') / ' + CLOAK_H.toFixed(3) + ';', // 0 hem .. 1 hood
  '  float hem = smoothstep(0.6, 0.0, yy);',
  '  float sway = sin(p.y * 2.5 + uTime * 2.5) * 0.14 + sin(p.y * 5.0 - uTime * 3.5 + p.x * 3.0) * 0.07;',
  '  p.x += sway * hem * (1.0 + uChase * 0.7);',
  '  p.z += cos(p.y * 3.0 + uTime * 2.0) * 0.12 * hem * (1.0 + uChase * 0.7);',
  '  vY = yy;',
  '  vNormalV = normalize(normalMatrix * normal);',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
  '}'
].join('\n');

var CLOAK_FRAG = [
  'uniform float uChase; uniform vec3 uColor; uniform vec3 uRim;',
  'varying float vY; varying vec3 vNormalV;',
  'void main(){',
  '  float ang = atan(vNormalV.x, vNormalV.y);',                 // stable per-facet angle
  '  float hemEdge = 0.15 + 0.09 * sin(ang * 11.0) + 0.05 * sin(ang * 23.0 + 1.7);',
  '  if (vY < hemEdge) discard;',                                // ragged, tattered hem
  '  float rim = pow(1.0 - clamp(abs(vNormalV.z), 0.0, 1.0), 2.0);',
  '  vec3 col = mix(uColor, uRim, rim * (0.22 + 0.45 * uChase));',   // shadowy body, violet edge
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

/* ---- soft round particle texture + a per-particle-alpha Points system ---- */
var partTex = (function(){
  var c = document.createElement('canvas'); c.width = c.height = 64;
  var g = c.getContext('2d');
  var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function makeParticles(count, color){
  var pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
  var alpha = new Float32Array(count), psize = new Float32Array(count), fade = new Float32Array(count);
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('psize', new THREE.BufferAttribute(psize, 1));
  var mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTex: { value: partTex } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: [
      'attribute float alpha; attribute float psize; varying float vA;',
      'void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);',
      '  gl_PointSize = psize * (300.0 / max(0.001, -mv.z)); gl_Position = projectionMatrix * mv; }'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor; uniform sampler2D uTex; varying float vA;',
      'void main(){ if (vA <= 0.001) discard; vec4 t = texture2D(uTex, gl_PointCoord);',
      '  gl_FragColor = vec4(uColor, t.a * vA); }'
    ].join('\n')
  });
  var pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  scene.add(pts);
  return { pts: pts, geo: geo, pos: pos, vel: vel, alpha: alpha, psize: psize, fade: fade, count: count, cur: 0 };
}
function emit(s, x, y, z, vx, vy, vz, size, a, fade){
  var i = s.cur; s.cur = (s.cur + 1) % s.count;
  s.pos[i * 3] = x; s.pos[i * 3 + 1] = y; s.pos[i * 3 + 2] = z;
  s.vel[i * 3] = vx; s.vel[i * 3 + 1] = vy; s.vel[i * 3 + 2] = vz;
  s.alpha[i] = a; s.psize[i] = size; s.fade[i] = fade;
}
function stepParticles(s, dt){
  var any = false;
  for (var i = 0; i < s.count; i++){
    if (s.alpha[i] <= 0) continue;
    any = true;
    s.pos[i * 3] += s.vel[i * 3] * dt;
    s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
    s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
    s.alpha[i] = Math.max(0, s.alpha[i] - s.fade[i] * dt);
  }
  if (any){ s.geo.attributes.position.needsUpdate = true; s.geo.attributes.alpha.needsUpdate = true; s.geo.attributes.psize.needsUpdate = true; }
}
function disposeParticles(s){ scene.remove(s.pts); s.geo.dispose(); s.pts.material.dispose(); }

/* ---- eater meshes ---- */
function makeMesh(){
  var g = new THREE.Group();
  var cloakMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uChase: { value: 0 },
      uColor: { value: new THREE.Color(0x07070d) }, uRim: { value: new THREE.Color(0x7a45ff) } },
    vertexShader: CLOAK_VERT, fragmentShader: CLOAK_FRAG, side: THREE.DoubleSide
  });
  var cloak = new THREE.Mesh(cloakGeo, cloakMat); cloak.position.y = CLOAK_H * 0.5;
  var hood = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 9), hoodMat); hood.position.y = 2.0;
  var e1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat); e1.position.set(0.15, 2.04, 0.34);
  var e2 = e1.clone(); e2.position.x = -0.15;
  var aura = makeGlow(0x7a45ff, 3.6, 0.28); aura.position.y = 1.4;
  var eyeGlow = makeGlow(0xff5522, 1.2, 0.5); eyeGlow.position.set(0, 2.04, 0.3);
  g.add(cloak, hood, e1, e2, aura, eyeGlow);
  g.userData = { cloakMat: cloakMat, e1: e1, e2: e2, aura: aura, eyeGlow: eyeGlow };
  return g;
}

var list = [];   // { g, u, tx, tz, try_, chase, chaseF, ph, smoke, trail, smokeAcc, trailAcc }

export function sync(eaters){
  while (list.length < eaters.length){
    var g = makeMesh(); scene.add(g);
    list.push({ g: g, u: g.userData, tx: 0, tz: 0, try_: 0, chase: 0, chaseF: 0,
                ph: Math.random() * 6, smoke: null, trail: null, smokeAcc: 0, trailAcc: 0 });
  }
  while (list.length > eaters.length){
    var e = list.pop();
    scene.remove(e.g);
    if (e.smoke) disposeParticles(e.smoke);
    if (e.trail) disposeParticles(e.trail);
  }
  for (var i = 0; i < eaters.length; i++){
    var s = eaters[i], en = list[i];
    en.tx = s.x; en.tz = s.z; en.try_ = s.ry; en.chase = s.chase;
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
  var high = state.quality === 'high';
  for (var i = 0; i < list.length; i++){
    var e = list[i], u = e.u, chase = e.chase;
    e.g.position.x += (e.tx - e.g.position.x) * k;
    e.g.position.z += (e.tz - e.g.position.z) * k;
    e.g.position.y = Math.sin(t * 2 + e.ph) * 0.12 + 0.06;
    e.g.rotation.y = lerpAngle(e.g.rotation.y, e.try_, k);

    e.chaseF += (chase - e.chaseF) * Math.min(1, dt * 4);
    u.cloakMat.uniforms.uTime.value = t + e.ph;
    u.cloakMat.uniforms.uChase.value = e.chaseF;

    var sc = 1 + (chase ? (0.5 + 0.5 * Math.sin(t * 10 + e.ph)) * 0.7 : 0.15 * Math.sin(t * 3 + e.ph));
    u.e1.scale.setScalar(sc); u.e2.scale.setScalar(sc);
    u.eyeGlow.material.opacity = chase ? 0.95 : 0.45;
    u.aura.material.opacity = chase ? 0.5 : 0.26;

    if (high){
      if (!e.smoke) e.smoke = makeParticles(28, 0x7d5f96);
      if (!e.trail) e.trail = makeParticles(18, 0xff5522);

      var px = e.g.position.x, pz = e.g.position.z, ry = e.g.rotation.y;
      var fx = Math.sin(ry), fz = Math.cos(ry);   // forward; smoke trails behind

      // wispy smoke from the hem, always (denser when chasing)
      e.smokeAcc += dt;
      var smokeStep = chase ? 0.045 : 0.09;
      while (e.smokeAcc > smokeStep){
        e.smokeAcc -= smokeStep;
        emit(e.smoke,
          px + (Math.random() - 0.5) * 0.7, 0.25 + Math.random() * 0.4, pz + (Math.random() - 0.5) * 0.7,
          -fx * 0.3 + (Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.5, -fz * 0.3 + (Math.random() - 0.5) * 0.2,
          0.85 + Math.random() * 0.6, 0.5, 0.5);
      }
      // ember eye trails while chasing
      if (chase){
        e.trailAcc += dt;
        while (e.trailAcc > 0.03){
          e.trailAcc -= 0.03;
          for (var s2 = 0; s2 < 2; s2++){
            var ox = (s2 === 0 ? 0.15 : -0.15), oz = 0.34;
            var ex = px + (ox * Math.cos(ry) + oz * Math.sin(ry));
            var ez = pz + (-ox * Math.sin(ry) + oz * Math.cos(ry));
            emit(e.trail, ex, 2.04 + e.g.position.y, ez, 0, 0.1, 0, 0.34, 0.85, 2.2);
          }
        }
      }
      stepParticles(e.smoke, dt);
      stepParticles(e.trail, dt);
    }
  }
}
