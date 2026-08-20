// Ingliz -> o'zbek matn tarjimasi.
// Ikki provayder: kalitsiz ishlaydigan ochiq Google endpoint (standart) va
// rasmiy Google Cloud Translation API (kalit bilan, barqarorroq).

const CLOUD_URL = 'https://translation.googleapis.com/language/translate/v2';
const FREE_URL = 'https://translate.googleapis.com/translate_a/single';

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function translateFree(text) {
  const params = new URLSearchParams({
    client: 'gtx', sl: 'en', tl: 'uz', dt: 't', q: text,
  });
  const res = await fetch(`${FREE_URL}?${params}`);
  if (!res.ok) throw new Error(`Tarjima xatosi: HTTP ${res.status}`);
  const data = await res.json();
  // Javob shakli: [[["tarjima","asl",...], ...], ...]
  const parts = Array.isArray(data?.[0]) ? data[0] : [];
  const out = parts.map((p) => p?.[0] || '').join('');
  if (!out) throw new Error('Tarjima bo\u2018sh qaytdi');
  return decodeEntities(out);
}

async function translateCloud(text, key) {
  const res = await fetch(`${CLOUD_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'en', target: 'uz', format: 'text' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Translate xatosi: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const out = data?.data?.translations?.[0]?.translatedText;
  if (!out) throw new Error('Tarjima bo\u2018sh qaytdi');
  return decodeEntities(out);
}

/**
 * @param {string} text inglizcha matn
 * @param {{translateProvider: string, googleTranslateKey: string}} settings
 * @returns {Promise<string>} o'zbekcha (lotin) matn
 */
export async function translateToUzbek(text, settings) {
  const clean = text.trim();
  if (!clean) return '';
  if (settings.translateProvider === 'google-cloud' && settings.googleTranslateKey) {
    return translateCloud(clean, settings.googleTranslateKey);
  }
  return translateFree(clean);
}
