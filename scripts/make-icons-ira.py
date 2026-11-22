#!/usr/bin/env python3
"""v2d-53: icona e splash IRA — scritta rossa «IRA» (Anton) su nero puntinato di rosso.
Genera SVG deterministici (testo già convertito in tracciati, niente font sul telefono).
I PNG si ricavano dagli SVG con scripts/render-icons-ira.js (Chromium di Playwright)."""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

FONT = os.environ.get('IRA_FONT', '/usr/share/fonts/truetype/sand-box/google/Anton/Anton-Regular.ttf')
RED, RED_DARK, BG = '#E50914', '#7A0008', '#000000'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'public'

font = TTFont(FONT)
gs, cmap = font.getGlyphSet(), font.getBestCmap()
upm = font['head'].unitsPerEm

def word_paths(text, track=0.04):
    x, parts = 0.0, []
    for i, ch in enumerate(text):
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs); gs[g].draw(pen)
        bp = BoundsPen(gs); gs[g].draw(bp)
        parts.append((x, pen.getCommands(), bp.bounds))
        x += gs[g].width + (track * upm if i < len(text) - 1 else 0)
    xmin = min(p[0] + p[2][0] for p in parts); xmax = max(p[0] + p[2][2] for p in parts)
    ymin = min(p[2][1] for p in parts); ymax = max(p[2][3] for p in parts)
    return parts, (xmin, ymin, xmax, ymax)

PARTS, (BX0, BY0, BX1, BY1) = word_paths('IRA')

def text_group(cx, cy, height):
    s = height / (BY1 - BY0)
    w = (BX1 - BX0) * s
    tx, ty = cx - w / 2 - BX0 * s, cy + height / 2 + BY0 * s
    paths = ''.join(f'<path d="{d}" transform="translate({tx + x * s:.2f},{ty:.2f}) scale({s:.5f},{-s:.5f})"/>' for x, d, _ in PARTS)
    return paths, w

def dots(W, H, cx, cy, tw, th, pitch, fall=1.3):
    """Puntinato a mezzatinta: punti piccoli vicino alla scritta, più grandi verso i bordi; righe sfalsate."""
    out = []
    rows = int(H / (pitch * 0.866)) + 2; cols = int(W / pitch) + 2
    rx, ry = tw * 0.62, th * 0.95
    for r in range(rows):
        y = r * pitch * 0.866
        off = (pitch / 2) if r % 2 else 0
        for c in range(cols):
            x = c * pitch + off
            if x > W + pitch or y > H + pitch: continue
            d = math.hypot((x - cx) / rx, (y - cy) / ry)
            if d < 0.92: continue  # area pulita attorno alla scritta
            k = min(1.0, max(0.0, d - 0.92) / fall)
            rad = pitch * (0.10 + 0.20 * k)
            op = 0.40 + 0.45 * k
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rad:.2f}" fill-opacity="{op:.2f}"/>')
    return ''.join(out)

def svg(W, H, text_h_ratio, pitch_ratio, glow=True, fall=1.3):
    cx, cy = W / 2, H / 2
    th = min(W, H) * text_h_ratio
    paths, tw = text_group(cx, cy, th)
    pitch = min(W, H) * pitch_ratio
    g = (f'<filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="{th*0.05:.1f}"/></filter>' if glow else '')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<defs><radialGradient id="v" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#1a0002"/><stop offset="1" stop-color="{BG}"/></radialGradient>{g}</defs>'
            f'<rect width="{W}" height="{H}" fill="{BG}"/><rect width="{W}" height="{H}" fill="url(#v)"/>'
            f'<g fill="{RED}">{dots(W, H, cx, cy, tw, th, pitch, fall)}</g>'
            + (f'<g fill="{RED_DARK}" filter="url(#g)" opacity="0.9">{paths}</g>' if glow else '') +
            f'<g fill="{RED}">{paths}</g></svg>')

def write(rel, s):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(s); print(p, len(s))

write('icons/favicon.svg', svg(512, 512, 0.46, 0.085, glow=False))
write('icons/ira-icon.svg', svg(1024, 1024, 0.46, 0.07))
write('icons/ira-icon-maskable.svg', svg(1024, 1024, 0.34, 0.07))   # dentro la zona sicura (80%)
write('icons/ira-favicon-small.svg', svg(64, 64, 0.62, 0.22, glow=False))  # 16-64 px: scritta più grande, pochi punti
SPLASH = {'iphone-16-pro-max': (1320, 2868), 'iphone-16-pro': (1206, 2622), 'iphone-14-pro-max': (1290, 2796), 'iphone-14-pro': (1179, 2556),
          'iphone-plus': (1284, 2778), 'iphone-14': (1170, 2532), 'iphone-xs-max': (1242, 2688), 'iphone-xr': (828, 1792), 'iphone-x': (1125, 2436), 'iphone-8': (750, 1334)}
for n, (w, h) in SPLASH.items():
    write(f'splash-src/{n}.svg', svg(w, h, 0.22, 0.07, fall=7.0))
