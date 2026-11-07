#!/usr/bin/env python3
"""Generates the HotsOff logo images (title, icon, large icon).

Wordmark "hotsoff" where the first "o" of "off" is a power symbol, with a
rainbow arc sweeping over the word and landing in a glow on that power "o".

Usage: python3 development/make_logo.py   (needs Pillow and DejaVu Sans Bold)
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SS = 4  # supersampling factor

WHITE = (255, 255, 255, 255)
ICON_BG = (8, 12, 38, 255)
# Rainbow stops along the arc: violet -> blue -> cyan -> green -> yellow -> warm white
RAINBOW = [
    (0.00, (138, 43, 226)),
    (0.22, (40, 110, 255)),
    (0.45, (0, 200, 255)),
    (0.65, (60, 230, 140)),
    (0.82, (255, 220, 60)),
    (1.00, (255, 250, 235)),
]


def lerp(a, b, t):
    return a + (b - a) * t


def rainbow(t):
    for (t0, c0), (t1, c1) in zip(RAINBOW, RAINBOW[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return tuple(int(lerp(c0[i], c1[i], k)) for i in range(3))
    return RAINBOW[-1][1]


def bezier(p0, c, p1, t):
    x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p1[0]
    y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p1[1]
    return x, y


def power_symbol(d, cx, cy, r, w, col):
    d.arc([cx - r, cy - r, cx + r, cy + r], start=-58, end=238, fill=col, width=w)
    d.line([cx, cy - r - w * 0.2, cx, cy - r * 0.05], fill=col, width=w)
    for x, y in ((cx, cy - r - w * 0.2), (cx, cy - r * 0.05)):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)


def wordmark(height):
    """Returns an RGBA image of the full logo, height = font size in px."""
    h = height * SS
    font = ImageFont.truetype(FONT, h)
    left, right = "hots", "ff"
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    w_left = probe.textlength(left, font=font)
    w_right = probe.textlength(right, font=font)
    ascent, descent = font.getmetrics()

    x_height = h * 0.55
    r = int(x_height * 0.5)
    gap = int(h * 0.05)
    stroke = max(2, int(h * 0.115))

    top_pad = int(h * 0.85)  # room for the arc above the letters
    side = int(h * 0.25)
    width = int(side + w_left + gap + 2 * r + gap + w_right + side)
    total_h = top_pad + ascent + descent + int(h * 0.1)
    im = Image.new("RGBA", (width, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    base = top_pad + ascent
    x0 = side
    d.text((x0, top_pad), left, font=font, fill=WHITE)
    cx = x0 + w_left + gap + r
    cy = int(base - x_height / 2)
    power_symbol(d, cx, cy, r, stroke, WHITE)
    d.text((x0 + w_left + gap + 2 * r + gap, top_pad), right, font=font, fill=WHITE)

    # Arc: starts low on the left, sweeps over the word, lands on top of the power "o".
    p0 = (x0 - h * 0.12, base - x_height * 0.15)
    p1 = (cx, cy - r - stroke * 1.4)
    c = (lerp(p0[0], p1[0], 0.42), top_pad - h * 0.95)

    arc = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ad = ImageDraw.Draw(arc)
    steps = 400
    prev = bezier(p0, c, p1, 0)
    for i in range(1, steps + 1):
        t = i / steps
        pt = bezier(p0, c, p1, t)
        # thin at the start, fuller towards the end, slight taper right at the tip
        wdt = lerp(h * 0.012, h * 0.06, math.sin(min(t, 0.93) / 0.93 * math.pi / 2))
        col = rainbow(t) + (int(lerp(90, 255, min(1, t * 1.6))),)
        ad.line([prev, pt], fill=col, width=max(1, int(wdt)))
        ad.ellipse([pt[0] - wdt / 2, pt[1] - wdt / 2, pt[0] + wdt / 2, pt[1] + wdt / 2], fill=col)
        prev = pt

    # Soft glow under the arc and a bright flare where it meets the "o".
    glow = arc.filter(ImageFilter.GaussianBlur(h * 0.05))
    flare = Image.new("RGBA", im.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(flare)
    fr = h * 0.16
    fd.ellipse([p1[0] - fr, p1[1] - fr, p1[0] + fr, p1[1] + fr], fill=(255, 255, 240, 200))
    flare = flare.filter(ImageFilter.GaussianBlur(h * 0.09))
    core = Image.new("RGBA", im.size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(core)
    cr = h * 0.045
    cd.ellipse([p1[0] - cr, p1[1] - cr, p1[0] + cr, p1[1] + cr], fill=(255, 255, 255, 255))
    core = core.filter(ImageFilter.GaussianBlur(h * 0.012))

    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    for layer in (glow, glow, arc, im, flare, core):
        out.alpha_composite(layer)
    out = out.crop(out.getbbox())
    return out.resize((out.width // SS, out.height // SS), Image.LANCZOS)


def fit(img, w, h, bg, fill=0.86):
    canvas = Image.new("RGBA", (w, h), bg)
    s = min(w * fill / img.width, h * fill / img.height)
    img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
    canvas.alpha_composite(img, ((w - img.width) // 2, (h - img.height) // 2))
    return canvas


def main():
    logo = wordmark(160)
    fit(logo, 260, 130, (0, 0, 0, 0), 0.96).save(os.path.join(ROOT, "assets", "hotsoff_title.png"))
    fit(logo, 80, 80, ICON_BG, 0.9).save(os.path.join(ROOT, "hotsoff.png"))
    fit(logo, 130, 130, ICON_BG, 0.9).save(os.path.join(ROOT, "hotsoffLarge.png"))
    logo.save(os.path.join(ROOT, "development", "logo_full.png"))
    print("logo written")


if __name__ == "__main__":
    main()
