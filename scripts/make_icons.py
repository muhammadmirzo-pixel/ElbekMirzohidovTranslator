"""Kengaytma ikonkalarini yaratadi.

Tasvir: to'q fonli yumaloq kvadrat, ustida yashil ovoz to'lqini.
Kichik o'lchamlarda ham tanilishi uchun ataylab sodda — 16px da faqat
to'rtta ustun ko'rinadi.
"""

import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "extension", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (28, 31, 39, 255)
ACCENT = (53, 192, 138, 255)
ACCENT_SOFT = (35, 140, 100, 255)

# Ustunlarning nisbiy balandligi (0..1). O'rtasi baland — ovoz to'lqini shakli.
BARS = [0.30, 0.62, 1.00, 0.72, 0.42]


def make(size: int) -> Image.Image:
    # 4x kattaroq chizib, keyin kichraytiramiz — chekkalar silliq chiqadi.
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)

    n = len(BARS)
    span = s * 0.62           # ustunlar egallaydigan kenglik
    bar_w = span / (n * 1.8)  # ustun kengligi, oralari bilan
    gap = (span - bar_w * n) / (n - 1)
    x0 = (s - span) / 2
    cy = s / 2
    max_h = s * 0.52

    for i, h in enumerate(BARS):
        x = x0 + i * (bar_w + gap)
        bh = max_h * h
        color = ACCENT if h > 0.5 else ACCENT_SOFT
        d.rounded_rectangle(
            [x, cy - bh / 2, x + bar_w, cy + bh / 2],
            radius=bar_w / 2,
            fill=color,
        )

    return img.resize((size, size), Image.LANCZOS)


for size in (16, 32, 48, 128):
    path = os.path.join(OUT, f"icon{size}.png")
    make(size).save(path)
    print(f"  {path}  ({os.path.getsize(path)} bayt)")

print("Ikonkalar tayyor.")
