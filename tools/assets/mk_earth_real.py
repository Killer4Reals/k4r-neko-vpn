# -*- coding: utf-8 -*-
"""Настоящая Земля: день, облака, огни, вода и рельеф из снимков NASA.

Синтетические текстуры выглядели как рисунок: ровные биомы, одинаковый океан.
Здесь берём реальные снимки (Blue Marble, public domain) и приводим их к нашим
файлам: цвет дня, облака, ночные огни, маска воды и карта нормалей из высот.

Вход: C:/Users/KILLER~1/AppData/Local/Temp/{2_no_clouds_4k.jpg,fair_clouds_4k.png,
      earth_lights_2048.png,water_4k.png,elev_bump_4k.jpg}
Выход: app/public/earth/*.webp|png
"""
import io
import os

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

SRC = "C:/Users/KILLER~1/AppData/Local/Temp"
OUT = "K4R Neko VPN/app/public/earth"
W, H = 4096, 2048
NW, NH = 2048, 1024
os.makedirs(OUT, exist_ok=True)


def load(name):
    return Image.open(f"{SRC}/{name}")


# --- день -------------------------------------------------------------------
day = load("2_no_clouds_4k.jpg").convert("RGB").resize((W, H), Image.LANCZOS)
# Снимок уже насыщенный; добавляем немного контраста и резкости, чтобы на шаре
# читались берега и пустыни, но без «пережаренных» цветов.
day = ImageEnhance.Color(day).enhance(1.10)
day = ImageEnhance.Contrast(day).enhance(1.05)
day = day.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=3))

arr = np.asarray(day).astype(np.float32)
lat = 90.0 - (np.arange(H) + 0.5) / H * 180.0
lat_abs = np.abs(lat)[:, None, None]
# У полюсов строки текстуры сходятся в точку — мягко уводим их в лёд.
ice = np.array([238, 245, 252], dtype=np.float32)
polar = np.clip((lat_abs - 78.0) / 8.0, 0.0, 1.0) ** 1.2
arr = arr * (1.0 - polar) + ice * polar
day = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
day.save(f"{OUT}/day.webp", quality=86, method=6)
print("day.webp", os.path.getsize(f"{OUT}/day.webp") // 1024, "KB")

# --- облака -----------------------------------------------------------------
# В исходнике плотность облаков лежит в альфа-канале, а цвет белый — берём альфу.
raw = load("fair_clouds_4k.png").convert("RGBA")
# Облака мягкие: половины разрешения достаточно, а файл втрое легче.
clouds = raw.split()[3].resize((NW // 2, NH // 2), Image.LANCZOS)
ca = np.asarray(clouds).astype(np.float32)
print("clouds mean", round(float(ca.mean()), 1), "max", int(ca.max()))
clouds.save(f"{OUT}/clouds.webp", quality=88, method=6)
print("clouds.webp", os.path.getsize(f"{OUT}/clouds.webp") // 1024, "KB")

# --- ночные огни ------------------------------------------------------------
lights = load("earth_lights_2048.png").convert("RGB")
lights.save(f"{OUT}/lights.webp", quality=88, method=6)
print("lights.webp", os.path.getsize(f"{OUT}/lights.webp") // 1024, "KB")

# --- вода -------------------------------------------------------------------
water = load("water_4k.png").convert("L").resize((NW // 2, NH // 2), Image.LANCZOS)
water_full = None
wa = np.asarray(water).astype(np.float32) / 255.0
# Проверяем ориентацию маски: в Тихом океане у 0°/-150° должно быть «вода».
def at(latd, lond):
    x = int((lond + 180.0) / 360.0 * water.size[0]) % water.size[0]
    y = int((90.0 - latd) / 180.0 * water.size[1])
    return round(float(wa[y, x]), 2)
pacific, sahara, atlantic = at(0, -150), at(23, 10), at(30, -40)
print("water mask: pacific", pacific, "sahara", sahara, "atlantic", atlantic)
if pacific < 0.5:  # в файле белое = суша, инвертируем под наш шейдер
    water = Image.fromarray((255 - np.asarray(water)).astype(np.uint8), "L")
    print("water mask inverted")
water.save(f"{OUT}/water.png", optimize=True)
print("water.png", os.path.getsize(f"{OUT}/water.png") // 1024, "KB")

# --- рельеф из реальных высот ----------------------------------------------
bump = load("elev_bump_4k.jpg").convert("L").resize((W, H), Image.LANCZOS)
hgt = np.asarray(bump).astype(np.float32) / 255.0
# Океан в этой карте почти чёрный — рельеф нужен только на суше.
hgt = hgt ** 1.35
coslat = np.clip(np.cos(np.deg2rad(lat)), 0.35, 1.0)[:, None]
gy, gx = np.gradient(hgt)
gx = gx / coslat
STRENGTH = 26.0
nx, ny, nz = -gx * STRENGTH, -gy * STRENGTH, np.ones_like(gx)
norm = np.sqrt(nx * nx + ny * ny + nz * nz)
rgb = np.stack([nx / norm, ny / norm, nz / norm], axis=-1) * 0.5 + 0.5
img = Image.fromarray(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), "RGB")
img = img.filter(ImageFilter.GaussianBlur(1.2)).resize((NW, NH), Image.LANCZOS)
img.save(f"{OUT}/normal.webp", quality=92, method=6)
print("normal.webp", os.path.getsize(f"{OUT}/normal.webp") // 1024, "KB")
