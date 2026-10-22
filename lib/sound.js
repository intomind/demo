// Sounds made on the spot, no files: a chime for a coin, a rush for a
// ring, a thud for a rock. The context opens on the first call, which
// must follow a click.

let ctx = null;
let on = true;

function audio() {
  if (ctx === null) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setSound(enabled) { on = enabled; }
export function soundOn() { return on; }

function tone(freq, { type = "sine", gain = 0.08, attack = 0.005, decay = 0.12, slide = null, at = 0 } = {}) {
  const a = audio();
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== null) o.frequency.exponentialRampToValueAtTime(slide, t + decay);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

function rush(seconds = 0.35, gain = 0.12, from = 400, to = 3000) {
  const a = audio();
  const t = a.currentTime;
  const n = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + seconds);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + seconds);
  src.connect(f); f.connect(g); g.connect(a.destination);
  src.start(t);
}

const safe = (fn) => (...args) => { if (!on) return; try { fn(...args); } catch { /* no audio is not an error worth stopping for */ } };

/** The engine: one low voice that follows the pace, started on the first call after a click and silenced when the flight stops. */
let engine = null;
function engineAt(pace) {
  if (pace <= 0 || !on) { if (engine) { engine.gain.gain.setTargetAtTime(0, engine.ctx.currentTime, 0.08); } return; }
  if (engine === null) {
    const a = audio();
    const o = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = "sawtooth"; o2.type = "triangle";
    f.type = "lowpass"; f.Q.value = 0.8;
    g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(a.destination);
    o.start(); o2.start();
    engine = { ctx: a, o, o2, f, gain: g };
  }
  const t = engine.ctx.currentTime;
  engine.o.frequency.setTargetAtTime(46 + 26 * pace, t, 0.12);
  engine.o2.frequency.setTargetAtTime(92 + 52 * pace, t, 0.12);
  engine.f.frequency.setTargetAtTime(180 + 260 * pace, t, 0.12);
  engine.gain.gain.setTargetAtTime(0.018 + 0.014 * Math.min(2, pace - 1), t, 0.1);
}

export const sound = {
  engine: (pace) => { try { engineAt(pace); } catch { /* no audio is not an error worth stopping for */ } },
  near: safe(() => { rush(0.22, 0.09, 500, 1800); }),
  scrape: safe(() => { rush(0.15, 0.12, 3000, 600); tone(140, { type: "square", decay: 0.12, gain: 0.05 }); }),
  stage: safe(() => { tone(523, { type: "triangle", decay: 0.18, gain: 0.06 }); tone(784, { type: "triangle", decay: 0.3, gain: 0.06, at: 0.12 }); }),
  coin: safe(() => { tone(880, { decay: 0.09, gain: 0.06 }); tone(1320, { decay: 0.14, gain: 0.05, at: 0.05 }); }),
  gate: safe((combo = 1) => { rush(0.4, 0.1); tone(440 * Math.pow(1.2, Math.min(5, combo - 1)), { type: "triangle", decay: 0.35, gain: 0.07, at: 0.05 }); }),
  hit: safe(() => { tone(90, { type: "sine", decay: 0.35, gain: 0.18, slide: 40 }); rush(0.25, 0.1, 2000, 200); }),
  gold: safe(() => { for (let i = 0; i < 4; i++) tone(660 * Math.pow(1.26, i), { type: "triangle", decay: 0.3, gain: 0.06, at: i * 0.07 }); rush(0.5, 0.06, 1500, 6000); }),
  boost: safe(() => { rush(0.6, 0.14, 200, 4000); tone(330, { type: "sawtooth", decay: 0.5, gain: 0.03, slide: 990 }); }),
  over: safe(() => { tone(220, { type: "triangle", decay: 0.5, gain: 0.08 }); tone(165, { type: "triangle", decay: 0.7, gain: 0.08, at: 0.3 }); }),
};
