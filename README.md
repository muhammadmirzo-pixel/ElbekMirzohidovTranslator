# Elbek Mirzohidov — Video Tarjimon

Brauzerdagi videolarni **ingliz tilidan o'zbek tiliga jonli tarjima qiladigan** Chrome
kengaytmasi. Tarjima Elbek Mirzohidov ovoziga o'xshatilgan tembrda eshitiladi.

Video ijro etila boshlagan zahoti kengaytma o'zi ishga tushadi — har safar tugma
bosish shart emas.

---

## Qanday ishlaydi

```
  <video> elementi
        │
        ├─► Web Audio grafi ──► "Asl balandlik" ──► karnay
        │                       (video o'z ovozi)
        │
        └─► 16 kHz PCM ──► Deepgram (streaming STT) ──► inglizcha matn
                                                              │
                                          Google Translate ◄──┘
                                                  │
                                          o'zbekcha (lotin)
                                                  │
                              ┌───────────────────┴────────────────────┐
                              │        Lokal ovoz serveri              │
                              │  lotin → kirill transliteratsiya       │
                              │  MMS-TTS (o'zbek VITS)                 │
                              │  OpenVoice V2 → Elbek tembri           │
                              └───────────────────┬────────────────────┘
                                                  │
                            WAV ──► "Ovoz balandligi" ──► karnay
```

### Nega aynan shu modellar

| Bosqich | Tanlangan yechim | Sabab |
|---|---|---|
| Nutqni tanish | Deepgram `nova-3` streaming | ~300 ms kechikish; jonli dublyaj uchun yagona amaliy variant |
| Tarjima | Google Translate | O'zbek tilini yaxshi biladi, kalitsiz ishlaydi |
| O'zbekcha nutq | `facebook/mms-tts-uzb-script_cyrillic` | Mavjud yagona sifatli ochiq o'zbek TTS. CPU'da RTF ≈ 0.34 |
| Ovoz klonlash | OpenVoice V2 tone color converter | MIT litsenziya, bepul, **tildan mustaqil** — o'zbek tili uning o'quv to'plamida bo'lmasa ham ishlaydi |

**ElevenLabs nega ishlatilmadi:** pullik. **XTTS-v2 nega ishlatilmadi:** GPU'siz
mashinada real vaqtdan sekin (RTF ≈ 1.5), ya'ni dublyaj videodan tobora orqada
qolib ketardi.

MMS modeli faqat **kirill** yozuvini tushunadi, Google Translate esa **lotin**da
qaytaradi — orasidagi ko'prik [`server/uz_translit.py`](server/uz_translit.py).

---

## O'rnatish

### 1-qadam. Ovoz serverini tayyorlash

Bu bir martalik va ~2 GB joy egallaydi (PyTorch + modellar).

```bash
cd server
bash setup_env.sh              # Python muhiti + PyTorch (CPU) + kutubxonalar
git clone --depth 1 https://github.com/myshell-ai/OpenVoice.git OpenVoice
.venv/Scripts/python.exe fetch_ckpt.py   # OpenVoice V2 checkpoint (~131 MB)
```

### 2-qadam. Serverni ishga tushirish

`server/run.cmd` faylini ikki marta bosing. Oyna **ochiq qolishi kerak** —
kengaytma shu serverga murojaat qiladi.

Birinchi ishga tushirishda ovoz tembrlari hisoblanadi (~40 s), keyingi safar
keshdan olinadi (~3 s).

Tekshirish: brauzerda <http://127.0.0.1:8788/health> — `"ready": true` bo'lishi kerak.

### 3-qadam. Kengaytmani o'rnatish

1. Chrome'da `chrome://extensions` sahifasini oching
2. O'ng yuqorida **Developer mode** ni yoqing
3. **Load unpacked** → shu loyihadagi `extension/` papkasini tanlang

### 4-qadam. Deepgram kalitini kiritish

1. <https://console.deepgram.com/signup> — ro'yxatdan o'ting (hisobga bepul kredit tushadi)
2. API kalitini nusxalang
3. Kengaytma ikonkasi → **Sozlamalar** → kalitni joylashtiring

---

## Foydalanish

Kengaytma ikonkasini bosing:

| Boshqaruv | Vazifasi |
|---|---|
| **Tarjimani boshlash / to'xtatish** | Butun tarjimani yoqadi va o'chiradi |
| **Ovoz balandligi** | Tarjima (Elbek) ovozining balandligi |
| **Asl balandlik** | Videoning o'z ovozi balandligi |
| **Subtitrni ko'rsatish** | Video ustida subtitr chiqarish |

Bir marta yoqilgach, tarjima o'zi ishlayveradi — yangi video ochsangiz ham
qaytadan yoqish kerak emas.

### Avtomatik xatti-harakatlar

- **Ducking** — tarjima gapirayotganda videoning o'z ovozi vaqtincha pasayadi
  (darajasi Sozlamalarda).
- **Kechikishni tenglash** — dublyaj videodan belgilangan chegaradan ko'p orqada
  qolsa, video 0.9× tezlikka o'tadi va tarjima yetib oladi. Keyin tezlik o'ziga qaytadi.
- **Sakrashda tozalash** — videoda oldinga/orqaga sakrasangiz, eskirgan tarjimalar
  navbatdan o'chiriladi.

---

## Kutiladigan kechikish

Bu mashinada (i7-10700, GPU yo'q) o'lchangan:

| Bosqich | Vaqt |
|---|---|
| Deepgram gap tugashini aniqlaydi | ~0.3–1.0 s |
| Tarjima | ~0.2–0.4 s |
| Ovoz sintezi (MMS + OpenVoice) | audio uzunligining ~0.75 qismi |

Ya'ni 5 soniyalik gap uchun dublyaj taxminan **4–6 soniya kechikib** boshlanadi.
RTF < 1 bo'lgani uchun kechikish o'sib ketmaydi — quvur yetib oladi va
barqarorlashadi.

---

## Cheklovlar

- **Namuna qisqa.** `voice/elbek_mirzohidov.mp3` — 20 soniya. Ovoz klonlash uchun
  1–3 daqiqa tavsiya etiladi. Uzunroq va tozaroq (fonda musiqa/shovqinsiz) yozuv
  qo'ysangiz o'xshashlik sezilarli yaxshilanadi — faylni almashtiring, server
  o'zi qayta hisoblaydi.
- **Server ochiq turishi kerak.** `run.cmd` yopilsa tarjima ovozi to'xtaydi.
- **CORS bilan himoyalangan videolar.** Ba'zi saytlarda brauzer video audiosini
  o'qishga ruxsat bermaydi; bunday holda sahifada ogohlantirish chiqadi. YouTube
  va ko'pchilik saytlarda ishlaydi.
- **Deepgram pullik** (bepul kreditdan keyin). Bu — quvurdagi yagona pullik qism.
- **Bir vaqtda bitta video.** Har bir tab uchun bitta asosiy video tarjima qilinadi.
- **Saytning o'z ovoz slayderi ishlamay qoladi.** Tarjima yoqilganda kengaytma
  video elementining darajasini 1 da ushlab turadi. Buning sababi texnik: brauzer
  audio grafi signalni element ovozidan *keyin* beradi, ya'ni YouTube slayderini
  pasaytirsangiz nutq tanish ham kar bo'lib qolardi. Shu sababli balandlikni
  popup'dagi **Asl balandlik** slayderi bilan boshqaring. Tarjima o'chirilgach
  saytning o'z slayderi yana odatdagidek ishlaydi.

---

## Muammolarni hal qilish

Popup'ning pastidagi uchinchi qator joriy sahifadagi quvurning **haqiqiy
holatini** ko'rsatadi. Avval o'sha yerga qarang.

| Popup nima deydi | Ma'nosi va yechimi |
|---|---|
| «Sahifada kengaytma ishlamayapti» | Content script bu tabga kirmagan — odatda sahifa kengaytmadan oldin ochilgan. **Sahifani yangilash** tugmasini bosing. |
| «Ijro etilayotgan video topilmadi» | Video pauzada, ovozi o'chirilgan yoki hali yuklanmagan. Ijro eting. |
| «Audio grafga ulanmagan» | Boshqa kengaytma shu videoga allaqachon ulangan (ovoz kuchaytirgichlar, ekvalayzerlar). Ularni o'chiring. |
| «Video audiosi o'qilmayapti» | Sayt CORS sababli audioni bermayapti. Bu saytda ishlamaydi. |
| «Deepgram ulanmagan» | Kalit noto'g'ri yoki krediti tugagan. Sozlamalardan tekshiring. |
| «Tinglanmoqda… ovoz hali yo'q» | Quvur ishlayapti, birinchi jumla sintez qilinmoqda. 5–10 soniya kuting. |

**Ovoz umuman yo'q, popup esa "Ishlayapti" deydi:** "Ovoz balandligi" 0% da
emasligini tekshiring.

**Sahifani yangilash nega kerak bo'ladi?** Chrome content script'ni faqat
kengaytma o'rnatilgandan keyin ochilgan sahifalarga kiritadi. Kengaytma buni
o'zi tuzatishga harakat qiladi (tarjima yoqilganda ochiq tablarga kodni
kiritadi), lekin `chrome://`, Chrome Web Store va shunga o'xshash yopiq
sahifalarda bu mumkin emas.

---

## Ovoz namunasini almashtirish

```bash
# Yangi, uzunroq yozuvni qo'ying
cp yangi_yozuv.mp3 voice/elbek_mirzohidov.mp3
# Eski tembr keshini o'chiring
rm server/cache/tgt_se_*.pth
# Serverni qayta ishga tushiring
```

A/B namunalarini qayta yaratish:

```bash
cd server && .venv/Scripts/python.exe make_samples.py
```

`samples/` ichida uchta fayl paydo bo'ladi: asl namuna, neytral MMS ovozi va
tembri o'girilgan variant.

---

## Fayllar

```
extension/
  manifest.json          MV3 manifest
  background.js          Quvur boshqaruvi (STT → tarjima → TTS)
  content/content.js     Audio graf, subtitr overlay, kechikish nazorati
  worklet/               48 kHz → 16 kHz PCM qayta diskretlash
  lib/                   settings, stt (Deepgram), translate, tts
  popup/                 To'rtta asosiy boshqaruv
  options/               API kalitlar va nozik sozlamalar

server/
  app.py                 FastAPI: /health, POST /speak
  voice_engine.py        MMS-TTS + OpenVoice zanjiri
  uz_translit.py         O'zbek lotin → kirill
  run.cmd                Ishga tushirish
```

---

## Litsenziyalar

| Komponent | Litsenziya |
|---|---|
| OpenVoice V2 | MIT — tijorat uchun ham ruxsat |
| MMS-TTS | CC-BY-NC 4.0 — **notijorat** |
| Deepgram, Google Translate | O'z shartlari bo'yicha |

MMS-TTS notijorat litsenziyada bo'lgani uchun bu loyihani shaxsiy foydalanishdan
tashqarida ishlatishdan oldin litsenziyani tekshiring.

Ovoz namunasidan foydalanishga Elbek Mirzohidovning roziligi bo'lishi kerak.
