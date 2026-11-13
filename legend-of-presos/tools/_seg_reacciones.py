"""Segmentación de las hojas de reacciones del prototipo (componentes conectados -> filas -> figuras). Módulo compartido."""
import numpy as np
from PIL import Image

def components(mask):
    h, w = mask.shape; lbl = np.zeros((h, w), np.int32); boxes = []
    for sy, sx in zip(*np.nonzero(mask)):
        if lbl[sy, sx]: continue
        n = len(boxes) + 1; st = [(sy, sx)]; lbl[sy, sx] = n; x0 = x1 = sx; y0 = y1 = sy; c = 0
        while st:
            y, x = st.pop(); c += 1
            if x < x0: x0 = x
            if x > x1: x1 = x
            if y < y0: y0 = y
            if y > y1: y1 = y
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lbl[ny, nx]: lbl[ny, nx] = n; st.append((ny, nx))
        boxes.append([x0, y0, x1 + 1, y1 + 1, c])
    return lbl, boxes

def segment(path, min_area=900, join=5):
    """devuelve filas: lista de listas de cajas (x0,y0,x1,y1) ordenadas izq->der. Une trozos sueltos cercanos (estrellas, polvo)."""
    im = Image.open(path).convert("RGBA"); a = np.array(im)[:, :, 3] > 40
    # dilatación ligera para que estrellas/polvo se unan a su figura
    m = a.copy()
    for _ in range(join):
        p = np.pad(m, 1); m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    lbl, boxes = components(m)
    out = []
    for i, (x0, y0, x1, y1, c) in enumerate(boxes):
        if c < min_area: continue
        sub = a[y0:y1, x0:x1] & (lbl[y0:y1, x0:x1] == i + 1)
        ys, xs = np.nonzero(sub)
        if len(ys) < min_area * 0.5: continue
        bx0, by0, bx1, by1 = x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1
        # figuras que la dilatación pegó: se separan por huecos de columna (>=2 px sin alfa) en el alfa real
        cols = sub[:, xs.min():xs.max() + 1].any(0); parts = []; s0 = None; gap = 0
        for x, v in enumerate(list(cols) + [False, False]):
            if v:
                if s0 is None: s0 = x
                gap = 0
            elif s0 is not None:
                gap += 1
                if gap >= 2: parts.append((s0, x - gap + 1)); s0 = None
        for (c0, c1) in parts:
            ps = sub[:, xs.min() + c0:xs.min() + c1]; pys, pxs = np.nonzero(ps)
            if len(pys) < min_area * 0.5: continue           # polvo / trozos sueltos
            out.append((bx0 + c0, y0 + pys.min(), bx0 + c1, y0 + pys.max() + 1, i + 1))
    # filas: agrupar por la BASE (pies) de la caja
    out.sort(key=lambda b: b[3]); rows = []
    for b in out:
        if rows and abs(b[3] - np.median([q[3] for q in rows[-1]])) < 60: rows[-1].append(b)
        else: rows.append([b])
    for r in rows: r.sort(key=lambda b: b[0])
    return im, lbl, a, rows
