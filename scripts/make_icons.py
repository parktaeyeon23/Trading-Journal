"""
Renders the PNG app icons from the design (green tile, white α) with headless
Chromium. Run once after changing the icon; the PNGs are committed in /public.

  python3 scripts/make_icons.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "public"
GREEN = "#0B7D3E"

def tile(size: int, glyph_scale: float, radius: float) -> str:
    return f"""<html><body style="margin:0;background:transparent">
<div style="width:{size}px;height:{size}px;border-radius:{radius*size}px;background:{GREEN};display:flex;align-items:center;justify-content:center">
<span style="color:#fff;font:700 {glyph_scale*size}px/1 Georgia,'DejaVu Serif',serif;transform:translateY(-{0.045*size}px)">α</span>
</div></body></html>"""

ICONS = [
    # name, size, glyph, corner radius (0 = square: iOS and maskable crop it themselves)
    ("apple-touch-icon.png", 180, 0.6, 0),
    ("icon-192.png", 192, 0.6, 0.22),
    ("icon-512.png", 512, 0.6, 0.22),
    # Maskable: full-bleed square, glyph inside the central 80 % safe zone.
    ("icon-maskable-512.png", 512, 0.46, 0),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, glyph, radius in ICONS:
        pg = b.new_page(viewport={"width": size, "height": size})
        pg.set_content(tile(size, glyph, radius))
        pg.screenshot(path=str(OUT / name), omit_background=True)
        pg.close()
        print("wrote", name)
    b.close()
