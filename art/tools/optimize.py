"""Ship-size assets: masters stay PNG in art/final, the app gets WebP."""
from pathlib import Path

from PIL import Image

FIN = Path(__file__).resolve().parents[1] / "final"
PUB = Path(__file__).resolve().parents[1].parent / "app" / "public" / "mascot"

JOBS = [
    ("state_connected.png", "connected.webp", 720),
    ("state_error.png", "error.webp", 720),
    ("state_idle.png", "idle.webp", 720),
    ("state_connecting.png", "connecting.webp", 720),
    ("state_empty.png", "empty.webp", 520),
    ("state_log_empty.png", "log-empty.webp", 520),
    ("state_wave.png", "wave.webp", 720),
    ("banner_hero.png", "banner.webp", 1100),
]

for src, dst, w in JOBS:
    im = Image.open(FIN / src).convert("RGBA")
    im = im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
    im.save(PUB / dst, "WEBP", quality=86, method=6)
    print(f"{dst:18} {im.size} {(PUB / dst).stat().st_size // 1024} KB")
