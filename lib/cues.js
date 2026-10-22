// Spoken cues and a large indicator, so a person can follow a protocol
// with their eyes closed, or from across the room.

let audio = null;

/** Say it aloud, if this browser can. Returns whether it could. */
export function speak(text) {
  if (!("speechSynthesis" in window)) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** A short tone. The audio context is made on the first call, which must follow a click. */
export function beep(freq = 660, ms = 160, gain = 0.08) {
  try {
    if (audio === null) audio = new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch {
    // No audio is not an error worth stopping for.
  }
}

/** A continuous tone whose loudness follows a value, for feedback with eyes closed. */
export class Hum {
  constructor() {
    this.o = null;
    this.g = null;
  }

  set(level) {
    try {
      if (audio === null) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (this.o === null) {
        this.o = audio.createOscillator();
        this.g = audio.createGain();
        this.o.type = "sine";
        this.o.frequency.value = 220;
        this.g.gain.value = 0;
        this.o.connect(this.g);
        this.g.connect(audio.destination);
        this.o.start();
      }
      this.g.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.12, audio.currentTime, 0.2);
    } catch {
      // No audio is not an error worth stopping for.
    }
  }

  stop() {
    if (this.g !== null) this.g.gain.setTargetAtTime(0, audio.currentTime, 0.1);
  }
}

/** The big panel: one word for the state, one line under it. */
export class Indicator {
  constructor(el) {
    this.el = el;
  }

  show(kind, title, sub = "") {
    this.el.className = `big ${kind}`;
    this.el.innerHTML = `${title}<small>${sub}</small>`;
  }
}
