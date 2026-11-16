#!/usr/bin/env python3
"""Auditoría de hojas (atlas) de TODOS los personajes: líneas de cuadrícula y siluetas planas pintadas.
Uso: python3 -I tools/qa_20261106/auditar_atlas.py [--solo-usadas]
 - lineas  = tramos rectos >= 26 px y delgados (<= 2 px), opacos, de tono oscuro/gris o azulado (lo que se ve como "grill").
 - silueta = píxeles de un mismo color plano (cuantizado a 16 niveles) que forman zonas SÓLIDAS (apertura de 5 px) y ocupan
   más del 8 % de lo opaco de la hoja: una sombra o un fondo pintado. Solo mide; no cambia nada."""
import glob, json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def thin_runs(a, L=26):
    R, G, B, A = [a[..., i].astype(np.int16) for i in range(4)]
    M = (A > 40) & (np.maximum(np.maximum(R, G), B) < 170)
    n = 0
    for horiz in (True, False):
        X = M if horiz else M.T
        H, W = X.shape
        for y in range(H):
            row = X[y]; x = 0
            while x < W:
                if not row[x]: x += 1; continue
                x0 = x
                while x < W and row[x]: x += 1
                if x - x0 >= L:
                    up = X[y - 3, x0:x].mean() if y >= 3 else 0
                    dn = X[y + 3, x0:x].mean() if y + 3 < H else 0
                    if up < 0.35 and dn < 0.35: n += 1
    return n

def erode(m, r):
    h, w = m.shape; p = np.pad(m, r); out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1): out &= p[r + dy:r + dy + h, r + dx:r + dx + w]
    return out

def flat(a):
    A = a[..., 3] > 200
    q = (a[..., :3] // 16).astype(np.int32)
    key = (q[..., 0] << 8) | (q[..., 1] << 4) | q[..., 2]
    op = int(A.sum())
    if not op: return 0.0, None
    vals, cnt = np.unique(key[A], return_counts=True)
    best = (0.0, None)
    for v in vals[np.argsort(-cnt)[:3]]:
        m = A & (key == v)
        core = int(erode(m, 2).sum())
        frac = core / op
        if frac > best[0]: best = (frac, tuple(int(c) * 16 + 8 for c in ((v >> 8) & 15, (v >> 4) & 15, v & 15)))
    return best

roster = json.load(open(os.path.join(ROOT, "data/roster.json"), encoding="utf-8"))["characters"]
solo = "--solo-usadas" in sys.argv
rows = []
for c in roster:
    p = os.path.join(ROOT, "assets/combat", c["id"], c["id"] + ".char.json")
    if not os.path.exists(p): continue
    d = json.load(open(p, encoding="utf-8"))
    used = {cl.get("atlas", "base") for cl in d["clips"].values()}
    for k, at in d["atlases"].items():
        if solo and k not in used: continue
        f = os.path.join(ROOT, "assets/combat", c["id"], at["file"])
        if not os.path.exists(f): continue
        a = np.array(Image.open(f).convert("RGBA"))
        ln = thin_runs(a); fr, col = flat(a)
        rows.append((c["id"], k, ln, fr, col))
bad = [r for r in rows if r[2] >= 10 or r[3] >= 0.08]
for cid, k, ln, fr, col in sorted(bad, key=lambda r: -(r[2] + r[3] * 1000)):
    print(f"{cid:26s} {k:18s} líneas {ln:4d} · color plano sólido {fr*100:5.1f} % {col or ''}")
print(f"== {len(rows)} hojas revisadas · con problemas: {len(bad)} ==")
