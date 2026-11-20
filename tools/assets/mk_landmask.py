# -*- coding: utf-8 -*-
import json, io, base64
from PIL import Image, ImageDraw

W, H = 180, 90
SS = 6

img = Image.new('L', (W * SS, H * SS), 0)
draw = ImageDraw.Draw(img)
data = json.load(io.open('E:/DeepAICodeProject/.land.geojson', encoding='utf-8'))

def ring_px(ring):
    return [(((lon + 180) / 360) * W * SS, ((90 - lat) / 180) * H * SS) for lon, lat in ring]

for f in data['features']:
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        draw.polygon(ring_px(poly[0]), fill=255)
        for hole in poly[1:]:
            draw.polygon(ring_px(hole), fill=0)

small = img.resize((W, H), Image.BOX)
px = small.load()

rows = []
for y in range(H):
    row = 0
    n = 0
    lat = 90 - (y + 0.5) * 2
    for x in range(W):
        on = px[x, y] > 110
        # у полюсов клетки сходятся в кольца — прореживаем и срезаем шапку
        # Антарктида у полюса сходится в «отпечаток» — её срезаем.
        if on and (lat < -72 or lat > 74):
            on = False
        if on:
            row |= 1 << (7 - n)
        n += 1
        if n == 8:
            rows.append(row)
            row = 0
            n = 0
    if n:
        rows.append(row)

raw = bytes(rows)
b64 = base64.b64encode(raw).decode()
print('dots', sum(bin(b).count('1') for b in raw), 'b64', len(b64))

lines = [
    '/**',
    ' * Суша для глобуса: сетка 180×90 (2° на клетку), бит = суша.',
    ' * Источник — Natural Earth 110m land, растеризовано с суперсэмплингом:',
    ' * карта в репозиторий не попадает, только 2 КБ битов.',
    ' */',
    '',
    'export const LAND_W = 180;',
    'export const LAND_H = 90;',
    '',
    'export const LANDMASK_B64 =',
]
chunk = 96
parts = [b64[i:i+chunk] for i in range(0, len(b64), chunk)]
for i, p in enumerate(parts):
    tail = ' +' if i < len(parts) - 1 else ';'
    lines.append('  "' + p + '"' + tail)
io.open('src/landmask.ts', 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
io.open('dist/landmask.txt', 'w', encoding='ascii').write(b64)
print('ok')
