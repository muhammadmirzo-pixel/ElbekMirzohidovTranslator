// Popup — foydalanuvchi to'g'ridan-to'g'ri ishlatadigan to'rtta boshqaruv.
// Barcha o'zgarishlar chrome.storage'ga yoziladi; content script va background
// storage hodisasi orqali darhol xabardor bo'ladi.

const el = {
  toggle: document.getElementById('toggle'),
  toggleLabel: document.querySelector('.toggle-label'),
  dubVolume: document.getElementById('dubVolume'),
  dubVolumeOut: document.getElementById('dubVolumeOut'),
  originalVolume: document.getElementById('originalVolume'),
  originalVolumeOut: document.getElementById('originalVolumeOut'),
  showSubtitles: document.getElementById('showSubtitles'),
  statTts: document.getElementById('statTts'),
  statKey: document.getElementById('statKey'),
  statPage: document.getElementById('statPage'),
  fixWrap: document.getElementById('fixWrap'),
  fixText: document.getElementById('fixText'),
  reloadTab: document.getElementById('reloadTab'),
  openOptions: document.getElementById('openOptions'),
};

let activeTabId = null;
let pageTimer = null;

let settings = null;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function render() {
  document.body.classList.toggle('on', settings.enabled);
  el.toggle.setAttribute('aria-pressed', String(settings.enabled));
  el.toggleLabel.textContent = settings.enabled ? 'Tarjimani to‘xtatish' : 'Tarjimani boshlash';

  el.dubVolume.value = Math.round(settings.dubVolume * 100);
  el.dubVolumeOut.textContent = `${el.dubVolume.value}%`;
  el.originalVolume.value = Math.round(settings.originalVolume * 100);
  el.originalVolumeOut.textContent = `${el.originalVolume.value}%`;
  el.showSubtitles.checked = settings.showSubtitles;
}

function setStat(node, state, text) {
  node.classList.remove('ok', 'bad', 'warn');
  if (state) node.classList.add(state);
  node.querySelector('.txt').textContent = text;
}

async function refreshStatus() {
  setStat(el.statKey, settings.deepgramKey ? 'ok' : 'bad',
    settings.deepgramKey ? 'Deepgram kaliti kiritilgan' : 'Deepgram kaliti yo‘q — Sozlamalarni oching');

  setStat(el.statTts, null, 'Ovoz serveri tekshirilmoqda…');
  const res = await send('check-tts', { url: settings.ttsServerUrl });
  if (res?.ok) {
    setStat(el.statTts, 'ok', 'Ovoz serveri tayyor');
  } else if (res?.detail && !res.detail.ready) {
    setStat(el.statTts, 'warn', `Ovoz serveri: ${res.detail.status}`);
  } else {
    setStat(el.statTts, 'bad', 'Ovoz serveri ishlamayapti — run.cmd ni oching');
  }
}

async function patch(p) {
  settings = await send('set-settings', { patch: p });
  render();
}

el.toggle.addEventListener('click', () => patch({ enabled: !settings.enabled }));

// Slayderlar sudralayotganda darhol saqlanadi — foydalanuvchi natijani
// bir zumda eshitishi kerak.
el.dubVolume.addEventListener('input', () => {
  el.dubVolumeOut.textContent = `${el.dubVolume.value}%`;
  patch({ dubVolume: Number(el.dubVolume.value) / 100 });
});

el.originalVolume.addEventListener('input', () => {
  el.originalVolumeOut.textContent = `${el.originalVolume.value}%`;
  patch({ originalVolume: Number(el.originalVolume.value) / 100 });
});

el.showSubtitles.addEventListener('change', () => patch({ showSubtitles: el.showSubtitles.checked }));

el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

el.reloadTab.addEventListener('click', async () => {
  if (activeTabId !== null) await chrome.tabs.reload(activeTabId);
  window.close();
});

// Joriy sahifadagi quvurning haqiqiy holati. Bu qism bo'lmasa "ovoz yo'q"
// muammosining sababini topib bo'lmaydi — hammasi jimgina yiqilaveradi.
async function refreshPageStatus() {
  if (activeTabId === null) return;
  const { rows } = await send('get-diag', { tabId: activeTabId }) || {};
  const best = rows && rows[0];

  const showFix = (text) => {
    el.fixText.textContent = text;
    el.fixWrap.hidden = false;
  };
  el.fixWrap.hidden = true;

  if (!best) {
    setStat(el.statPage, 'bad', 'Sahifada kengaytma ishlamayapti');
    // Eng keng tarqalgan sabab: kengaytma sahifa ochilgandan keyin
    // o'rnatilgan yoki qayta yuklangan.
    showFix('Kengaytma bu sahifaga hali kirmagan. Sahifani yangilang.');
    return;
  }

  const d = best.diag;
  if (d.lastError) {
    setStat(el.statPage, 'bad', d.lastError);
    return;
  }
  if (!d.videoFound) {
    setStat(el.statPage, 'warn', 'Ijro etilayotgan video topilmadi');
    return;
  }
  if (!d.wired) {
    setStat(el.statPage, 'warn', `Audio grafga ulanmagan (kontekst: ${d.ctxState})`);
    return;
  }
  if (d.pcmSent === 0) {
    setStat(el.statPage, 'warn', 'Video audiosi o‘qilmayapti');
    return;
  }
  if (!best.sttOpen) {
    setStat(el.statPage, 'warn', 'Deepgram ulanmagan');
    return;
  }
  if (d.audioClips === 0) {
    setStat(el.statPage, 'warn', `Tinglanmoqda… (${d.subtitles} tarjima, ovoz hali yo‘q)`);
    return;
  }
  setStat(el.statPage, 'ok', `Ishlayapti — ${d.audioClips} ovoz, ${d.subtitles} subtitr`);
}

(async () => {
  settings = await send('get-settings');
  render();
  refreshStatus();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  refreshPageStatus();
  // Popup ochiq turganda holat jonli yangilanib tursin.
  pageTimer = setInterval(refreshPageStatus, 1500);
  addEventListener('unload', () => clearInterval(pageTimer));
})();
