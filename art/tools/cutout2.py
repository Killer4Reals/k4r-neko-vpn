# Отделяет персонажа от ровного фона заливкой от краёв: то, что связано с фоном
# и похоже на него по цвету, становится прозрачным. Внутренние светлые места
# (блики в глазах) остаются, потому что заливка до них не достаёт.
from collections import deque
from PIL import Image, ImageFilter
import numpy as np


def cutout(path, tol=16, feather=0.9, pad=0.04, seeds=()):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    # цвет фона — средний по углам
    corners = np.array([a[0, 0], a[0, w - 1], a[h - 1, 0], a[h - 1, w - 1]])
    bg = corners.mean(axis=0)
    near = (np.abs(a - bg).max(axis=2) <= tol)

    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    # отдельные пятна фона, запертые между деталями рисунка
    for sx, sy in seeds:
        if 0 <= sy < h and 0 <= sx < w and near[sy, sx] and not seen[sy, sx]:
            seen[sy, sx] = True
            q.append((sy, sx))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    # Мелочь, которую заливка не достала: чистые белые пятна в нижней части
    # рисунка (щели между трубами, просветы у обуви). Серебро труб и блики в
    # глазах не трогаем — они либо другого цвета, либо выше по картинке.
    diff = np.abs(a - bg).max(axis=2)
    pure = near & ~seen & (diff <= 14)
    lbl = np.zeros((h, w), dtype=bool)
    for y in range(int(h * 0.6), h):
        for x in range(w):
            if pure[y, x] and not lbl[y, x]:
                q = deque([(y, x)])
                lbl[y, x] = True
                comp = []
                while q:
                    cy, cx = q.popleft()
                    comp.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and pure[ny, nx] and not lbl[ny, nx]:
                            lbl[ny, nx] = True
                            q.append((ny, nx))
                if len(comp) < 6000:
                    for cy, cx in comp:
                        seen[cy, cx] = True

    alpha = np.where(seen, 0, 255).astype(np.uint8)
    alpha_im = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(feather))
    out = im.convert("RGBA")
    out.putalpha(alpha_im)

    box = out.split()[3].point(lambda v: 255 if v > 20 else 0).getbbox()
    if box:
        dx = int((box[2] - box[0]) * pad)
        dy = int((box[3] - box[1]) * pad)
        box = (max(0, box[0] - dx), max(0, box[1] - dy),
               min(w, box[2] + dx), min(h, box[3] + dy))
        out = out.crop(box)
    return out


def save_webp(im, dst, width, square=True):
    """Сохраняет в webp. square=True кладёт рисунок на прозрачный квадрат:
    иначе высокий персонаж в круглом «орбе» выглядит мельче, чем низкий."""
    if square:
        side = max(im.width, im.height)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        im = canvas
    h = round(im.height * width / im.width)
    im.resize((width, h), Image.LANCZOS).save(dst, "WEBP", quality=90, method=6)
    return (width, h)
