"use strict";
/*
 * FERROFRENZY audio — every sound is synthesized with WebAudio.
 * No audio files, no network. The context is created lazily on the
 * first user gesture (browser autoplay policy).
 */
(function () {
  function FerroAudio() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  FerroAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  };

  FerroAudio.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  };

  // One enveloped oscillator blip.
  FerroAudio.prototype.tone = function (freq, dur, type, vol, slideTo, delay) {
    if (!this.ensure()) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  };

  // Short filtered noise burst (shatters, impacts).
  FerroAudio.prototype.noise = function (dur, vol, freq, delay) {
    if (!this.ensure()) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 1800; f.Q.value = 0.8;
    var g = this.ctx.createGain(); g.gain.value = vol || 0.25;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  };

  FerroAudio.prototype.click = function () { this.tone(660, 0.06, "triangle", 0.15); };
  FerroAudio.prototype.flip = function (toNorth) {
    // Whoosh up for north, down for south.
    this.tone(toNorth ? 300 : 620, 0.14, "sawtooth", 0.06, toNorth ? 720 : 240);
    this.noise(0.08, 0.05, 2600);
  };
  FerroAudio.prototype.capture = function (combo) {
    var base = 440 * Math.pow(1.059, Math.min(combo, 16)); // rises with combo
    this.tone(base, 0.12, "sine", 0.22);
    this.tone(base * 1.5, 0.16, "sine", 0.14, null, 0.04);
  };
  FerroAudio.prototype.shatter = function () {
    this.noise(0.16, 0.22, 2400);
    this.tone(1180, 0.08, "square", 0.05, 300);
  };
  FerroAudio.prototype.mineBoom = function () {
    this.noise(0.4, 0.4, 300);
    this.tone(120, 0.4, "sine", 0.4, 38);
  };
  FerroAudio.prototype.damage = function () {
    this.tone(160, 0.25, "sawtooth", 0.28, 60);
    this.noise(0.2, 0.2, 500);
  };
  FerroAudio.prototype.pulse = function () {
    this.tone(180, 0.5, "sine", 0.3, 1400);
    this.noise(0.35, 0.12, 900);
  };
  FerroAudio.prototype.place = function () {
    // Anchor set down: a soft magnetic thunk + confirm blip.
    this.tone(140, 0.16, "sine", 0.3, 70);
    this.tone(880, 0.1, "triangle", 0.14, null, 0.05);
    this.noise(0.06, 0.08, 700);
  };
  FerroAudio.prototype.lens = function () {
    // A shard through a lens: two chirps trading places, high-low swap.
    this.tone(990, 0.09, "sine", 0.10, 1480);
    this.tone(1480, 0.11, "sine", 0.08, 990, 0.05);
  };
  FerroAudio.prototype.split = function () {
    // Twincore cracking open: bright snap + two diverging chirps.
    this.noise(0.12, 0.2, 3200);
    this.tone(740, 0.14, "square", 0.07, 1480);
    this.tone(988, 0.14, "square", 0.07, 494, 0.03);
  };
  FerroAudio.prototype.wave = function () {
    this.tone(392, 0.14, "triangle", 0.18);
    this.tone(523, 0.14, "triangle", 0.18, null, 0.11);
    this.tone(659, 0.22, "triangle", 0.18, null, 0.22);
  };
  FerroAudio.prototype.win = function () {
    var notes = [523, 659, 784, 1046, 784, 1046];
    for (var i = 0; i < notes.length; i++) this.tone(notes[i], 0.24, "triangle", 0.2, null, i * 0.13);
  };
  FerroAudio.prototype.lose = function () {
    var notes = [392, 330, 262, 196];
    for (var i = 0; i < notes.length; i++) this.tone(notes[i], 0.3, "sawtooth", 0.12, null, i * 0.17);
  };

  // Tiny bass + sparkle sequencer; runs only while a run is active.
  FerroAudio.prototype.startMusic = function () {
    if (!this.ensure() || this.musicTimer) return;
    var self = this;
    var bass = [55, 55, 82.4, 55, 65.4, 55, 98, 73.4]; // A1 groove
    this.musicTimer = setInterval(function () {
      if (self.muted) { self.musicStep++; return; }
      var s = self.musicStep++;
      self.tone(bass[s % bass.length], 0.22, "triangle", 0.10);
      if (s % 2 === 0) self.tone(220 * Math.pow(1.5, (s >> 1) % 3), 0.1, "sine", 0.035);
    }, 240);
  };
  FerroAudio.prototype.stopMusic = function () {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  };

  window.FERRO_AUDIO = new FerroAudio();
})();
