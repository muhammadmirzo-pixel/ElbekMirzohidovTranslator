// Videoning audio grafidan tarmoqlanib chiqqan signalni Deepgram kutadigan
// formatga (16 kHz, mono, 16-bit signed PCM) aylantiradi va asosiy oqimga
// uzatadi. AudioContext odatda 44.1/48 kHz da ishlagani uchun bu yerda
// chiziqli interpolyatsiya bilan qayta diskretlash bajariladi.

const TARGET_RATE = 16000;
// ~100 ms lik bo'laklar: Deepgram uchun yetarlicha mayda, xabar almashinuvi
// uchun esa yetarlicha yirik.
const CHUNK_SAMPLES = 1600;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / TARGET_RATE;
    this._pos = 0;            // manbadagi kasrli o'qish pozitsiyasi
    this._tail = new Float32Array(0); // oldingi blokdan qolgan namunalar
    this._out = new Int16Array(CHUNK_SAMPLES);
    this._outLen = 0;
    this._running = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._running = false;
    };
  }

  process(inputs) {
    if (!this._running) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Ko'p kanalli bo'lsa monoga yig'amiz.
    const frames = input[0].length;
    const mono = new Float32Array(frames);
    for (let ch = 0; ch < input.length; ch++) {
      const data = input[ch];
      for (let i = 0; i < frames; i++) mono[i] += data[i];
    }
    if (input.length > 1) {
      for (let i = 0; i < frames; i++) mono[i] /= input.length;
    }

    // Oldingi blok dumini oldiga ulaymiz, shunda interpolyatsiya blok
    // chegarasida uzilib qolmaydi.
    const buf = new Float32Array(this._tail.length + mono.length);
    buf.set(this._tail, 0);
    buf.set(mono, this._tail.length);

    let p = this._pos;
    while (p + 1 < buf.length) {
      const i0 = Math.floor(p);
      const frac = p - i0;
      const s = buf[i0] * (1 - frac) + buf[i0 + 1] * frac;
      const clamped = Math.max(-1, Math.min(1, s));
      this._out[this._outLen++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this._outLen === CHUNK_SAMPLES) {
        const copy = this._out.slice();
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this._outLen = 0;
      }
      p += this._ratio;
    }

    // Keyingi chaqiruvda kerak bo'ladigan qismni saqlab qolamiz.
    const consumed = Math.floor(p);
    this._tail = buf.slice(consumed);
    this._pos = p - consumed;
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
