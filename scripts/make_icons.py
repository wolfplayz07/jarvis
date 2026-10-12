"""Draw the arc-reactor app icon with PIL (no external assets)."""
import math
from PIL import Image, ImageDraw, ImageFilter
S = 1024
def icon():
    img = Image.new('RGB', (S, S), (4, 10, 18))
    glow = Image.new('RGB', (S, S), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    c = S / 2
    for r, w in [(400, 26), (330, 14), (250, 34), (150, 18)]:
        g.ellipse([c - r, c - r, c + r, c + r], outline=(0, 220, 255), width=w)
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    img = Image.blend(img, glow, 0.0)
    img.paste(glow, (0, 0), glow.convert('L'))
    d = ImageDraw.Draw(img)
    # outer ring
    d.ellipse([c - 400, c - 400, c + 400, c + 400], outline=(80, 230, 255), width=18)
    # segmented coil ring
    for k in range(10):
        a0 = k * 36 + 4
        d.arc([c - 330, c - 330, c + 330, c + 330], a0, a0 + 28, fill=(150, 240, 255), width=60)
    d.ellipse([c - 250, c - 250, c + 250, c + 250], outline=(0, 200, 255), width=12)
    # inner triangle
    pts = [(c + 190 * math.cos(math.radians(a)), c + 190 * math.sin(math.radians(a))) for a in (-90, 30, 150)]
    d.polygon(pts, outline=(170, 245, 255), width=14)
    # core
    core = Image.new('L', (S, S), 0)
    ImageDraw.Draw(core).ellipse([c - 120, c - 120, c + 120, c + 120], fill=255)
    core = core.filter(ImageFilter.GaussianBlur(30))
    img.paste(Image.new('RGB', (S, S), (210, 250, 255)), (0, 0), core)
    d.ellipse([c - 70, c - 70, c + 70, c + 70], fill=(240, 255, 255))
    return img
base = icon()
for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
    base.resize((size, size), Image.LANCZOS).save('icons/' + name, optimize=True)
print('icons done')
