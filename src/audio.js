// Fully procedural audio via the Web Audio API: a droning ambient bed plus
// short synthesized one-shots (footsteps, heartbeat, whispers, stings, chimes).
var Sfx = {
  ctx: null, master: null, muted: false,
  init: function(){
    if (this.ctx) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      var g = this.ctx.createGain(); g.gain.value = 0.05; g.connect(this.master);
      var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; f.connect(g);
      var o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 54; o1.connect(f); o1.start();
      var o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 55.1; o2.connect(f); o2.start();
      var lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
      var lg = this.ctx.createGain(); lg.gain.value = 0.02;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      var nb = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      var ch = nb.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      var ns = this.ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
      var nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 420; nf.Q.value = 0.6;
      var ng = this.ctx.createGain(); ng.gain.value = 0.015;
      ns.connect(nf); nf.connect(ng); ng.connect(this.master); ns.start();
    } catch (e) {}
  },
  env: function(freq, type, dur, vol, slide){
    if (!this.ctx || this.muted) return;
    try {
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  noise: function(dur, vol, fq){
    if (!this.ctx || this.muted) return;
    try {
      var t = this.ctx.currentTime;
      var b = this.ctx.createBuffer(1, Math.max(1, (this.ctx.sampleRate * dur) | 0), this.ctx.sampleRate);
      var d = b.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      var s = this.ctx.createBufferSource(); s.buffer = b;
      var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fq;
      var g = this.ctx.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t);
    } catch (e) {}
  },
  beat: function(i){ this.env(76, 'sine', 0.16, 0.22 + 0.3 * i, 44); },
  step: function(sp){ this.noise(0.07, sp ? 0.1 : 0.055, 900); },
  whisper: function(){ this.noise(0.7, 0.1, 300); },
  sting: function(){ this.env(300, 'sawtooth', 0.7, 0.32, 48); this.env(180, 'square', 0.5, 0.18, 40); },
  blip: function(){ this.env(880, 'sine', 0.12, 0.12); },
  chime: function(){
    var self = this;
    self.env(660, 'sine', 0.5, 0.2);
    setTimeout(function(){ self.env(990, 'sine', 0.8, 0.2); }, 140);
    setTimeout(function(){ self.env(1320, 'sine', 1.1, 0.16); }, 300);
  }
};

export { Sfx };
