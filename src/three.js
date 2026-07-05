// Three.js r128 is loaded as a global (UMD build) by a classic <script> tag in
// index.html, which runs before these deferred ES modules. We re-export the
// global here so every module can `import { THREE } from './three.js'` cleanly
// instead of reaching for window.THREE all over the place.
export const THREE = window.THREE;
