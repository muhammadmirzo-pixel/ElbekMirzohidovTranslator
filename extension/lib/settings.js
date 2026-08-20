// Sozlamalarning yagona manbasi. Popup, options, background va content
// script hammasi shu yerdagi kalitlardan foydalanadi.

export const DEFAULTS = {
  // --- Popup boshqaruvlari ---
  enabled: false,        // "Tarjimani boshlash / To'xtatish"
  dubVolume: 1.0,        // "Ovoz balandligi"  (extension ovozi, 0..1)
  originalVolume: 0.15,  // "Asl balandlik"    (videoning o'z ovozi, 0..1)
  showSubtitles: true,   // "Subtitrni ko'rsatish"

  // --- Options sahifasi ---
  deepgramKey: '',
  deepgramModel: 'nova-3',
  ttsServerUrl: 'http://127.0.0.1:8788',
  translateProvider: 'google-free', // 'google-free' | 'google-cloud'
  googleTranslateKey: '',

  // Dublyaj gapirayotganda asl ovozni qo'shimcha pasaytirish (0..1 ko'paytuvchi).
  duckFactor: 0.35,
  // Dublyaj videodan shuncha soniyadan ko'p orqada qolsa, video biroz sekinlashadi.
  maxLagSeconds: 3.0,
  subtitleMode: 'both', // 'uz' | 'both'
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
  return patch;
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    let any = false;
    for (const [k, { newValue }] of Object.entries(changes)) {
      if (k in DEFAULTS) { patch[k] = newValue; any = true; }
    }
    if (any) cb(patch);
  });
}
