// Sozlamalar sahifasi. Har bir o'zgarish darhol saqlanadi — alohida
// "Saqlash" tugmasi yo'q.

const $ = (id) => document.getElementById(id);

const TEXT_FIELDS = ['deepgramKey', 'deepgramModel', 'ttsServerUrl', 'translateProvider',
  'googleTranslateKey', 'subtitleMode'];
const RANGE_FIELDS = {
  duckFactor: { scale: 100, fmt: (v) => `${Math.round(v * 100)}%` },
  maxLagSeconds: { scale: 1, fmt: (v) => `${Number(v).toFixed(1)}s` },
};

let settings = null;
let savedTimer = null;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function render() {
  for (const id of TEXT_FIELDS) $(id).value = settings[id] ?? '';
  for (const [id, { scale, fmt }] of Object.entries(RANGE_FIELDS)) {
    $(id).value = settings[id] * scale;
    $(`${id}Out`).textContent = fmt(settings[id]);
  }
  $('cloudKeyWrap').hidden = settings.translateProvider !== 'google-cloud';
}

function flashSaved() {
  $('saved').textContent = 'Saqlandi';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1600);
}

async function patch(p) {
  settings = await send('set-settings', { patch: p });
  flashSaved();
}

for (const id of TEXT_FIELDS) {
  $(id).addEventListener('change', () => {
    patch({ [id]: $(id).value.trim() });
    if (id === 'translateProvider') {
      $('cloudKeyWrap').hidden = $(id).value !== 'google-cloud';
    }
  });
}

for (const [id, { scale, fmt }] of Object.entries(RANGE_FIELDS)) {
  $(id).addEventListener('input', () => {
    const value = Number($(id).value) / scale;
    $(`${id}Out`).textContent = fmt(value);
    patch({ [id]: value });
  });
}

$('showKey').addEventListener('change', (e) => {
  $('deepgramKey').type = e.target.checked ? 'text' : 'password';
});

$('testTts').addEventListener('click', async () => {
  const out = $('ttsResult');
  const url = $('ttsServerUrl').value.trim();
  out.className = 'result';
  out.textContent = 'Tekshirilmoqda…';

  const res = await send('check-tts', { url });
  if (res?.ok) {
    out.className = 'result ok';
    const d = res.detail || {};
    out.textContent = `Server tayyor — ovoz: ${d.voice ?? '?'}, ${d.sample_rate ?? '?'} Hz`;
  } else if (res?.detail) {
    out.className = 'result bad';
    out.textContent = `Server javob berdi, lekin tayyor emas: ${res.detail.status}` +
      (res.detail.error ? ` (${res.detail.error})` : '');
  } else {
    out.className = 'result bad';
    out.textContent = `${res?.message || 'Ulanib bo‘lmadi'} — server/run.cmd ishlab turganini tekshiring.`;
  }
});

$('reset').addEventListener('click', async () => {
  settings = await send('reset-settings');
  render();
  flashSaved();
});

(async () => {
  settings = await send('get-settings');
  render();
})();
