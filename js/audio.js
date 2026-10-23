// Ambient sound, synthesised live with Web Audio (no sound files needed): wind, lake lapping, waterfall roar, birdsong.
export class Ambience {
  constructor(muted) { this.muted = muted; this.ctx = null; this.gust = 0; this.gustTarget = 0.3; this.gustT = 0; this.next = 0; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 4, white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
    const loop = buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 4); return s; };
    const filter = (type, f, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };

    this.windF = filter('lowpass', 500); this.windG = gain(0.2);
    loop(brown).connect(this.windF).connect(this.windG).connect(this.master);
    this.pineF = filter('bandpass', 1400, 0.6); this.pineG = gain(0.01);      // hiss of wind in the pines
    loop(white).connect(this.pineF).connect(this.pineG).connect(this.master);
    this.lapG = gain(0);                                                         // small waves on the shore
    loop(white).connect(filter('bandpass', 450, 1.2)).connect(this.lapG).connect(this.master);
    this.fallG = gain(0);
    this.fallP = ctx.createStereoPanner ? ctx.createStereoPanner() : gain(1);
    loop(white).connect(filter('highpass', 120)).connect(filter('lowpass', 2400)).connect(this.fallG).connect(this.fallP).connect(this.master);

    document.addEventListener('visibilitychange', () => document.hidden ? ctx.suspend() : ctx.resume());
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // o = { alt: metres above lake, shore: metres above water at your feet, fallDist, fallPan (-1..1) }
  update(dt, o) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, 0.3);
    if ((this.gustT -= dt) <= 0) { this.gustTarget = Math.random() ** 2; this.gustT = 2 + Math.random() * 5; }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.6);
    const alt = Math.min(1, Math.max(0, o.alt / 500));
    set(this.windG.gain, 0.08 + this.gust * 0.25 + alt * 0.15);
    set(this.windF.frequency, 250 + this.gust * 700);
    set(this.pineG.gain, (0.006 + this.gust * 0.025) * (1 - alt * 0.7));
    set(this.lapG.gain, 0.05 * Math.max(0, 1 - o.shore / 6) * (0.55 + 0.45 * Math.sin(t * 1.3) * Math.sin(t * 0.71)));
    set(this.fallG.gain, 0.5 * Math.max(0, 1 - o.fallDist / 700) ** 2);
    if (this.fallP.pan) set(this.fallP.pan, o.fallPan * 0.8);
    if (t > this.next) {
      this.next = t + 0.6 + Math.random() * 3.5 * (1 + alt * 3);
      if (o.alt < 450) this.chirp();
    }
  }

  chirp() {
    const ctx = this.ctx, out = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (out.pan) out.pan.value = Math.random() * 1.6 - 0.8;
    out.connect(this.master);
    const trill = Math.random() < 0.4, notes = trill ? 6 + Math.floor(Math.random() * 8) : 2 + Math.floor(Math.random() * 4);
    const base = 1800 + Math.random() * 2600, vol = 0.012 + Math.random() * 0.035;
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const d = trill ? 0.04 + Math.random() * 0.02 : 0.08 + Math.random() * 0.12;
      const f0 = base * (0.85 + Math.random() * 0.3), f1 = f0 * (trill ? 1.25 : 0.6 + Math.random() * 0.9);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + d * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.02);
      t += d + (trill ? 0.015 : 0.05 + Math.random() * 0.12);
    }
  }
}
