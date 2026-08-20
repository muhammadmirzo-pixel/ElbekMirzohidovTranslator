"""O'zbek lotin yozuvini kirill yozuviga o'girish.

Buning sababi: `facebook/mms-tts-uzb-script_cyrillic` — mavjud yagona sifatli
ochiq o'zbek TTS modeli — faqat kirill yozuvini tushunadi. Google Translate esa
o'zbekchani lotin yozuvida qaytaradi. Shu ikkisi orasidagi ko'prik shu modul.
"""

import re

# Ko'p harfli birikmalar avval almashtiriladi, aks holda "sh" -> "сҳ" bo'lib
# ketadi. Ro'yxat tartibi shuning uchun muhim.
_DIGRAPHS = [
    ("ch", "ч"), ("Ch", "Ч"), ("CH", "Ч"),
    ("sh", "ш"), ("Sh", "Ш"), ("SH", "Ш"),
    ("ya", "я"), ("Ya", "Я"), ("YA", "Я"),
    ("yo", "ё"), ("Yo", "Ё"), ("YO", "Ё"),
    ("yu", "ю"), ("Yu", "Ю"), ("YU", "Ю"),
    ("ts", "ц"), ("Ts", "Ц"), ("TS", "Ц"),
]

# o' va g' turli belgilar bilan yozilishi mumkin: to'g'ri tipografik ʻ (U+02BB),
# oddiy apostrof ', ozod urg'u ` va Unicode ʼ (U+02BC).
_APOS = "ʻʼ‘’'`´"
_OQ = re.compile(f"[oO][{_APOS}]")
_GQ = re.compile(f"[gG][{_APOS}]")

_SINGLE = {
    "a": "а", "b": "б", "d": "д", "f": "ф", "g": "г", "h": "ҳ",
    "i": "и", "j": "ж", "k": "к", "l": "л", "m": "м", "n": "н",
    "o": "о", "p": "п", "q": "қ", "r": "р", "s": "с", "t": "т",
    "u": "у", "v": "в", "x": "х", "y": "й", "z": "з", "c": "к",
    "w": "в",
}


def _map_char(ch: str) -> str:
    low = ch.lower()
    if low in _SINGLE:
        out = _SINGLE[low]
        return out.upper() if ch.isupper() else out
    return ch


def latin_to_cyrillic(text: str) -> str:
    """O'zbek lotin matnini kirillga o'giradi. Notanish belgilar o'z holicha qoladi."""
    if not text:
        return ""

    s = text
    # 1) o' va g' — boshqa hamma narsadan oldin, chunki keyingi bosqichlar
    #    apostrofni yo'qotib yuboradi.
    s = _OQ.sub(lambda m: "Ў" if m.group(0)[0].isupper() else "ў", s)
    s = _GQ.sub(lambda m: "Ғ" if m.group(0)[0].isupper() else "ғ", s)

    # 2) Ko'p harfli birikmalar.
    for lat, cyr in _DIGRAPHS:
        s = s.replace(lat, cyr)

    # 3) "e" harfi: so'z boshida э, qolgan joyda е.
    out = []
    for i, ch in enumerate(s):
        if ch in "eE":
            prev = s[i - 1] if i > 0 else ""
            word_start = (i == 0) or not (prev.isalpha() or prev in _APOS)
            cyr = ("Э" if ch.isupper() else "э") if word_start else ("Е" if ch.isupper() else "е")
            out.append(cyr)
        else:
            out.append(ch)
    s = "".join(out)

    # 4) Qolgan tutuq belgilari — ayirish belgisi.
    s = re.sub(f"[{_APOS}]", "ъ", s)

    # 5) Bir harfli almashtirishlar.
    return "".join(_map_char(c) for c in s)


# TTS modeli juda uzun matnda buzilib ketadi, shuning uchun matn gaplarga
# bo'linadi va kerak bo'lsa vergul bo'yicha yana maydalanadi.
_SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+")


def split_for_tts(text: str, max_chars: int = 180):
    """Matnni TTS uchun qulay bo'laklarga ajratadi."""
    chunks = []
    for sentence in _SENT_SPLIT.split(text.strip()):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            chunks.append(sentence)
            continue
        # Uzun gap — vergul/bog'lovchi bo'yicha maydalaymiz.
        buf = ""
        for part in re.split(r"(?<=[,;:])\s+", sentence):
            if len(buf) + len(part) + 1 <= max_chars:
                buf = f"{buf} {part}".strip()
            else:
                if buf:
                    chunks.append(buf)
                buf = part
        if buf:
            chunks.append(buf)
    return chunks or ([text.strip()] if text.strip() else [])


if __name__ == "__main__":
    samples = [
        "Salom, bu ovoz sinovi.",
        "O'zbekiston Respublikasi g'oyat go'zal mamlakat.",
        "Bugun biz brauzerdagi videolarni tarjima qiladigan dastur haqida gaplashamiz.",
        "Eshik yonida turgan yigit shoshib chiqdi.",
    ]
    for s in samples:
        print(f"{s}\n  -> {latin_to_cyrillic(s)}")
