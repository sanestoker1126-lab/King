#!/usr/bin/env python3
"""Quita de las hojas de TODOS los personajes las líneas sueltas pintadas: cuadrícula y "sombra de piso" en forma de raya.

Uso, desde la raíz del proyecto (legend-of-presos/):
    python3 -I tools/limpiar_lineas_atlas.py            # limpia y escribe
    python3 -I tools/limpiar_lineas_atlas.py --check    # solo verifica (sale con 1 si algo está desactualizado)

Regla (prudente): se borra un tramo recto de >= LINEA px, delgado (<= 2 px de grueso), oscuro o gris (< 170 en los tres
canales), SOLO si está SUELTO: en una franja de 2 px a su alrededor no hay nada opaco que no sea otra línea. Así:
  - la raya de "sombra de piso" bajo los pies en un SALTO (queda flotando: el juego ya dibuja su propia sombra) se va;
  - la que va pegada a los zapatos en una pose de pie se queda;
  - el dibujo del personaje no se toca (sus bordes rectos siempre van pegados al cuerpo).
Cachorro (personaje_08) tiene su propio limpiador (sombra azul + cuadrícula): tools/limpiar_atlas_cachorro.py.
El original de cada hoja que cambia se archiva una vez en sources/atlas_originales_2026-11-16/<id>/ y el script siempre
parte de él (idempotente). Hojas con rectángulos sueltos (coordsFile) no se tocan.
"""
import io
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _png_formato import guardar  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ARCH = os.path.join(ROOT, "sources", "atlas_originales_2026-11-16")
LINEA = 26
CHECK = "--check" in sys.argv
SKIP = {"personaje_08"}
GENERADOS = {"el_paisa_sistem", "personaje_complementario"}   # sus hojas salen de tools/integrar_entregas_20261106.py y tools/build_personaje_complementario.py


def line_mask(a):
    R, G, B, A = [a[..., i].astype(np.int16) for i in range(4)]
    M = (A > 40) & (np.maximum(np.maximum(R, G), B) < 170)
    hit = np.zeros_like(M)
    for horiz in (True, False):
        X = M if horiz else M.T
        Hh = hit if horiz else hit.T
        H, W = X.shape
        for y in range(H):
            row = X[y]
            if not row.any():
                continue
            x = 0
            while x < W:
                if not row[x]:
                    x += 1
                    continue
                x0 = x
                while x < W and row[x]:
                    x += 1
                if x - x0 >= LINEA:
                    up = X[y - 3, x0:x].mean() if y >= 3 else 0
                    dn = X[y + 3, x0:x].mean() if y + 3 < H else 0
                    if up < 0.35 and dn < 0.35:
                        for yy in range(max(0, y - 1), min(H, y + 2)):
                            Hh[yy, x0:x] |= X[yy, x0:x]
    return hit


def loose(a, hit):
    """de los píxeles de línea, los que forman tramos SUELTOS (nada opaco ajeno en 2 px alrededor del tramo)"""
    op = a[..., 3] > 40
    other = op & ~hit
    h, w = hit.shape
    out = np.zeros_like(hit)
    seen = np.zeros_like(hit)
    ys, xs = np.nonzero(hit)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        # componente de la línea (8-vecinos)
        st = [(y0, x0)]; seen[y0, x0] = True; comp = []
        while st:
            y, x = st.pop(); comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and hit[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; st.append((ny, nx))
        cy = np.array([p[0] for p in comp]); cx = np.array([p[1] for p in comp])
        y1, y2, x1, x2 = max(0, cy.min() - 2), min(h, cy.max() + 3), max(0, cx.min() - 2), min(w, cx.max() + 3)
        if not other[y1:y2, x1:x2].any():
            out[cy, cx] = True
            # la raya de sombra es una mancha DIFUMINADA: se extiende el borrado a sus puntas semitransparentes, solo en la
            # misma franja (±3 px de alto) y solo sobre píxeles grises/oscuros
            yb1, yb2 = max(0, cy.min() - 3), min(h, cy.max() + 4)
            band = (a[yb1:yb2, :, 3] > 0) & (a[yb1:yb2, :, :3].max(2) < 170)
            g = np.zeros_like(band); g[cy - yb1, cx] = True
            for _ in range(40):
                p = np.pad(g, 1)
                ng = (g | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]) & band
                if (ng == g).all():
                    break
                g = ng
            gy, gx = np.nonzero(g)
            out[gy + yb1, gx] = True
    return out


def main():
    roster = json.load(open(os.path.join(ROOT, "data/roster.json"), encoding="utf-8"))["characters"]
    stale, total = [], 0
    for c in roster:
        cid = c["id"]
        if cid in SKIP:
            continue
        cp = os.path.join(ROOT, "assets/combat", cid, cid + ".char.json")
        if not os.path.exists(cp):
            continue
        d = json.load(open(cp, encoding="utf-8"))
        used = {cl.get("atlas", "base") for cl in d["clips"].values()}
        for key, at in d["atlases"].items():
            if key not in used or at.get("coordsFile") or at.get("sha256") or cid in GENERADOS:
                continue   # hojas que escribe otro generador (llevan sha256 o son de un personaje generado): se arreglan en su script
            dst = os.path.join(ROOT, "assets/combat", cid, at["file"])
            orig = os.path.join(ARCH, cid, at["file"])
            src = orig if os.path.exists(orig) else dst
            if not os.path.exists(src):
                continue
            a = np.array(Image.open(src).convert("RGBA"))
            rm = loose(a, line_mask(a))
            n = int(rm.sum())
            if not n:
                continue
            total += n
            b = a.copy(); b[rm] = 0
            img = Image.fromarray(b, "RGBA")
            if not os.path.exists(orig):                       # primera vez: se archiva el original antes de nada
                if CHECK:
                    stale.append(f"{cid}/{at['file']} (sin original archivado)"); continue
                os.makedirs(os.path.dirname(orig), exist_ok=True); shutil.copy2(dst, orig)
            data = guardar(orig, img)                           # mismo formato que el original (paleta o RGBA)
            if open(dst, "rb").read() == data:
                continue
            stale.append(f"{cid}/{at['file']} ({n} px)")
            if CHECK:
                continue
            open(dst, "wb").write(data)
            print(f"{cid}/{at['file']}: {n} px de líneas sueltas borrados")
    if CHECK:
        print("DESACTUALIZADO: " + "; ".join(stale) if stale else "al día")
        sys.exit(1 if stale else 0)
    print(f"total: {total} px; hojas cambiadas: {len(stale)}")


if __name__ == "__main__":
    main()
