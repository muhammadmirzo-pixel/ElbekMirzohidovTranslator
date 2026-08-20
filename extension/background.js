// Service worker — butun quvurni boshqaradi:
//   content script'dan PCM -> Deepgram (STT) -> tarjima -> lokal TTS server
//   -> tayyor audio yana content script'ga qaytadi.
//
// Har bir tab uchun alohida seans (session) saqlanadi.

import { getSettings, setSettings, DEFAULTS } from './lib/settings.js';
import { DeepgramStream } from './lib/stt.js';
import { translateToUzbek } from './lib/translate.js';
import { synthesizeUzbek, checkTtsServer } from './lib/tts.js';

/** @type {Map<string, Session>} */
const sessions = new Map();

/** Content script'lardan kelgan oxirgi holat, "tabId:frameId" bo'yicha. */
const diagnostics = new Map();

// Dublyaj videodan juda orqada qolib ketmasligi uchun navbat cheklanadi.
const MAX_QUEUE = 4;
// Bitta bo'lakka ruxsat etilgan eng uzun matn — undan uzunlari majburan yuboriladi.
const FLUSH_CHARS = 140;

class Session {
  constructor(tabId, port, settings) {
    this.tabId = tabId;
    this.port = port;
    this.settings = settings;
    this.dg = null;
    this.pendingText = '';   // speech_final kutayotgan yakuniy bo'laklar
    this.queue = [];         // {seq, en}
    this.working = false;
    this.seq = 0;
    this.stopped = false;
  }

  startStt() {
    if (this.dg) return;
    if (!this.settings.deepgramKey) {
      this.report('Deepgram API kaliti kiritilmagan. Extension sozlamalarini oching.', true);
      return;
    }
    this.dg = new DeepgramStream({
      apiKey: this.settings.deepgramKey,
      model: this.settings.deepgramModel,
      onOpen: () => this.send({ type: 'status', state: 'listening' }),
      onTranscript: (t) => this.onTranscript(t),
      onError: (e) => {
        this.report(e.message, e.fatal);
        if (e.fatal) this.stop();
      },
    });
    this.dg.connect();
  }

  onTranscript({ text, isFinal, speechFinal }) {
    if (this.stopped) return;
    if (!isFinal) {
      // Oraliq natija — faqat subtitrni jonli ko'rsatish uchun.
      this.send({ type: 'interim', en: text });
      return;
    }
    if (text) this.pendingText = `${this.pendingText} ${text}`.trim();
    if (!this.pendingText) return;

    // Bo'lakni imkon qadar erta uzatish kerak: sintez audio uzunligining
    // taxminan 0.75 qismini oladi, ya'ni qisqa bo'lak tezroq gapira boshlaydi.
    // Shuning uchun gap tugashini kutibgina qolmay, tinish belgisi yoki
    // uzunlik chegarasida ham uzatamiz.
    if (speechFinal || /[.!?]$/.test(this.pendingText) || this.pendingText.length >= FLUSH_CHARS) {
      this.flush();
    }
  }

  flush() {
    const en = this.pendingText.trim();
    this.pendingText = '';
    if (!en) return;

    this.queue.push({ seq: this.seq++, en });
    // Navbat to'lib ketsa, eng eski bo'laklarni tashlab yuboramiz: kechikkan
    // dublyajni eshitgandan ko'ra, joriy gapni eshitgan yaxshiroq.
    if (this.queue.length > MAX_QUEUE) {
      const dropped = this.queue.splice(0, this.queue.length - MAX_QUEUE);
      this.send({ type: 'dropped', count: dropped.length });
    }
    this.pump();
  }

  async pump() {
    if (this.working || this.stopped) return;
    const job = this.queue.shift();
    if (!job) return;
    this.working = true;

    try {
      const uz = await translateToUzbek(job.en, this.settings);
      if (this.stopped) return;
      // Subtitrni audio tayyor bo'lishini kutmasdan darhol ko'rsatamiz.
      this.send({ type: 'subtitle', seq: job.seq, en: job.en, uz });

      const wavBase64 = await synthesizeUzbek(uz, this.settings.ttsServerUrl);
      if (this.stopped) return;
      this.send({ type: 'audio', seq: job.seq, wavBase64 });
    } catch (e) {
      this.report(`Tarjima quvurida xato: ${e.message}`, false);
    } finally {
      this.working = false;
      if (!this.stopped && this.queue.length) this.pump();
    }
  }

  send(msg) {
    try { this.port.postMessage(msg); } catch { /* port yopilgan */ }
  }

  report(message, fatal) {
    console.warn('[Tarjimon]', message);
    this.send({ type: 'error', message, fatal });
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.pendingText = '';
    this.dg?.close();
    this.dg = null;
  }
}

// --- Content script bilan ulanish ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dub') return;
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;
  // Bitta tabda bir nechta freym (masalan o'rnatilgan pleyerlar) bo'lishi
  // mumkin, shuning uchun seans kaliti freymni ham hisobga oladi.
  const key = `${tabId}:${port.sender.frameId ?? 0}`;

  let session = null;

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      case 'hello': {
        const settings = await getSettings();
        port.postMessage({ type: 'settings', settings });
        break;
      }
      case 'audio-start': {
        const settings = await getSettings();
        if (!settings.enabled) return;
        sessions.get(key)?.stop();
        session = new Session(tabId, port, settings);
        sessions.set(key, session);
        session.startStt();
        break;
      }
      case 'audio-stop': {
        session?.flush();
        session?.stop();
        sessions.delete(key);
        session = null;
        break;
      }
      case 'flush': {
        // Video pauza qilindi — yig'ilib qolgan matnni yo'qotmasdan yuboramiz.
        session?.flush();
        break;
      }
      case 'reset': {
        // Sakrash yoki video tugadi — kutayotgan tarjimalar endi ma'nosiz.
        if (session) {
          session.queue = [];
          session.pendingText = '';
        }
        break;
      }
      case 'diag': {
        // Content script har 2 soniyada o'z holatini yuboradi — popup shu
        // orqali "video topildimi, audio oqyaptimi" degan savolga javob beradi.
        diagnostics.set(key, {
          tabId,
          frameId: port.sender.frameId ?? 0,
          diag: msg.diag,
          sttOpen: Boolean(session?.dg),
          at: Date.now(),
        });
        break;
      }
      case 'pcm': {
        if (!session || session.stopped) return;
        session.dg?.send(base64ToArrayBuffer(msg.b64));
        break;
      }
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    sessions.get(key)?.stop();
    sessions.delete(key);
    diagnostics.delete(key);
    session = null;
  });
});

// --- Popup / options bilan ulanish ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'get-settings':
        sendResponse(await getSettings());
        break;
      case 'set-settings': {
        await setSettings(msg.patch);
        const settings = await getSettings();
        await applyGlobalState(settings, { injectTabs: 'enabled' in msg.patch });
        sendResponse(settings);
        break;
      }
      case 'check-tts':
        sendResponse(await checkTtsServer(msg.url));
        break;
      case 'get-diag': {
        // Faqat so'ralgan tabniki va faqat yaqinda yangilangani.
        const now = Date.now();
        const rows = [...diagnostics.values()]
          .filter((d) => d.tabId === msg.tabId && now - d.at < 8000)
          .sort((a, b) => b.diag.pcmSent - a.diag.pcmSent);
        sendResponse({ rows });
        break;
      }
      case 'reset-settings':
        await chrome.storage.local.set(DEFAULTS);
        sendResponse(DEFAULTS);
        break;
      default:
        sendResponse({ error: 'noma\u2018lum xabar' });
    }
  })();
  return true; // javob asinxron
});

async function applyGlobalState(settings, { injectTabs = false } = {}) {
  await chrome.action.setBadgeText({ text: settings.enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1f9d55' });

  if (!settings.enabled) {
    for (const s of sessions.values()) s.stop();
    sessions.clear();
  } else {
    // Ochiq seanslar yangi sozlamalar bilan ishlashi uchun.
    for (const s of sessions.values()) s.settings = settings;
    // Faqat tarjima yoqilgan paytdagina — har bir slayder harakatida emas.
    if (injectTabs) await injectIntoOpenTabs();
  }
}

// Chrome content script'ni faqat kengaytma o'rnatilgandan KEYIN ochilgan
// sahifalarga kiritadi. Ya'ni allaqachon ochiq turgan videoli tab "o'lik"
// bo'lib qoladi va foydalanuvchi sababini bilmaydi. Shuning uchun o'rnatishda
// va tarjima yoqilganda ochiq tablarga o'zimiz kiritamiz.
// content.js dagi __elbekDubLoaded qorovuli takroriy kiritishni zararsiz qiladi.
async function injectIntoOpenTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url || !/^https?:/i.test(tab.url)) return;
    const target = { tabId: tab.id, allFrames: true };
    try {
      await chrome.scripting.insertCSS({ target, files: ['content/subtitles.css'] });
      await chrome.scripting.executeScript({ target, files: ['content/content.js'] });
    } catch {
      // Kengaytmalar do'koni, chrome:// va boshqa yopiq sahifalar — normal holat.
    }
  }));
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const settings = await getSettings();
  if ('enabled' in changes) await applyGlobalState(settings, { injectTabs: true });
  else for (const s of sessions.values()) s.settings = settings;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // Kalit "tabId:frameId" ko'rinishida — shu tabning barcha freymlarini yopamiz.
  for (const [key, session] of sessions) {
    if (key.startsWith(`${tabId}:`)) {
      session.stop();
      sessions.delete(key);
    }
  }
  for (const key of diagnostics.keys()) {
    if (key.startsWith(`${tabId}:`)) diagnostics.delete(key);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await applyGlobalState(settings, { injectTabs: true });
});

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
