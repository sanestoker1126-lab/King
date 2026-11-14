#!/usr/bin/env python3
"""Atlas de la TRANSFORMACIÓN del Modo Vestía de Sofi (clip modo_vestia). Idempotente.
Uso (desde legend-of-presos/):  python3 -I tools/build_vestia_sofi.py [--check]

Fuente: sources/entregas_2026-11-07/sofi_modo_vestia_36f.png (36 frames 6x6 pintados sobre una cuadrícula gris).
Salida: assets/combat/sofi/sofi_vestia.png (6x6, celda 180; mismo formato de siempre: el char.json no cambia).

HISTORIA (para no repetir errores; el usuario reportó dos veces que "se ve el grill"):
 v1 (2026-11-07/08) borraba los grises por color. Dejaba las LÍNEAS del borde de cada celda, restos del número, agujeros en
    el traje y las botas, el aura como mancha sólida con hoyos, y los cuernos del frame de abajo. Solo se revisó sobre fondo
    oscuro, donde no se nota. Causa de fondo: cortaba las celdas en 0,209,418... y las celdas reales empiezan en el px 8 y
    la rejilla ni siquiera es uniforme (filas de 186 a 230 px de alto). Ahora las líneas se DETECTAN.
 v2 (2026-11-14, descartado) intentó un mate por dos fondos con sofi_vestia_36f_transparente.png. No sirve: esa hoja NO es
    el arte sobre negro (sus colores son los de esta misma hoja y su alfa depende del brillo), así que la falda roja y el
    traje negro salían semitransparentes. Se midió: correlación de registro 0.96 en frames sin aura y 0.51-0.67 con aura.
 v3 (este): una sola hoja, con lo MEDIDO de ella. El fondo es casi uniforme (dos tonos de 42 y 47 de luminancia, tinte
    (43.5, 39.5, 48.5)): eso permite separar así:
      CUERPO (opaco, color original): lo más oscuro que el fondo (traje, botas, contornos) + todo lo brillante que NO es
        morado/magenta (piel, blanco, rojo, pelo, cuernos, piedras) + lo que quede ENCERRADO por eso (falda morada, brillo
        delante del cuerpo). Dentro del cuerpo la textura de la cuadrícula (±2.5 de luminancia) es invisible.
      AURA (translúcida): alfa = cuánto se aleja del gris del fondo hacia el blanco, y color despremultiplicado
        (el clásico "quitar el fondo conocido"): sobre cualquier escenario se ve como brillo, no como mancha.
      FUERA: celda recortada por dentro de sus líneas, número de la esquina borrado, y componentes sueltos que tocan el borde
        de la celda (trozos del frame vecino) eliminados.
Revisar SIEMPRE sobre fondo claro Y oscuro (qa/entrega_20261106/sofi_transformacion_fondo_*.jpg).
"""
import io, hashlib, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "sources/entregas_2026-11-07/sofi_modo_vestia_36f.png")
SHA = "06980c44b7427a0277991dd71037513ccd6d2f4acb1125c483930993e93a4aa4"
OUT = os.path.join(ROOT, "assets/combat/sofi/sofi_vestia.png")
FACTOR, CELL = 0.70, 180           # escala al atlas (coherente con el moveset Vestía dibujado a renderScale x1.15)
FOOT = CELL - 8
INSET = 2                                        # margen hacia dentro de cada línea de celda (las líneas se DETECTAN, ver grid_lines)
CK = np.array([43.5, 39.5, 48.5])                # tinte medio de la cuadrícula
DARK_LUM, GLOW_MIN = 33.0, 0.045                 # negro del traje/botas/contorno = cuerpo (con 27 las botas dejaban de cerrar)
                                                 # · alfa mínimo del aura (ruido del fondo ~0.015)


def grid_lines(a):
    """Líneas de celda REALES de la hoja: columnas/filas casi enteras de gris claro. La rejilla NO es uniforme
    (medido: verticales cada ~206 px; horizontales en 8, 213, 422, 609, 803, 1004, 1235). Devuelve (xs, ys) con (ini, fin)."""
    lum = a.mean(2); sat = a.max(2) - a.min(2); line = (lum > 62) & (lum < 140) & (sat < 28)
    def peaks(p):
        g = []
        for i in np.nonzero(p > 0.5)[0]:
            if g and i - g[-1][1] <= 2: g[-1][1] = int(i)
            else: g.append([int(i), int(i)])
        return g
    xs, ys = peaks(line.mean(0)), peaks(line.mean(1))
    if len(xs) != 7 or len(ys) != 7: sys.exit("no se detectaron las 7+7 líneas de la rejilla (%d, %d)" % (len(xs), len(ys)))
    return xs, ys


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def dil(m, it=1):
    for _ in range(it):
        p = np.pad(m, 1); m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return m


def ero(m, it=1):
    for _ in range(it):
        p = np.pad(m, 1, constant_values=True); m = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return m


def flood_outside(free):
    """píxeles de `free` alcanzables desde el borde (4-conexo)."""
    h, w = free.shape; out = np.zeros((h, w), bool); st = []
    for x in range(w):
        for y in (0, h - 1):
            if free[y, x] and not out[y, x]: out[y, x] = True; st.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if free[y, x] and not out[y, x]: out[y, x] = True; st.append((y, x))
    while st:
        y, x = st.pop()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not out[ny, nx]: out[ny, nx] = True; st.append((ny, nx))
    return out


def components(mask):
    h, w = mask.shape; lbl = np.zeros((h, w), np.int32); info = []
    for sy, sx in zip(*np.nonzero(mask)):
        if lbl[sy, sx]: continue
        n = len(info) + 1; st = [(sy, sx)]; lbl[sy, sx] = n; c = 0; edge = False
        while st:
            y, x = st.pop(); c += 1
            if y == 0 or x == 0 or y == h - 1 or x == w - 1: edge = True
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lbl[ny, nx]: lbl[ny, nx] = n; st.append((ny, nx))
        info.append((c, edge))
    return lbl, info


def cut(cell):
    a = np.asarray(cell).astype(np.float64); h, w = a.shape[:2]
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]; lum = a.mean(2); sat = a.max(2) - a.min(2)
    yy, xx = np.mgrid[0:h, 0:w]
    label = (yy < 30) & (xx < 40) & (sat < 60)                            # número de la esquina (con su sombra): es fondo
    a = np.where(label[:, :, None], CK[None, None, :], a); R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]; lum = a.mean(2); sat = a.max(2) - a.min(2)
    d = a - CK[None, None, :]
    far = np.abs(d).max(2) > 40                                           # claramente distinto del fondo
    purple = (R > G + 25) & (B > G + 25)                                  # familia morado/magenta/rosa-carmesí = aura
    dark = (lum < DARK_LUM) & (sat < 45)
    seed = dark | (far & ~purple)
    closed = ero(dil(seed, 3), 3)                                         # cierra rendijas de hasta 3 px en el contorno
    # cuerpo = semillas + lo que encierran, SALVO los huecos de fondo de verdad. El hueco entre las piernas queda encerrado
    # por piernas + sombra y es cuadrícula pura: si se rellenara se vería el "grill" (pasó en los frames 3 y 17). Pero el gris
    # oscuro de las botas y las piedras se parece al fondo, así que un hueco exige las DOS cosas: tono casi exacto del fondo
    # (±7; la cuadrícula va de -3 a +3) y formar una zona de 60 px o más. Lo demás encerrado es cuerpo.
    enclosed = ~flood_outside(~closed) & ~seed
    lbl_h, info_h = components(enclosed & (np.abs(d).max(2) <= 7))
    hole = np.isin(lbl_h, [i + 1 for i, (cnt, _) in enumerate(info_h) if cnt >= 60])
    body = seed | (enclosed & ~hole)
    # aura: quitar el fondo conocido. alfa = fracción del camino del fondo al blanco; color despremultiplicado
    ag = np.clip((d / (255.0 - CK[None, None, :])).max(2), 0, 1)
    ag = np.where((ag < GLOW_MIN) | (sat < 22), 0, ag)                    # el aura siempre es de color: un gris suelto es fondo/línea
    glow_rgb = np.clip(CK[None, None, :] + d / np.maximum(ag, 1e-3)[:, :, None], 0, 255)
    alpha = np.where(body, 1.0, ag)
    rgb = np.where(body[:, :, None], a, glow_rgb)
    # SOMBRA DEL PISO y HUMO OSCURO (más oscuros que el fondo, fuera del cuerpo): negro translúcido según cuánto oscurecen.
    # Se mide sobre la luminancia SUAVIZADA al tamaño de un cuadro de la cuadrícula (~7 px): así sus dos tonos se promedian y
    # el patrón no pasa al alfa (con un umbral píxel a píxel el humo salía cuadriculado).
    lum_s = np.asarray(Image.fromarray(np.clip(lum, 0, 255).astype(np.uint8), "L").filter(ImageFilter.BoxBlur(4))).astype(np.float64)
    a_dark = np.clip((CK.mean() - 2.0 - lum_s) / (CK.mean() - 2.0) * 1.4, 0, 0.85)
    sh = ~body & (ag <= 0) & (a_dark > 0.03)
    alpha = np.where(sh, a_dark, alpha); rgb = np.where(sh[:, :, None], 0.0, rgb)
    # trozos sueltos que tocan el borde de la celda (vecinos) y motas diminutas
    lbl, info = components(alpha > 0.25)
    if info:
        big = max(range(len(info)), key=lambda i: info[i][0])
        drop = [i + 1 for i, (c, edge) in enumerate(info) if i != big and (edge or c < 12)]
        if drop:
            kill = dil(np.isin(lbl, drop), 2) & ~np.isin(lbl, [big + 1])
            alpha = np.where(kill, 0, alpha)
    return Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA")


def build():
    if sha256(SRC) != SHA: sys.exit("la fuente no coincide con su SHA-256 registrado")
    sheet = Image.open(SRC).convert("RGB"); LX, LY = grid_lines(np.asarray(sheet).astype(np.float64))
    atlas = Image.new("RGBA", (6 * CELL, 6 * CELL), (0, 0, 0, 0)); clipped = []
    for k in range(36):
        r, c = k // 6, k % 6
        x0, x1 = LX[c][1] + 1 + INSET, LX[c + 1][0] - INSET; y0, y1 = LY[r][1] + 1 + INSET, LY[r + 1][0] - INSET
        im = cut(sheet.crop((x0, y0, x1, y1)))
        nw, nh = round(im.width * FACTOR), round(im.height * FACTOR)
        s = im.convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")
        arr = np.array(s); arr[arr[:, :, 3] < 10, 3] = 0; s = Image.fromarray(arr, "RGBA")
        bb = s.getchannel("A").getbbox()
        cv = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        py = FOOT - (bb[3] if bb else nh)
        cv.alpha_composite(s.crop((0, max(0, -py), nw, nh)), ((CELL - nw) // 2, max(0, py)))
        if bb and py + bb[1] < 0: clipped.append(k + 1)
        atlas.paste(cv, (c * CELL, r * CELL))
    return atlas, clipped


def main():
    check = "--check" in sys.argv
    atlas, clipped = build()
    old = Image.open(OUT).convert("RGBA") if os.path.exists(OUT) else None
    same = old is not None and old.size == atlas.size and old.tobytes() == atlas.tobytes()
    if clipped: print("AVISO: frames recortados por arriba:", clipped)
    if check: print("al día" if same else "DESACTUALIZADO"); sys.exit(0 if same else 1)
    if not same: atlas.save(OUT, "PNG", optimize=True); print("escrito", os.path.relpath(OUT, ROOT))
    else: print("sin cambios")


if __name__ == "__main__":
    main()
