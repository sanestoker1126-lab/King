#!/usr/bin/env python3
"""Genera el Modo Vestía de Sofi desde la hoja fuente. Idempotente.
Uso (desde la raíz):  python3 -I tools/build_vestia_sofi.py

Lee sources/entregas_2026-11-07/sofi_modo_vestia_36f.png (36 frames 6x6 sobre damero),
recorta cada frame (quita el damero oscuro-neutro, conserva al personaje + su FX morado),
normaliza a la escala de Sofi (figura cara-pies ≈ la del idle base) y escribe
assets/combat/sofi/sofi_vestia.png (atlas 6x6, celda 160). NO toca el char.json (eso lo hizo
build_vestia_char una vez; este script solo regenera el atlas). Revisa el resultado a ojo:
el recorte de arte sobre damero puede dejar halos mínimos.
"""
import os, sys
from PIL import Image
import numpy as np
from collections import deque

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "sources/entregas_2026-11-07/sofi_modo_vestia_36f.png")
OUT = os.path.join(ROOT, "assets/combat/sofi/sofi_vestia.png")
FACTOR, CELL = 0.61, 160          # 0.61 = figura base 111px / figura vestía ~182px; celda con margen para el FX

def crop_cell(cell):
    aa = np.array(cell).astype(int); R, G, B = aa[:, :, 0], aa[:, :, 1], aa[:, :, 2]
    sat = np.maximum(np.maximum(R, G), B) - np.minimum(np.minimum(R, G), B); lum = (R + G + B) / 3
    isbg = (lum >= 36) & (lum < 74) & (sat < 22)      # damero: gris-morado medio, baja saturación (NO el traje negro lum<36)
    hh, ww = isbg.shape; vis = np.zeros((hh, ww), bool); dq = deque()
    for x in range(ww):
        for y in (0, hh - 1):
            if isbg[y, x]: vis[y, x] = True; dq.append((y, x))
    for y in range(hh):
        for x in (0, ww - 1):
            if isbg[y, x]: vis[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            ny, nx = y+dy, x+dx
            if 0<=ny<hh and 0<=nx<ww and isbg[ny,nx] and not vis[ny,nx]: vis[ny,nx]=True; dq.append((ny,nx))
    opaque = (~vis) & (~isbg)
    lbl = np.zeros((hh, ww), int); nxt = 0; sizes = [0]
    for sy in range(hh):
        for sx in range(ww):
            if opaque[sy, sx] and lbl[sy, sx] == 0:
                nxt += 1; st = [(sy, sx)]; lbl[sy, sx] = nxt; cnt = 0
                while st:
                    y, x = st.pop(); cnt += 1
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = y+dy, x+dx
                        if 0<=ny<hh and 0<=nx<ww and opaque[ny,nx] and lbl[ny,nx]==0: lbl[ny,nx]=nxt; st.append((ny,nx))
                sizes.append(cnt)
    thr = 0.004 * hh * ww
    keep = np.isin(lbl, [i for i in range(1, nxt + 1) if sizes[i] >= thr])
    alpha = np.where(keep, 255, 0).astype("uint8")
    yy, xx = np.mgrid[0:hh, 0:ww]
    txt = (yy < 34) & (xx < 44) & (sat < 20) & (lum > 55) & (lum < 225)   # borra el número horneado de la esquina
    alpha = np.where(txt, 0, alpha).astype("uint8")
    return Image.fromarray(np.dstack([np.array(cell), alpha]), "RGBA")

def main():
    sheet = Image.open(SRC).convert("RGB"); W, H = sheet.size; cw, ch = W // 6, H // 6
    atlas = Image.new("RGBA", (6 * CELL, 6 * CELL), (0, 0, 0, 0)); FOOT = CELL - 8
    for i in range(36):
        r, c = i // 6, i % 6
        im = crop_cell(sheet.crop((c*cw, r*ch, c*cw+cw, r*ch+ch)))
        nw, nh = round(im.width*FACTOR), round(im.height*FACTOR)
        s = im.resize((nw, nh), Image.LANCZOS)
        bb = s.getchannel("A").getbbox()
        cv = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cv.alpha_composite(s, ((CELL-nw)//2, FOOT - (bb[3] if bb else nh)))
        atlas.paste(cv, (c*CELL, r*CELL))
    data_new = atlas.tobytes()
    old = Image.open(OUT).tobytes() if os.path.exists(OUT) else None
    if old != data_new:
        atlas.save(OUT); print("escrito", os.path.relpath(OUT, ROOT))
    else:
        print("sin cambios")

if __name__ == "__main__":
    main()
