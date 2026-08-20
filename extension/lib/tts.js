// Lokal ovoz serveri bilan aloqa. Server o'zbekcha matnni Elbek Mirzohidov
// ovozida sintez qilib, WAV qaytaradi.

/**
 * @param {string} text o'zbekcha (lotin) matn
 * @param {string} serverUrl masalan http://127.0.0.1:8788
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} base64 ko'rinishidagi WAV
 */
export async function synthesizeUzbek(text, serverUrl, signal) {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ovoz serveri xatosi: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

export async function checkTtsServer(serverUrl) {
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: Boolean(data.ready), message: data.status || 'tayyor', detail: data };
  } catch (e) {
    return { ok: false, message: `Serverga ulanib bo\u2018lmadi: ${e.message}` };
  }
}

// chrome.runtime xabarlari ikkilik ma'lumot tashiy olmaydi, shuning uchun
// audio base64 sifatida uzatiladi.
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000; // katta fayllarda stek to'lib ketmasligi uchun
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
