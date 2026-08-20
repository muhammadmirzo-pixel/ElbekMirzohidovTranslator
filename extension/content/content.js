// Sahifadagi video bilan ishlaydigan qism.
//
// Audio graf ataylab shunday qurilgan:
//
//   video -> MediaElementSource -+-> gainOriginal -> karnay   ("Asl balandlik")
//                                |
//                                +-> pcm-worklet -> STT       (har doim to'liq daraja)
//
//   dublyaj WAV -> AudioBufferSource -> gainDub -> karnay     ("Ovoz balandligi")
//
// STT tarmogi gainOriginal'dan OLDIN ulangani muhim: foydalanuvchi asl
// ovozni nolga tushirganda ham tanish uchun signal to'liq qoladi.

(() => {
  'use strict';
  if (window.__elbekDubLoaded) return;
  window.__elbekDubLoaded = true;

  const SLOW_RATE = 0.9;
  const SILENCE_CHECK_MS = 6000;

  let settings = null;
  let port = null;
  let ctx = null;
  let gainOriginal = null;
  let gainDub = null;
  let workletNode = null;
  let sourceNode = null;

  /** @type {HTMLVideoElement|null} */
  let video = null;
  const wired = new WeakSet();       // gainOriginal'ga bir marta ulanadi
  const sourceCache = new WeakMap(); // video -> MediaElementAudioSourceNode

  let nextStartTime = 0;   // navbatdagi dublyaj qachon boshlanadi (ctx vaqti)
  let speakingUntil = 0;   // shu vaqtgacha dublyaj gapiryapti (ducking uchun)
  let originalRate = null; // foydalanuvchi tanlagan ijro tezligi
  let rateForced = false;
  let pcmSent = 0;

  // Quvur juda ko'p joyda jimgina uzilishi mumkin (video topilmadi, audio
  // grafga ulanib bo'lmadi, Deepgram javob bermadi...). Shu holat popup'da
  // ko'rsatiladi, aks holda foydalanuvchi "nega ovoz yo'q" degan savolga
  // javob topa olmaydi.
  const diag = {
    frame: location.href.slice(0, 120),
    videoFound: false,
    connected: false,
    wired: false,
    ctxState: '—',
    pcmSent: 0,
    subtitles: 0,
    audioClips: 0,
    lastError: null,
  };

  // ---------- Subtitr overlay ----------

  let bar = null;
  let lineUz = null;
  let lineEn = null;
  let hideTimer = null;
  let toast = null;

  function ensureBar() {
    if (bar) return bar;
    // Ba'zi freymlarda skript body yaratilishidan oldin ishga tushadi.
    if (!document.body) return null;
    bar = document.createElement('div');
    bar.className = 'elbek-dub-bar';
    lineEn = document.createElement('div');
    lineEn.className = 'elbek-dub-en';
    lineUz = document.createElement('div');
    lineUz.className = 'elbek-dub-uz';
    bar.append(lineEn, lineUz);
    (document.fullscreenElement || document.body).appendChild(bar);
    return bar;
  }

  function showSubtitle(uz, en) {
    if (!settings || !settings.showSubtitles) { hideSubtitle(); return; }
    if (!ensureBar()) return;
    // To'liq ekranga o'tilganda overlay ham o'sha elementga ko'chishi kerak.
    const host = document.fullscreenElement || document.body;
    if (bar.parentElement !== host) host.appendChild(bar);

    lineUz.textContent = uz || '';
    lineEn.textContent = settings.subtitleMode === 'both' ? (en || '') : '';
    lineEn.style.display = lineEn.textContent ? '' : 'none';
    bar.classList.add('elbek-dub-visible');
    positionBar();

    clearTimeout(hideTimer);
    // O'qib ulgurish uchun matn uzunligiga bogliq ko'rinish vaqti.
    const ms = Math.min(12000, Math.max(2500, (uz || '').length * 70));
    hideTimer = setTimeout(hideSubtitle, ms);
  }

  function hideSubtitle() {
    if (bar) bar.classList.remove('elbek-dub-visible');
  }

  function positionBar() {
    if (!bar || !video) return;
    if (document.fullscreenElement) {
      bar.classList.add('elbek-dub-fixed');
      bar.style.left = '';
      bar.style.width = '';
      bar.style.top = '';
      return;
    }
    bar.classList.remove('elbek-dub-fixed');
    const r = video.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) { hideSubtitle(); return; }
    bar.style.left = r.left + 'px';
    bar.style.width = r.width + 'px';
    bar.style.top = (r.bottom - Math.min(120, r.height * 0.28)) + 'px';
  }

  function showToast(message) {
    if (!toast) {
      if (!document.body) return;
      toast = document.createElement('div');
      toast.className = 'elbek-dub-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('elbek-dub-visible');
    setTimeout(() => { if (toast) toast.classList.remove('elbek-dub-visible'); }, 6000);
  }

  function warn(message) {
    console.warn('[Tarjimon]', message);
    showToast(message);
  }

  // ---------- Audio graf ----------

  // Diqqat: `ctx` faqat worklet moduli ro'yxatdan o'tgandan KEYIN tayinlanadi.
  // Aks holda ikkinchi (parallel) chaqiruv `if (ctx)` shartidan o'tib ketib,
  // hali ro'yxatdan o'tmagan protsessor uchun AudioWorkletNode yaratmoqchi
  // bo'ladi va InvalidStateError bilan jimgina yiqiladi.
  let ctxReady = null;

  function ensureContext() {
    if (ctxReady) return ctxReady;
    ctxReady = (async () => {
      const c = new AudioContext();
      gainOriginal = c.createGain();
      gainDub = c.createGain();
      gainOriginal.connect(c.destination);
      gainDub.connect(c.destination);
      await c.audioWorklet.addModule(chrome.runtime.getURL('worklet/pcm-worklet.js'));
      ctx = c;
      applyVolumes();
      diag.ctxState = c.state;
      return c;
    })().catch((e) => {
      ctxReady = null;
      diag.lastError = `Audio kontekst: ${e.message}`;
      throw e;
    });
    return ctxReady;
  }

  function applyVolumes() {
    if (!settings || !ctx) return;
    const ducking = ctx.currentTime < speakingUntil ? settings.duckFactor : 1;
    gainOriginal.gain.setTargetAtTime(settings.originalVolume * ducking, ctx.currentTime, 0.08);
    gainDub.gain.setTargetAtTime(settings.dubVolume, ctx.currentTime, 0.02);
  }

  async function wireVideo(v) {
    if (!settings || !settings.enabled) return;
    await ensureContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

    if (video !== v) {
      teardownTap();
      video = v;
    }
    if (wired.has(v)) { startTap(); return; }

    let src = sourceCache.get(v);
    if (!src) {
      try {
        src = ctx.createMediaElementSource(v);
      } catch (e) {
        // Boshqa skript allaqachon shu elementga ulangan bo'lishi mumkin.
        diag.lastError = `Audio grafga ulanib bo'lmadi: ${e.message}`;
        warn(diag.lastError);
        return;
      }
      sourceCache.set(v, src);
    }
    // Element ovozi doim 1 da turadi — balandlikni gain node boshqaradi.
    // Aks holda "Asl balandlik" 0 bo'lganda STT ham kar bo'lib qolardi.
    holdFullVolume(v);
    src.connect(gainOriginal);
    sourceNode = src;
    wired.add(v);
    diag.wired = true;
    startTap();
    checkAudioReachesUs();
  }

  // MediaElementSource elementning volume/muted xossalaridan KEYIN signal
  // oladi. Ya'ni saytning o'z ovoz slayderi (masalan YouTube'niki) bizning
  // nutq tanish tarmog'imizni ham pasaytiradi, mute qilsa esa butunlay
  // o'chiradi. Shuning uchun element darajasini 1 da ushlab turamiz —
  // eshitiladigan balandlikni "Asl balandlik" slayderi boshqaradi.
  function holdFullVolume(v) {
    const reassert = () => {
      if (!settings || !settings.enabled || v !== video) return;
      if (v.muted) v.muted = false;
      if (v.volume !== 1) v.volume = 1;
    };
    reassert();
    if (!v.__elbekVolumeHold) {
      v.__elbekVolumeHold = true;
      v.addEventListener('volumechange', reassert);
    }
  }

  function startTap() {
    if (!sourceNode || workletNode) return;
    workletNode = new AudioWorkletNode(ctx, 'pcm-worklet', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    workletNode.port.onmessage = (e) => {
      pcmSent++;
      diag.pcmSent = pcmSent;
      post({ type: 'pcm', b64: bufToBase64(e.data) });
    };
    sourceNode.connect(workletNode);
    post({ type: 'audio-start', url: location.href });
  }

  function teardownTap() {
    if (workletNode) {
      try { workletNode.port.postMessage('stop'); } catch (e) { /* ahamiyatsiz */ }
      try { if (sourceNode) sourceNode.disconnect(workletNode); } catch (e) { /* ahamiyatsiz */ }
      try { workletNode.disconnect(); } catch (e) { /* ahamiyatsiz */ }
      workletNode = null;
    }
    post({ type: 'audio-stop' });
    restoreRate();
  }

  // CORS bilan himoyalangan media createMediaElementSource orqali jimlik
  // beradi. Buni sezib foydalanuvchini ogohlantiramiz.
  function checkAudioReachesUs() {
    const started = pcmSent;
    setTimeout(() => {
      if (!video || video.paused) return;
      if (pcmSent - started > 0) return;
      warn('Video audiosini oqib bolmadi (CORS cheklovi). Bu saytda tarjima ishlamasligi mumkin.');
    }, SILENCE_CHECK_MS);
  }

  // ---------- Dublyajni ijro etish ----------

  async function playDub(wavBase64) {
    try {
      await ensureContext();
      const audio = await ctx.decodeAudioData(base64ToBuf(wavBase64));
      const node = ctx.createBufferSource();
      node.buffer = audio;
      node.connect(gainDub);

      const startAt = Math.max(ctx.currentTime + 0.02, nextStartTime);
      node.start(startAt);
      // Gaplar bir-biriga yopishib qolmasligi uchun kichik tanaffus.
      nextStartTime = startAt + audio.duration + 0.12;
      speakingUntil = nextStartTime;
      applyVolumes();
      node.onended = () => { applyVolumes(); manageLag(); };
      manageLag();
    } catch (e) {
      console.warn('[Tarjimon] dublyajni ijro etib bolmadi:', e.message);
    }
  }

  // Dublyaj videodan orqada qolsa videoni biroz sekinlashtiramiz, shunda
  // tarjima gapirib ulguradi va rasm bilan mos qoladi.
  function manageLag() {
    if (!video || !settings || !ctx) return;
    const pending = nextStartTime - ctx.currentTime;
    if (pending > settings.maxLagSeconds) {
      if (!rateForced) {
        originalRate = video.playbackRate;
        rateForced = true;
      }
      if (video.playbackRate !== SLOW_RATE) video.playbackRate = SLOW_RATE;
    } else if (rateForced && pending < settings.maxLagSeconds / 2) {
      restoreRate();
    }
  }

  function restoreRate() {
    if (!rateForced || !video) return;
    video.playbackRate = originalRate === null ? 1 : originalRate;
    rateForced = false;
    originalRate = null;
  }

  // ---------- Background bilan aloqa ----------

  function connect() {
    port = chrome.runtime.connect({ name: 'dub' });
    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'settings':
          settings = msg.settings;
          applyVolumes();
          if (!settings.showSubtitles) hideSubtitle();
          diag.connected = true;
          if (settings.enabled) scan(); else stopEverything();
          break;
        case 'subtitle':
          diag.subtitles++;
          showSubtitle(msg.uz, msg.en);
          break;
        case 'audio':
          diag.audioClips++;
          playDub(msg.wavBase64);
          break;
        case 'interim':
          if (settings && settings.showSubtitles && settings.subtitleMode === 'both') {
            if (!ensureBar()) break;
            lineEn.textContent = msg.en;
            lineEn.style.display = '';
            bar.classList.add('elbek-dub-visible');
            positionBar();
          }
          break;
        case 'error':
          diag.lastError = msg.message;
          warn(msg.message);
          break;
        default:
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // Service worker uyquga ketgan bo'lishi mumkin. Tarjima o'chiq bo'lsa ham
      // qayta ulanamiz: aks holda keyinroq yoqilganda sahifani qayta
      // yuklamasdan turib xabar yetib kelmaydi.
      setTimeout(connect, 800);
    });
    post({ type: 'hello' });
  }

  // Sozlamalar o'zgarishini to'g'ridan-to'g'ri storage'dan kuzatamiz.
  // Port orqali uzatishga tayanib bo'lmaydi — service worker uxlab qolsa
  // slayderlar jonli ishlamay qolardi.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !settings) return;
    let touched = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) { settings[key] = newValue; touched = true; }
    }
    if (!touched) return;

    applyVolumes();
    if (!settings.showSubtitles) hideSubtitle();
    if (settings.enabled) scan(); else stopEverything();
  });

  function post(msg) {
    try { if (port) port.postMessage(msg); } catch (e) { /* port yopilgan */ }
  }

  function stopEverything() {
    teardownTap();
    hideSubtitle();
    nextStartTime = 0;
    speakingUntil = 0;
    // Tarjima o'chirilganda video o'z ovozini to'liq qaytarib olsin.
    if (gainOriginal && ctx) gainOriginal.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
  }

  // ---------- Video topish ----------

  function pickVideo() {
    const vids = [...document.querySelectorAll('video')]
      .filter((v) => !v.paused && v.readyState >= 2 && !v.muted);
    if (!vids.length) return null;
    // Ekranda eng katta ko'rinayotgani asosiy video deb hisoblanadi.
    return vids.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0];
  }

  // wireVideo asinxron. Uni "floating promise" sifatida qoldirib bo'lmaydi:
  // ichidagi har qanday xato konsolda ham ko'rinmay yo'qolib ketardi.
  function tryWire(v) {
    wireVideo(v).catch((e) => {
      diag.lastError = e.message;
      warn(`Videoga ulanib bo'lmadi: ${e.message}`);
    });
  }

  function scan() {
    if (!settings || !settings.enabled) return;
    const v = pickVideo();
    diag.videoFound = Boolean(v);
    if (v) tryWire(v);
  }

  function attachListeners(v) {
    if (v.__elbekListeners) return;
    v.__elbekListeners = true;
    v.addEventListener('play', () => { if (settings && settings.enabled) tryWire(v); });
    v.addEventListener('pause', () => { if (v === video) post({ type: 'flush' }); });
    v.addEventListener('ended', () => {
      if (v !== video) return;
      post({ type: 'reset' });
      restoreRate();
    });
    v.addEventListener('seeking', () => {
      if (v !== video) return;
      // Sakrashdan keyin eski tarjimalar ma'nosiz — navbatni tozalaymiz.
      post({ type: 'reset' });
      nextStartTime = 0;
      hideSubtitle();
    });
  }

  // Kengaytma barcha freymlarda ishlaydi, shu jumladan reklama iframe'larida
  // ham. Ularning har biri uchun port ochish keraksiz yuk, shuning uchun
  // background bilan aloqa faqat sahifada video paydo bo'lgandagina boshlanadi.
  function noticeVideos() {
    const vids = document.querySelectorAll('video');
    if (!vids.length) return;
    vids.forEach(attachListeners);
    if (!port) connect();
  }

  const observer = new MutationObserver(noticeVideos);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  noticeVideos();

  addEventListener('scroll', positionBar, { passive: true });
  addEventListener('resize', positionBar, { passive: true });
  document.addEventListener('fullscreenchange', () => setTimeout(positionBar, 60));

  // YouTube kabi SPA saytlarda video elementi almashib turadi.
  setInterval(() => {
    noticeVideos();
    if (settings && settings.enabled) scan();
    if (ctx) diag.ctxState = ctx.state;
    post({ type: 'diag', diag });
  }, 2000);

  // ---------- Yordamchilar ----------

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function base64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
})();
