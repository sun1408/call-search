"""Draws the app icons (any + maskable) with Pillow. Run: python3 -I scripts/make-icons.py public/icons"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SUPERSAMPLE = 4
BLUE_TOP = (11, 107, 203)
BLUE_BOTTOM = (0, 117, 222)
WHITE = (255, 255, 255)
MARKER = (247, 201, 72)


def draw_mark(size: int, scale: float, rounded: bool) -> Image.Image:
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    bg = Image.new("RGBA", (big, big))
    for y in range(big):
        t = y / (big - 1)
        c = tuple(round(BLUE_TOP[i] * (1 - t) + BLUE_BOTTOM[i] * t) for i in range(3))
        ImageDraw.Draw(bg).line([(0, y), (big, y)], fill=c + (255,))
    mask = Image.new("L", (big, big), 0)
    if rounded:
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=255)
    else:
        ImageDraw.Draw(mask).rectangle([0, 0, big, big], fill=255)
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    u = big / 512

    def px(v: float) -> float:
        return (256 + (v - 256) * scale) * u

    def bar(x0, y, x1, color, thick=30):
        t = thick * scale * u
        d.rounded_rectangle([px(x0), px(y) - t / 2, px(x1), px(y) + t / 2], radius=t / 2, fill=color)

    bar(112, 152, 332, WHITE)
    bar(112, 214, 372, MARKER)
    bar(112, 276, 262, WHITE)
    cx, cy, r, w = px(330), px(326), 74 * scale * u, 30 * scale * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=round(w))
    hx0, hy0 = px(330 + 58), px(326 + 58)
    hx1, hy1 = px(436), px(432)
    d.line([(hx0, hy0), (hx1, hy1)], fill=WHITE, width=round(34 * scale * u))
    hr = 17 * scale * u
    d.ellipse([hx1 - hr, hy1 - hr, hx1 + hr, hy1 + hr], fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    draw_mark(512, 1.0, True).save(out / "icon-512.png", optimize=True)
    draw_mark(192, 1.0, True).save(out / "icon-192.png", optimize=True)
    draw_mark(512, 0.78, False).save(out / "maskable-512.png", optimize=True)


if __name__ == "__main__":
    main()
