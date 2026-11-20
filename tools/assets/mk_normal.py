# -*- coding: utf-8 -*-
"""Карта рельефа (normal map) для глобуса: горы, плато, впадины океана.

День-текстура отвечает за цвет, а этот файл — за то, как на материки падает
свет: без него планета выглядит наклейкой, с ним — объёмной.

Выход: app/public/earth/normal.png (2048×1024, tangent-space).
"""
import io
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = ".land50.geojson"
OUT = "K4R Neko VPN/app/public/earth"
W, H = 4096, 2048
NW, NH = 2048, 1024

os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
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


def noise(cells, blur, cells_y=None):
    cy = cells_y or cells * 2
    small = rng.random((max(3, cells), max(3, cy))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8), "L").resize((W, H), Image.BICUBIC)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img).astype(np.float32) / 255.0


# --- высота суши -----------------------------------------------------------
# Глубина внутри материка: у берега ноль, в центре — единица. Так материки
# получают естественный «подъём» от побережья к плоскогорьям.
inland = np.asarray(mask.filter(ImageFilter.GaussianBlur(26))).astype(np.float32) / 255.0
inland = np.clip((inland - 0.45) / 0.45, 0.0, 1.0) * m

# Хребты: «гребневой» шум (1 - |2n-1|) даёт линии горных цепей, а не бугры.
# Крупные масштабы важнее мелких: с орбиты видно хребты и плато, а не песок.
ridge = np.zeros((H, W), dtype=np.float32)
amp = 1.0
total = 0.0
for cells, blur in ((9, 9), (20, 6), (40, 4)):
    n = noise(cells, blur)
    ridge += (1.0 - np.abs(2.0 * n - 1.0)) ** 2.0 * amp
    total += amp
    amp *= 0.55
ridge /= total
# горные цепи идут полосами, а не ровным ковром
belt = noise(14, 10)
belt = np.clip((belt - 0.42) / 0.35, 0.0, 1.0)
ridge = ridge * (0.25 + 0.75 * belt)
ridge = np.asarray(
    Image.fromarray((np.clip(ridge, 0, 1) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(2.0))
).astype(np.float32) / 255.0

plateau = inland ** 1.5
# Склон у самой воды должен быть пологим, иначе берег светится яркой каймой.
ramp = np.asarray(mask.filter(ImageFilter.GaussianBlur(20))).astype(np.float32) / 255.0
ramp = np.clip((ramp - 0.15) / 0.55, 0.0, 1.0)

height = (plateau * 0.28 + ridge * 0.72 * (0.25 + 0.75 * plateau)) * ramp

# Океан: лёгкая волнистость дна, но без «гор» под водой.
height = height - (1.0 - m) * 0.06

# Широтный масштаб: у полюсов тот же шаг по долготе короче, иначе склоны
# у Гренландии выглядят втрое круче, чем у Африки.
lat = 90.0 - (np.arange(H) + 0.5) / H * 180.0
# У полюсов деление на cos(lat) даёт «звёздные лучи» из точки полюса:
# ограничиваем множитель, чтобы Гренландия не расходилась веером.
coslat = np.clip(np.cos(np.deg2rad(lat)), 0.35, 1.0)[:, None]

gy, gx = np.gradient(height)
gx = gx / coslat
gy = gy

STRENGTH = 8.5
nx = -gx * STRENGTH
ny = -gy * STRENGTH
nz = np.ones_like(nx)
norm = np.sqrt(nx * nx + ny * ny + nz * nz)
nx, ny, nz = nx / norm, ny / norm, nz / norm

rgb = np.stack([nx, ny, nz], axis=-1) * 0.5 + 0.5
img = Image.fromarray(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), "RGB")
# Лёгкое размытие нормалей убирает «песок»: рельеф должен читаться хребтами.
img = img.filter(ImageFilter.GaussianBlur(1.1))
img = img.resize((NW, NH), Image.LANCZOS)
img.save(f"{OUT}/normal.png", optimize=True)
print("normal.png", os.path.getsize(f"{OUT}/normal.png") // 1024, "KB")

# --- вода: карта для блика и «стеклянности» океана -------------------------
water = np.clip((1.0 - m) * 255.0, 0, 255).astype(np.uint8)
Image.fromarray(water, "L").resize((NW, NH), Image.LANCZOS).save(f"{OUT}/water.png", optimize=True)
print("water.png", os.path.getsize(f"{OUT}/water.png") // 1024, "KB")

# --- маска высот для проверки глазами ------------------------------------
Image.fromarray((np.clip(height / max(height.max(), 1e-6), 0, 1) * 255).astype(np.uint8), "L").resize(
    (NW, NH), Image.LANCZOS
).save("C:/Users/KILLER~1/AppData/Local/Temp/height_preview.png")
print("height max", round(float(height.max()), 3))
