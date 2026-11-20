# -*- coding: utf-8 -*-
"""Текстуры Земли для WebGL-глобуса: 4K-день, шельф, рельеф, облака, огни.

Источник суши — Natural Earth 110m (.land.geojson).
Выход: app/public/earth/{day,water,clouds,lights}.png
"""
import io
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = ".land50.geojson"
OUT = "K4R Neko VPN/app/public/earth"
W, H = 4096, 2048
CW, CH = 2048, 1024

os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(23)

geo = json.load(io.open(SRC, encoding="utf-8"))


def exterior_rings(obj):
    g = obj.get("geometry") or {}
    t = g.get("type")
    if t == "Polygon":
        return [g["coordinates"][0]]
    if t == "MultiPolygon":
        return [p[0] for p in g["coordinates"]]
    return []


rings = [r for f in geo["features"] for r in exterior_rings(f)]
print("rings:", len(rings))


def unwrap(ring):
    out = []
    prev = None
    for lon, lat in ring:
        if prev is not None:
            while lon - prev > 180:
                lon -= 360
            while prev - lon > 180:
                lon += 360
        prev = lon
        out.append((lon, lat))
    return out


# --- маска суши -------------------------------------------------------------
MSS = 2
mask = Image.new("L", (W * MSS, H * MSS), 0)
dm = ImageDraw.Draw(mask)
for r in rings:
    pts = [(((lon + 180.0) / 360.0) * W * MSS, ((90.0 - lat) / 180.0) * H * MSS) for lon, lat in unwrap(r)]
    if len(pts) < 3:
        continue
    for shift in (-W * MSS, 0, W * MSS):
        dm.polygon([(x + shift, y) for x, y in pts], fill=255)
mask = mask.resize((W, H), Image.LANCZOS)
m = np.clip((np.asarray(mask).astype(np.float32) / 255.0 - 0.35) / 0.3, 0.0, 1.0)
print("land:", round(float((m > 0.5).mean()) * 100, 1), "%")

lat = 90.0 - (np.arange(H) + 0.5) / H * 180.0
a = np.abs(lat)

# --- цвет суши --------------------------------------------------------------
palette = [
    (6, 9, (38, 96, 44)),
    (19, 8, (104, 118, 58)),
    (26, 7, (186, 158, 98)),
    (38, 8, (68, 108, 56)),
    (54, 8, (72, 96, 66)),
    (70, 7, (140, 144, 134)),
    (80, 12, (238, 244, 250)),
]
tone = np.zeros((len(a), 3), dtype=np.float32)
wsum = np.zeros(len(a), dtype=np.float32)
for center, spread, color in palette:
    w = np.exp(-((a - center) ** 2) / (2 * spread ** 2)) + 1e-4
    tone += np.array(color, dtype=np.float32) * w[:, None]
    wsum += w
land_color = tone / wsum[:, None]


def noise(w, h, cells, blur):
    small = rng.random((max(3, cells), max(3, cells * 2))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8), "L").resize((w, h), Image.BICUBIC)
    return np.asarray(img.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32) / 255.0


# два масштаба пятнистости: крупные биомы + мелкая «трава»
coarse = noise(W, H, 40, 10)
fine = noise(W, H, 260, 1.2)
# Мелкое зерно на шаре читается как «шум матрицы», поэтому его почти нет:
# объём даёт карта рельефа, а не крапинки на текстуре.
grain = 0.92 + coarse[:, :, None] * 0.14 + (fine[:, :, None] - 0.5) * 0.04
land = np.clip(land_color[:, None, :] * grain, 0, 255)

# Рельеф раньше запекался в цвет — на шаре это читалось как наждак и мешало
# настоящему свету из карты нормалей (normal.png). Оставляем только очень
# слабую неровность тона, чтобы суша не была пластиковой.

# --- океан: глубина, шельф, течение ----------------------------------------
xx = np.linspace(-1.0, 1.0, W)[None, :]
yy = np.linspace(-1.0, 1.0, H)[:, None]
shelf = np.asarray(mask.filter(ImageFilter.GaussianBlur(14))).astype(np.float32) / 255.0
shelf = np.clip(shelf - m, 0.0, 1.0) ** 0.75 * (1.0 - m)

# Глубину ведём только по широте: любые синусоиды по долготе дают на шаре
# заметные концентрические полосы.
depth = np.clip(
    0.38 + 0.50 * (1.0 - np.abs(yy)) ** 1.6 + (fine - 0.5) * 0.04,
    0.0,
    1.0,
)
ocean = np.stack([4 + 20 * depth, 22 + 62 * depth, 46 + 106 * depth], axis=-1).astype(np.float32)
# мелководье светлее и зеленее — вокруг материков появляется бирюзовая кайма
shelf_col = np.array([62, 168, 186], dtype=np.float32)
ocean = ocean * (1.0 - shelf[:, :, None] * 0.42) + shelf_col * (shelf[:, :, None] * 0.42)

edge_blur = np.asarray(mask.filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32) / 255.0
coast_line = np.abs(m - edge_blur) * 2.6
coast_line = np.clip(coast_line, 0.0, 0.55)[:, :, None]
day = ocean * (1.0 - m[:, :, None]) + land * m[:, :, None]
day = day * (1.0 - coast_line * 0.45) + np.array([214, 226, 232], dtype=np.float32) * coast_line * 0.28
# Полярные шапки: у полюса строки текстуры сходятся в точку и любой рисунок
# растягивается в «снежинку». Поэтому у полюсов цвет плавно уходит в лёд —
# там нет деталей, которые можно испортить.
ice = np.array([238, 245, 252], dtype=np.float32)
lat_abs = np.abs(lat)[:, None, None]
polar = np.clip((lat_abs - 64.0) / 12.0, 0.0, 1.0) ** 0.9
day = day * (1.0 - polar) + ice * polar

Image.fromarray(np.clip(day, 0, 255).astype(np.uint8), "RGB").save(
    f"{OUT}/day.webp", quality=92, method=6
)
print("day.webp", os.path.getsize(f"{OUT}/day.webp") // 1024, "KB")

# water.png делает .mk_normal.py — там же, где карта рельефа, чтобы маска
# и нормали совпадали по размеру.

# --- облака: вытянутые полосы ----------------------------------------------
acc = np.zeros((CH, CW), dtype=np.float32)
for cells, weight in ((8, 0.45), (18, 0.3), (40, 0.25)):
    small = rng.random((max(4, CH // cells), max(4, CW // (cells * 3)))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8), "L").resize((CW, CH), Image.BICUBIC)
    acc += np.asarray(img).astype(np.float32) / 255.0 * weight
acc /= acc.max()
lad = np.abs(np.linspace(-1, 1, CH))[:, None]
band = 0.55 + 0.6 * np.exp(-((lad - 0.05) ** 2) / 0.06) + 0.45 * np.exp(-((lad - 0.7) ** 2) / 0.03)
acc = np.clip((acc * band - 0.25) / 0.75, 0, 1) ** 1.4
Image.fromarray((acc * 165).astype(np.uint8), "L").save(f"{OUT}/clouds.webp", quality=88, method=6)
print("clouds.webp", os.path.getsize(f"{OUT}/clouds.webp") // 1024, "KB")

# --- ночные огни -----------------------------------------------------------
lights = Image.new("RGB", (W, H), (0, 0, 0))
dl = ImageDraw.Draw(lights)
mask_np = np.asarray(mask)
ys, xs = np.nonzero(mask_np > 140)
coast = np.asarray(mask.filter(ImageFilter.GaussianBlur(18))).astype(np.float32) / 255.0
picks = rng.choice(len(ys), size=min(160000, len(ys)), replace=False)
placed = 0
for i in picks:
    y, x = int(ys[i]), int(xs[i])
    la = 90.0 - (y + 0.5) / H * 180.0
    if abs(la) > 64:
        continue
    density = 0.2 + 0.62 * math.exp(-((abs(la) - 40.0) ** 2) / 900.0)
    if rng.random() > density:
        continue
    if rng.random() > 0.28 + float(coast[y, x]) * 0.72:
        continue
    r = 1 if rng.random() < 0.86 else 2
    col = (190, 162, 96) if rng.random() < 0.72 else (122, 162, 208)
    dl.ellipse([x - r, y - r, x + r, y + r], fill=col)
    placed += 1
lights = lights.filter(ImageFilter.GaussianBlur(0.5)).resize((2048, 1024), Image.LANCZOS)
lights.save(f"{OUT}/lights.webp", quality=86, method=6)
print("lights.webp", os.path.getsize(f"{OUT}/lights.webp") // 1024, "KB", "lights:", placed)
