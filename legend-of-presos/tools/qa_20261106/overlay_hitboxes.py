# Uso: python3 -I overlay_hitboxes.py <raiz_proyecto> <id> <salida.png>
import json, sys, os
from PIL import Image, ImageDraw
root, cid, out = sys.argv[1:4]
d = json.load(open(os.path.join(root, 'assets/combat', cid, cid + '.char.json')))
A = d['atlases']['base']; atlas = Image.open(os.path.join(root, 'assets/combat', cid, A['file'])).convert('RGBA')
anc = json.load(open(os.path.join(root, 'assets/combat', cid, A['anchorsFile'])))['anchors']
C = d['frameSize']['w']; cols = A['columns']; rs = d['renderScale']; Z = 3
tiles = []
for mn, mv in d['moves'].items():
    if 'hitbox' not in mv: continue
    clip = d['clips'][mv['clip']]
    loc = mv.get('activeIdx', [None, None])[1] if 'activeIdx' in mv else None
    locs = [loc] if loc is not None else mv.get('hitFrames', [])
    for lf in locs:
        gi = clip['frames'][lf]
        fr = atlas.crop(((gi % cols) * C, (gi // cols) * C, (gi % cols + 1) * C, (gi // cols + 1) * C)).resize((C * Z, C * Z), Image.NEAREST)
        t = Image.new('RGBA', (C * Z, C * Z + 16), (50, 50, 60, 255)); t.alpha_composite(fr, (0, 16))
        dr = ImageDraw.Draw(t)
        ax, ay = anc[gi]['x'] * C, anc[gi]['y'] * C
        hb = mv['hitbox']
        x0 = (ax + hb['x'] / rs) * Z; y0 = (ay + hb['y'] / rs) * Z + 16
        dr.rectangle((x0, y0, x0 + hb['w'] / rs * Z, y0 + hb['h'] / rs * Z), outline=(255, 40, 40, 255), width=2)
        # hurtbox estándar (data/config.json hurtbox 46x140)
        hx0 = (ax - 23 / rs) * Z; hy0 = (ay - 140 / rs) * Z + 16
        dr.rectangle((hx0, hy0, hx0 + 46 / rs * Z, (ay * Z) + 16), outline=(60, 200, 255, 255), width=1)
        dr.line((0, ay * Z + 16, C * Z, ay * Z + 16), fill=(255, 255, 0, 160))
        dr.text((3, 2), f'{mn}[{lf}]', fill=(255, 255, 255, 255))
        tiles.append(t)
n = len(tiles); cc = 6; rr = (n + cc - 1) // cc
W, H = tiles[0].size
sheet = Image.new('RGBA', (cc * W, rr * H), (30, 30, 36, 255))
for i, t in enumerate(tiles): sheet.alpha_composite(t, ((i % cc) * W, (i // cc) * H))
sheet.thumbnail((1800, 1800)); sheet.save(out); print(n, 'cuadros')
