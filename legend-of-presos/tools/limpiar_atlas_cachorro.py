#!/usr/bin/env python3
"""Limpia las hojas de Cachorro (id personaje_08) que traían SOMBRA y CUADRÍCULA pintadas.

Uso, desde la raíz del proyecto (legend-of-presos/):
    python3 -I tools/limpiar_atlas_cachorro.py            # escribe las hojas limpias en assets/combat/personaje_08/
    python3 -I tools/limpiar_atlas_cachorro.py --check    # solo verifica que estén al día (sale con 1 si no)
    python3 -I tools/limpiar_atlas_cachorro.py --report D # además guarda en D/ comparaciones antes/después

Qué tenían (medido, 2026-11-16): en specials.png, personaje_08_hidden_specials.png y personaje_08_combo_sequences.png
  1) una SILUETA plana azul marino detrás del personaje (en los agarres, el cuerpo del rival: el juego ya lo dibuja);
  2) líneas finas del mismo azul formando marcos dentro de las celdas (la "cuadrícula" que se ve en el juego).
Los remolinos de energía usan LA MISMA paleta azul (~26 tonos), así que no se puede borrar por color. Se separa por FORMA:
  - silueta = parte SÓLIDA del azul marino (apertura morfológica: lo de menos de APERTURA px de grueso desaparece), píxel
    por píxel, salvo lo que esté a menos de FX_CERCA px de un brillo de energía; se recupera su borde suave;
  - cuadrícula = tramos rectos largos (>= LINEA px) y delgados (<= 2 px), horizontales o verticales, de un tono oscuro
    azulado o gris (la cuadrícula viene en varios tonos, no solo en el azul de la sombra).
Todo lo demás (personaje y efectos) queda igual. Fuente intacta: sources/atlas_originales_2026-11-16/personaje_08/.
"""
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _png_formato import guardar  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "sources", "atlas_originales_2026-11-16", "personaje_08")
DST = os.path.join(ROOT, "assets", "combat", "personaje_08")
SHEETS = {"specials.png": 120, "personaje_08_hidden_specials.png": 120, "personaje_08_combo_sequences.png": 120}
APERTURA = 5        # px: lo azul más delgado que esto es trazo de efecto, no silueta
MIN_SOLIDO = 60     # px: manchas sólidas más chicas no se tocan
FX_CERCA = 5        # px: el azul a esta distancia de un brillo de energía se considera parte del efecto
LINEA = 26          # px: largo mínimo de un tramo recto para considerarlo línea de cuadrícula
CHECK = "--check" in sys.argv
REPORT = sys.argv[sys.argv.index("--report") + 1] if "--report" in sys.argv else None


def masks(a):
    R, G, B, A = [a[..., i].astype(np.int16) for i in range(4)]
    navy = (A > 8) & (R < 90) & (G >= 38) & (G <= 120) & (B >= 66) & (B <= 150) & (B > R + 22) & (B >= G)
    fx = (A > 60) & (B > 160) & (B - R > 40)                         # brillos azules claros de los efectos
    return navy, fx


def _shifts(m, r, fill):
    h, w = m.shape
    p = np.pad(m, r, constant_values=fill)          # sin envolver: lo de una orilla no se mezcla con la opuesta
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            yield p[r + dy:r + dy + h, r + dx:r + dx + w]


def erode(m, r):
    out = m.copy()
    for s in _shifts(m, r, False):
        out &= s
    return out


def dilate(m, r):
    out = m.copy()
    for s in _shifts(m, r, False):
        out |= s
    return out


def components(m):
    h, w = m.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    for y in range(h):
        for x in range(w):
            if m[y, x] and not lab[y, x]:
                n += 1
                st = [(y, x)]
                lab[y, x] = n
                while st:
                    cy, cx = st.pop()
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            st.append((ny, nx))
    return lab, n


def lines(navy):
    """tramos rectos largos y delgados (horizontales y verticales)"""
    out = np.zeros_like(navy)
    h, w = navy.shape
    for horiz in (True, False):
        M = navy if horiz else navy.T
        O = out if horiz else out.T
        H, W = M.shape
        for y in range(H):
            row = M[y]
            x = 0
            while x < W:
                if not row[x]:
                    x += 1
                    continue
                x0 = x
                while x < W and row[x]:
                    x += 1
                if x - x0 >= LINEA:
                    # delgado: arriba y abajo (a 3 px) casi no hay azul en ese tramo
                    up = M[max(0, y - 3), x0:x].mean() if y >= 3 else 0
                    dn = M[min(H - 1, y + 3), x0:x].mean() if y + 3 < H else 0
                    if up < 0.35 and dn < 0.35:
                        for yy in range(max(0, y - 1), min(H, y + 2)):
                            O[yy, x0:x] |= M[yy, x0:x]
    return out


def clean_cell(c):
    a = c.copy()
    navy, fx = masks(a)
    # SILUETA, píxel por píxel: el interior sólido del azul (apertura de APERTURA px: lo más delgado son trazos de efecto)
    # que NO esté cerca de un brillo de energía (FX_CERCA px). Así se borra la sombra aunque toque un remolino, y los
    # trazos del remolino (siempre junto a sus brillos) se quedan.
    r = APERTURA // 2
    core = dilate(erode(navy, r), r) & navy
    sil = core & ~dilate(fx, FX_CERCA)
    lab, n = components(sil)
    for k in range(1, n + 1):                                         # manchas sólidas pequeñas: no se tocan
        comp = lab == k
        if comp.sum() < MIN_SOLIDO:
            sil &= ~comp
    sil = dilate(sil, 2) & navy & ~dilate(fx, 2)                     # borde suave de la silueta
    R, G, B, A = [a[..., i].astype(np.int16) for i in range(4)]
    dark = (A > 8) & (np.maximum(np.maximum(R, G), B) < 170) & (B >= R - 5)   # trazos azulados o grises (los brillos de efectos pasan de 170)
    rm = sil | lines(dark)
    # restos: motas azules sueltas (< 8 px) que quedaron pegadas a lo borrado y no tocan efectos ni personaje
    rest = navy & ~rm
    lab2, n2 = components(rest)
    near_rm = dilate(rm, 1)
    opaque_other = (a[..., 3] > 40) & ~navy
    for k in range(1, n2 + 1):
        comp = lab2 == k
        if comp.sum() < 8 and (comp & near_rm).any() and not (dilate(comp, 1) & (opaque_other | fx)).any():
            rm |= comp
    a[rm, 3] = 0
    a[rm, 0:3] = 0
    return a, int(rm.sum())


def process(name, cell):
    src = Image.open(os.path.join(SRC, name)).convert("RGBA")
    arr = np.array(src)
    out = arr.copy()
    H, W = arr.shape[:2]
    total = 0
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            c, k = clean_cell(arr[y:y + cell, x:x + cell])
            out[y:y + cell, x:x + cell] = c
            total += k
    return src, Image.fromarray(out, "RGBA"), total


def png_bytes(img, old_path):
    if os.path.exists(old_path):
        o = Image.open(old_path).convert("RGBA")
        if o.size == img.size and o.tobytes() == img.tobytes():
            return open(old_path, "rb").read()
    b = io.BytesIO()
    img.save(b, "PNG", optimize=True)
    return b.getvalue()


ATLAS_OF = {"specials.png": "specials", "personaje_08_hidden_specials.png": "hidden_special", "personaje_08_combo_sequences.png": "combo_sequences"}


def emptied(src, img, cell):
    """cuadros que dibujaban casi solo la silueta (p.ej. el rival en un agarre) y quedaron vacíos al limpiar"""
    a, o = np.array(img), np.array(src)
    cols = a.shape[1] // cell
    out = []
    for i in range((a.shape[0] // cell) * cols):
        y, x = (i // cols) * cell, (i % cols) * cell
        n, n0 = int((a[y:y + cell, x:x + cell, 3] > 40).sum()), int((o[y:y + cell, x:x + cell, 3] > 40).sum())
        if n0 > 1500 and n < 0.15 * n0:
            out.append(i)
    return out


def patch_clips(cd, atlas, empty):
    """en cada animación de esa hoja, un cuadro vaciado se cambia por el cuadro anterior de la misma animación (o el
    siguiente si es el primero). Lo original queda en clip._vaciados para poder revertir."""
    changed = False
    for name, c in cd["clips"].items():
        if c.get("atlas") != atlas:
            continue
        orig = c.get("_vaciados", {}).get("frames", c["frames"])
        fr = list(orig)
        for k, f in enumerate(orig):
            if f in empty:
                alt = next((orig[j] for j in range(k - 1, -1, -1) if orig[j] not in empty), None)
                if alt is None:
                    alt = next((orig[j] for j in range(k + 1, len(orig)) if orig[j] not in empty), f)
                fr[k] = alt
        if fr != list(orig):
            if c["frames"] != fr or "_vaciados" not in c:
                c["frames"] = fr
                c["_vaciados"] = {"frames": list(orig), "_doc": "tools/limpiar_atlas_cachorro.py: estos cuadros solo dibujaban la silueta del rival y quedaron vacíos al quitarla; se repite el cuadro anterior"}
                changed = True
    return changed


def main():
    stale = []
    cpath = os.path.join(DST, "personaje_08.char.json")
    ctxt = open(cpath, encoding="utf-8").read()
    cd = json.loads(ctxt)
    if REPORT:
        os.makedirs(REPORT, exist_ok=True)
    for name, cell in SHEETS.items():
        src, img, k = process(name, cell)
        dp = os.path.join(DST, name)
        data = guardar(os.path.join(SRC, name), img)   # mismo formato que el original (paleta o RGBA)
        same = os.path.exists(dp) and open(dp, "rb").read() == data
        if not same:
            stale.append(name)
            if not CHECK:
                open(dp, "wb").write(data)
        emp = emptied(src, img, cell)
        patch_clips(cd, ATLAS_OF[name], emp)
        print(f"{name}: {k} px borrados (sombra + cuadrícula) · cuadros vaciados {emp} · sha256 {hashlib.sha256(data).hexdigest()[:16]}…")
        if REPORT:
            for tag, im in (("antes", src), ("despues", img)):
                for bgname, col in (("claro", (235, 235, 235)), ("rojo", (170, 40, 40))):
                    bg = Image.new("RGBA", im.size, col + (255,)); bg.alpha_composite(im)
                    bg.convert("RGB").save(os.path.join(REPORT, f"{name[:-4]}_{tag}_{bgname}.png"))
    ntxt = json.dumps(cd, indent=2, ensure_ascii=False) + ("\n" if ctxt.endswith("\n") else "")
    if ntxt != ctxt:
        stale.append("personaje_08.char.json")
        if not CHECK:
            open(cpath, "w", encoding="utf-8").write(ntxt)
    if CHECK:
        print("DESACTUALIZADO: " + ", ".join(stale) if stale else "al día")
        sys.exit(1 if stale else 0)


if __name__ == "__main__":
    main()
