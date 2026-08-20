// Deepgram real-time nutqni matnga aylantirish (streaming STT) mijozi.
// Service worker ichida yashaydi: WebSocket faolligi service worker'ni
// uyquga ketishidan saqlaydi (Chrome 116+).

const DG_URL = 'wss://api.deepgram.com/v1/listen';

export class DeepgramStream {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.model
   * @param {(t: {text: string, isFinal: boolean}) => void} opts.onTranscript
   * @param {(e: {code?: number, message: string, fatal: boolean}) => void} opts.onError
   * @param {() => void} [opts.onOpen]
   */
  constructor({ apiKey, model, onTranscript, onError, onOpen }) {
    this.apiKey = apiKey;
    this.model = model || 'nova-3';
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onOpen = onOpen;
    this.ws = null;
    this.closedByUs = false;
    // WebSocket ochilgunicha kelgan audio shu yerda kutib turadi.
    this.pending = [];
    this.keepAlive = null;
  }

  connect() {
    const params = new URLSearchParams({
      model: this.model,
      language: 'en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      punctuate: 'true',
      smart_format: 'true',
      interim_results: 'true',
      // Gap tugashini tezroq aniqlash — dublyaj kechikishini kamaytiradi.
      endpointing: '300',
      utterance_end_ms: '1000',
    });

    // Brauzer WebSocket'ida sarlavha qo'yib bo'lmaydi, shuning uchun
    // Deepgram qo'llab-quvvatlaydigan subprotocol orqali autentifikatsiya.
    this.ws = new WebSocket(`${DG_URL}?${params}`, ['token', this.apiKey]);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      for (const buf of this.pending) this.ws.send(buf);
      this.pending = [];
      // Jim daqiqalarda Deepgram ulanishni uzib yubormasligi uchun.
      this.keepAlive = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
      this.onOpen?.();
    };

    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript || '').trim();
        if (!text) return;
        // Ikkisi har xil narsa va ikkalasi ham kerak:
        //   is_final     — shu bo'lak endi o'zgarmaydi (lekin gap davom etishi mumkin)
        //   speech_final — Deepgram jimlikni sezdi, gap tugadi
        this.onTranscript({
          text,
          isFinal: Boolean(msg.is_final),
          speechFinal: Boolean(msg.speech_final),
        });
      } else if (msg.type === 'UtteranceEnd') {
        // Jimlik bo'yicha gap tugashi — is_final kelmay qolgan holatlar uchun zaxira.
        this.onTranscript({ text: '', isFinal: true, speechFinal: true });
      } else if (msg.type === 'Error') {
        this.onError({ message: msg.description || msg.message || 'Deepgram xatosi', fatal: true });
      }
    };

    this.ws.onerror = () => {
      // onerror hodisasida tafsilot bo'lmaydi; sababi odatda onclose'da keladi.
      this.onError({ message: 'Deepgram ulanishida xatolik', fatal: false });
    };

    this.ws.onclose = (ev) => {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
      if (this.closedByUs) return;
      // 1008 / 4001 va shunga o'xshash kodlar — noto'g'ri yoki muddati
      // o'tgan API kalit. Buni foydalanuvchiga aniq aytish kerak.
      const badAuth = ev.code === 4001 || ev.code === 1008 || ev.code === 4008;
      this.onError({
        code: ev.code,
        message: badAuth
          ? 'Deepgram API kaliti qabul qilinmadi. Sozlamalardan tekshiring.'
          : `Deepgram ulanishi uzildi (kod ${ev.code}).`,
        fatal: badAuth,
      });
    };
  }

  /** @param {ArrayBuffer} buf 16 kHz mono int16 PCM */
  send(buf) {
    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      // Ulanish ochilmagunicha ozgina bufer saqlaymiz (taxminan 3 soniya).
      if (this.pending.length < 30) this.pending.push(buf);
    }
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.keepAlive);
    this.keepAlive = null;
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Deepgram'ga oxirgi natijalarni yuborib, ulanishni chiroyli yopishni aytamiz.
      try { this.ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ahamiyatsiz */ }
    }
    try { this.ws?.close(); } catch { /* ahamiyatsiz */ }
    this.ws = null;
  }
}
