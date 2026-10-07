# Draws the Family Reader app icon: a gold open book with text lines on a dark background.
# Usage: python3 scripts/make_icons.py public   (requires Pillow)
import sys
from PIL import Image, ImageDraw

BG = (16, 21, 25)
GOLD = (210, 171, 112)
GOLD_SOFT = (210, 171, 112, 110)
S = 2048  # supersampled canvas

def icon(scale):
    """scale: fraction of the canvas the book occupies (full icon vs maskable safe zone)."""
    img = Image.new('RGBA', (S, S), BG + (255,))
    d = ImageDraw.Draw(img)
    # Book outline in a 64-unit design box (same shape as favicon.svg), centred.
    unit = S * scale / 40.0
    ox = S / 2 - 32 * unit
    oy = S / 2 - 34.5 * unit
    P = lambda x, y: (ox + x * unit, oy + y * unit)
    width = int(3.2 * unit)
    outline = [P(13, 16), P(28, 16), P(32, 20), P(36, 16), P(51, 16), P(51, 49), P(36, 49), P(32, 53), P(28, 49), P(13, 49), P(13, 16)]
    d.line(outline, fill=GOLD, width=width, joint='curve')
    r = width / 2
    for x, y in outline:
        d.ellipse((x - r, y - r, x + r, y + r), fill=GOLD)
    d.line([P(32, 20), P(32, 52)], fill=GOLD, width=width)
    # Text lines on both pages.
    line_w = int(1.9 * unit)
    overlay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i, y in enumerate([25, 31, 37, 43]):
        left_end = 25 if i % 2 else 27
        od.line([P(18.5, y), P(left_end, y)], fill=GOLD_SOFT, width=line_w)
        od.line([P(37, y), P(45.5 - (i == 3) * 4, y)], fill=GOLD_SOFT, width=line_w)
    img = Image.alpha_composite(img, overlay)
    return img.convert('RGB')

out = sys.argv[1]
full = icon(0.70)
safe = icon(0.58)
for name, image, size in [('apple-touch-icon.png', full, 180), ('icon-192.png', full, 192), ('icon-512.png', full, 512), ('icon-maskable-512.png', safe, 512)]:
    image.resize((size, size), Image.LANCZOS).save(f'{out}/{name}', optimize=True)
full.resize((1024, 1024), Image.LANCZOS).save(f'{out}/preview-1024.png')
