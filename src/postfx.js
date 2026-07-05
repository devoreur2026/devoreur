// Post-processing (High graphics only): EffectComposer with UnrealBloomPass so
// the treasure, Eater eyes and beacons truly bloom, then one combined final
// pass that adds a subtle vignette + animated film grain. The bloom/composer
// classes come from the vendored legacy example scripts (global THREE.*).
import { THREE } from './three.js';
import { renderer, scene, camera } from './scene.js';

var composer = null, bloom = null, finalPass = null;

// Vignette + film grain, applied after bloom. The composer's render target is
// linear, so we also encode to sRGB here (matching the direct-render path).
var GrainVignette = {
  uniforms: {
    tDiffuse: { value: null },
    uTime:    { value: 0 },
    uGrain:   { value: 0.05 },
    uVig:     { value: 1.1 }   // vignette strength
  },
  vertexShader: [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
  ].join('\n'),
  fragmentShader: [
    'uniform sampler2D tDiffuse;',
    'uniform float uTime; uniform float uGrain; uniform float uVig;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
    'void main(){',
    '  vec4 c = texture2D(tDiffuse, vUv);',
    '  vec2 d = vUv - 0.5;',
    '  float vig = smoothstep(0.78, 0.2, dot(d, d) * uVig);',     // darken corners
    '  c.rgb *= mix(0.5, 1.0, vig);',
    '  c.rgb = pow(clamp(c.rgb, 0.0, 1.0), vec3(1.0/2.2));',      // linear -> sRGB (display)',
    '  float g = hash(vUv * (1.0 + fract(uTime)) + uTime);',      // animated grain, in display space',
    '  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));',
    '  c.rgb += (g - 0.5) * uGrain * (0.35 + 0.65 * luma);',      // subtler in shadows',
    '  gl_FragColor = vec4(c.rgb, 1.0);',
    '}'
  ].join('\n')
};

function build(){
  var w = window.innerWidth, h = window.innerHeight;
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));

  bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h),
    0.72,   // strength
    0.6,    // radius
    0.72);  // threshold — only bright emissive/additive things bloom
  composer.addPass(bloom);

  finalPass = new THREE.ShaderPass(GrainVignette);
  finalPass.renderToScreen = true;
  composer.addPass(finalPass);

  composer.setSize(w, h);
}

export function ready(){ return !!composer; }
export function setSize(w, h){ if (composer) composer.setSize(w, h); }

// Render the frame through the composer. `t` is elapsed seconds (grain seed).
export function render(t){
  if (!composer) build();
  finalPass.uniforms.uTime.value = t;
  composer.render();
}
