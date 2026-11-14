"""Cutout + icon generation for K4R Neko VPN assets.

Removes the flat magenta (#FF00FF) background, despills the fringe,
trims, and produces app icons + tray glyph states.
"""
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path(__file__).resolve().parents[1] / "raw"
OUT = Path(__file__).resolve().parents[1] / "final"
OUT.mkdir(parents=True, exist_ok=True)

MAGENTA = np.array([255.0, 0.0, 255.0])


def cutout(src: Path, dst: Path, t_low: float = 70.0, t_high: float = 150.0,
           trim: bool = True, pad: int = 8) -> Image.Image:
    img = Image.open(src).convert("RGB")
    rgb = np.asarray(img).astype(np.float32)

    # distance to magenta in RGB space
    dist = np.sqrt(((rgb - MAGENTA) ** 2).sum(axis=2))
    alpha = np.clip((dist - t_low) / (t_high - t_low), 0.0, 1.0)

    # despill: on semi-transparent pixels pull R/B down toward G
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    excess = np.clip(np.minimum(r, b) - g, 0.0, 255.0) * (1.0 - alpha * 0.35)
    r = np.clip(r - excess * 0.85, 0.0, 255.0)
    b = np.clip(b - excess * 0.85, 0.0, 255.0)
    # keep saturated green/cyan tints from turning grey
    rgb_despilled = np.stack([r, g, b], axis=2)

    out = np.dstack([rgb_despilled, alpha * 255.0]).astype(np.uint8)
    im = Image.fromarray(out, "RGBA")

    if trim:
        bbox = im.getbbox()
        if bbox:
            left, top, right, bottom = bbox
            side = max(right - left, bottom - top) + pad * 2
            cx, cy = (left + right) / 2, (top + bottom) / 2
            box = (int(cx - side / 2), int(cy - side / 2),
                   int(cx + side / 2), int(cy + side / 2))
            sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            sq.paste(im.crop(box), (0, 0))
            im = sq

    im.save(dst)
    return im


def make_app_icon(bust: Path) -> None:
    im = cutout(bust, OUT / "icon_1024.png")
    sizes = [256, 128, 64, 48, 32, 16]
    im.resize((512, 512), Image.LANCZOS).save(OUT / "icon_512.png")
    im.resize((256, 256), Image.LANCZOS).save(OUT / "icon_256.png")
    im.save(OUT / "icon.ico", sizes=[(s, s) for s in sizes])


def thicken(im: Image.Image, radius: int) -> Image.Image:
    from PIL import ImageFilter

    alpha = im.getchannel("A").filter(ImageFilter.MaxFilter(radius * 2 + 1))
    out = im.copy()
    out.putalpha(alpha)
    return out


def recolor_z(img: Image.Image) -> Image.Image:
    """The 'Zzz' glyphs are near-black and vanish on a dark UI: make them neon green."""
    from PIL import ImageFilter

    arr = np.asarray(img).astype(np.int16)
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
    region = (xx > 520) & (xx < 740) & (yy > 120) & (yy < 280)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    dark_purple = (a > 180) & (np.maximum(np.maximum(r, g), b) < 95) & (b > r) & (r >= g)
    mask = region & dark_purple

    out = arr.copy()
    out[mask] = [124, 255, 77, 255]
    body = Image.fromarray(out.astype(np.uint8), "RGBA")

    glow = np.zeros_like(arr)
    glow[mask] = [124, 255, 77, 150]
    glow_img = Image.fromarray(glow.astype(np.uint8), "RGBA").filter(
        ImageFilter.GaussianBlur(6))
    result = Image.alpha_composite(glow_img, body)
    return result


def make_glyph(src: Path) -> None:
    base = Image.open(src).convert("RGB")
    rgb = np.asarray(base).astype(np.float32)
    dist = np.sqrt(((rgb - MAGENTA) ** 2).sum(axis=2))
    alpha = np.clip((dist - 60.0) / (120.0 - 60.0), 0.0, 1.0)

    # glyph is solid neon green; take its luminance as a mask and recolor
    mask = alpha
    colors = {
        "off": (107, 114, 128),
        "on": (57, 255, 20),
        "connecting": (34, 211, 238),
        "error": (242, 160, 160),
    }
    for name, (r, g, b) in colors.items():
        canvas = np.zeros((*mask.shape, 4), dtype=np.uint8)
        canvas[..., 0], canvas[..., 1], canvas[..., 2] = r, g, b
        canvas[..., 3] = (mask * 255.0).astype(np.uint8)
        im = Image.fromarray(canvas, "RGBA")
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
        side = max(im.size) + 8
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        for px in (16, 32, 64):
            small = sq.resize((px, px), Image.LANCZOS)
            if px <= 32:
                small = thicken(small, 1)
            small.save(OUT / f"tray_{name}_{px}.png")
        sq.resize((32, 32), Image.LANCZOS).save(
            OUT / f"tray_{name}.ico", sizes=[(16, 16), (32, 32), (48, 48)])


def main() -> None:
    cutout(RAW / "icon_bust.png", OUT / "avatar_512.png")
    make_app_icon(RAW / "icon_bust.png")
    # keep the original canvas for states: character stays in place across frames
    idle = cutout(RAW / "state_idle_sleep.png", OUT / "state_idle.png", trim=False)
    recolor_z(idle).save(OUT / "state_idle.png")
    cutout(RAW / "state_connecting.png", OUT / "state_connecting.png", trim=False)
    make_glyph(RAW / "glyph.png")
    for p in sorted(OUT.iterdir()):
        print(f"{p.name:24} {Image.open(p).size}")


if __name__ == "__main__":
    main()
