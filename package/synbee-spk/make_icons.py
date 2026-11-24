"""Draws the SynBee icon (a friendly bee sitting on a NAS) and writes the package and menu icons.

The icon is drawn from code with Pillow, so no binary files are kept in the repo. Run with `--preview FILE`
to write one large PNG for checking the drawing.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

S = 1024  # drawing size; icons are scaled down from it
INK = (52, 36, 22, 255)  # warm dark brown outlines
YELLOW = (255, 200, 46, 255)
YELLOW_LIGHT = (255, 224, 120, 255)
NAS = (49, 56, 70, 255)
NAS_TOP = (74, 84, 103, 255)
BAY = (30, 35, 45, 255)
BAY_LINE = (88, 99, 120, 255)
WING = (214, 236, 255, 255)
SIGNAL = (37, 99, 235, 255)


def ellipse(draw, cx, cy, rx, ry, **kw):
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), **kw)


def rotated_ellipse(cx, cy, rx, ry, angle, fill, outline, width):
    """An ellipse rotated by `angle` degrees, on its own full-size layer."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pad = width + 4
    tile = Image.new("RGBA", (int(2 * rx + 2 * pad), int(2 * ry + 2 * pad)), (0, 0, 0, 0))
    ImageDraw.Draw(tile).ellipse((pad, pad, pad + 2 * rx, pad + 2 * ry), fill=fill, outline=outline, width=width)
    tile = tile.rotate(angle, resample=Image.BICUBIC, expand=True)
    layer.alpha_composite(tile, (int(cx - tile.width / 2), int(cy - tile.height / 2)))
    return layer


def curve(draw, points, width, fill):
    """A smooth line through three points (a quadratic Bézier), with round ends."""
    (x0, y0), (x1, y1), (x2, y2) = points
    pts = []
    for i in range(41):
        t = i / 40
        pts.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2))
    draw.line(pts, fill=fill, width=width, joint="curve")
    for x, y in (pts[0], pts[-1]):
        ellipse(draw, x, y, width / 2, width / 2, fill=fill)


def draw_icon() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Soft shadow under the NAS.
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ellipse(ImageDraw.Draw(shadow), 512, 968, 330, 34, fill=(0, 0, 0, 60))
    img.alpha_composite(shadow)
    d = ImageDraw.Draw(img)

    # The NAS: a two-bay box seen from the front, with a lighter top edge and status lights.
    d.rounded_rectangle((210, 530, 814, 960), radius=64, fill=NAS, outline=INK, width=16)
    d.rounded_rectangle((226, 546, 798, 604), radius=40, fill=NAS_TOP)
    for x0 in (352, 572):
        d.rounded_rectangle((x0, 630, x0 + 190, 915), radius=22, fill=BAY, outline=BAY_LINE, width=6)
        for y in range(675, 900, 34):
            d.line((x0 + 36, y, x0 + 154, y), fill=BAY_LINE, width=6)
        ellipse(d, x0 + 95, 652, 9, 9, fill=(120, 200, 255, 255))
    for y, colour in ((660, (72, 214, 120, 255)), (720, (72, 214, 120, 255)), (780, (80, 160, 255, 255))):
        ellipse(d, 282, y, 15, 15, fill=colour)

    # Zigbee waves.
    for r in (70, 120, 170):
        d.arc((800 - r, 190 - r, 800 + r, 190 + r), start=-70, end=10, fill=SIGNAL, width=18)

    # Wings, behind the body.
    img.alpha_composite(rotated_ellipse(560, 245, 88, 130, 28, WING, INK, 14))
    img.alpha_composite(rotated_ellipse(690, 270, 78, 112, -30, WING, INK, 14))
    d = ImageDraw.Draw(img)

    # Body, with stripes clipped to its oval and a little stinger.
    d.polygon(((760, 380), (835, 405), (758, 430)), fill=INK)
    body_box = (380, 249, 770, 545)
    d.ellipse(body_box, fill=YELLOW)
    stripes = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripes)
    for x in (545, 650):
        sd.rectangle((x, 200, x + 52, 600), fill=INK)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse(body_box, fill=255)
    stripes.putalpha(ImageChops.multiply(stripes.getchannel("A"), mask))
    img.alpha_composite(stripes)
    d = ImageDraw.Draw(img)
    d.ellipse(body_box, outline=INK, width=18)

    # Little legs dangling over the front edge of the NAS.
    for x0, x1 in ((500, 492), (600, 604), (690, 700)):
        d.line((x0, 520, x1, 585), fill=INK, width=16)
        ellipse(d, x1 + 6, 588, 18, 12, fill=INK)

    # Antennae.
    curve(d, ((330, 230), (300, 150), (250, 120)), 14, INK)
    curve(d, ((420, 225), (440, 140), (500, 110)), 14, INK)
    ellipse(d, 248, 116, 26, 26, fill=YELLOW, outline=INK, width=12)
    ellipse(d, 504, 106, 26, 26, fill=YELLOW, outline=INK, width=12)

    # One arm waving hello (behind the head).
    curve(d, ((240, 400), (175, 380), (160, 315)), 16, INK)
    ellipse(d, 158, 300, 24, 24, fill=YELLOW_LIGHT, outline=INK, width=10)

    # Head.
    ellipse(d, 375, 345, 160, 150, fill=YELLOW, outline=INK, width=18)

    # Eyes looking at you, with sparkles.
    for ex in (320, 432):
        ellipse(d, ex, 335, 44, 54, fill=(255, 255, 255, 255), outline=INK, width=10)
        ellipse(d, ex + 4, 348, 27, 31, fill=INK)
        ellipse(d, ex + 14, 334, 10, 10, fill=(255, 255, 255, 255))

    # Rosy cheeks and a big smile.
    cheeks = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cheeks)
    ellipse(cd, 262, 420, 32, 20, fill=(255, 120, 120, 150))
    ellipse(cd, 490, 420, 32, 20, fill=(255, 120, 120, 150))
    img.alpha_composite(cheeks)
    d = ImageDraw.Draw(img)
    d.chord((318, 365, 440, 470), start=10, end=170, fill=(150, 50, 40, 255), outline=INK, width=12)
    ellipse(d, 379, 452, 22, 9, fill=(255, 130, 130, 255))
    return img


def scaled(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def main(argv: list[str]) -> None:
    icon = draw_icon()
    if argv[:1] == ["--preview"]:
        scaled(icon, 512).save(argv[1])
        return
    root = Path(argv[0])
    (root / "ui" / "images").mkdir(parents=True, exist_ok=True)
    scaled(icon, 64).save(root / "PACKAGE_ICON.PNG")
    scaled(icon, 256).save(root / "PACKAGE_ICON_256.PNG")
    for size in (16, 24, 32, 48, 64, 72, 256):
        scaled(icon, size).save(root / "ui" / "images" / f"icon_{size}.png")


if __name__ == "__main__":
    main(sys.argv[1:])
