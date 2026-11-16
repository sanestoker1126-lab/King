#!/usr/bin/env python3
"""Hoja única de FICHAS (retratos de busto 3:4) para las cartas del selector.

Uso, desde la raíz del proyecto (legend-of-presos/):
    python3 -I tools/build_fichas.py           # escribe assets/ui/fichas.webp + assets/ui/fichas.json
    python3 -I tools/build_fichas.py --check   # solo verifica que estén al día (sale con 1 si no)

Por qué: cada carta descargaba el ATLAS COMPLETO de su personaje (21.6 MB entre los 33) para recortar una cara de
~38 px, escalada a 112 px (borrosa). Ahora todas las caras viven en una hoja WebP pequeña.

Cómo se recorta (sin inventar nada): `portrait.body` de cada char.json = caja de la silueta del idle[0] en px del atlas
(la escribieron tools/build_portraits.py / los integradores). El busto es su parte de ARRIBA: todo el ancho de la
silueta y el 56 % de su alto desde arriba (BUST): cabeza y torso, sin salirse de la silueta (así nunca entra el cuadro
vecino del atlas). Se pega
centrado y arriba en una celda transparente de 3:4. Escalado: primero vecino-más-cercano a un múltiplo entero
(el pixel art queda nítido) y luego Lanczos al tamaño de la celda.
"""
import hashlib
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHECK = "--check" in sys.argv
CW, CH = 150, 200            # celda 3:4
COLS = 8
BUST = 0.56                  # fracción de la silueta (desde arriba) que entra en la ficha
OUT_IMG = "assets/ui/fichas.webp"
OUT_IDX = "assets/ui/fichas.json"


def bust(img, body):
    x, y, w, h = body
    bh = max(8, int(round(h * BUST)))                    # mitad superior de la silueta: cabeza y torso
    crop = img.crop((x, y, x + w, y + bh)).convert("RGBA")
    # escala que hace caber el busto en la celda (con 4 px de aire arriba)
    s = min(CW / w, (CH - 4) / bh)
    k = max(1, int(s))                                   # múltiplo entero: vecino más cercano (nítido)
    big = crop.resize((w * k, bh * k), Image.NEAREST)
    tw, th = max(1, round(w * s)), max(1, round(bh * s))
    fin = big.resize((tw, th), Image.LANCZOS)
    cell = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    cell.alpha_composite(fin, ((CW - tw) // 2, 4))      # arriba (4 px de aire): la cara queda siempre en la parte alta de la ficha
    return cell


def main():
    roster = json.load(open(os.path.join(ROOT, "data/roster.json"), encoding="utf-8"))["characters"]
    items = []
    for c in roster:
        cdir = os.path.join(ROOT, "assets/combat", c["id"])
        p = os.path.join(cdir, c["id"] + ".char.json")
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding="utf-8"))
        pr = d.get("portrait")
        if not pr or "body" not in pr or pr.get("atlas") not in d.get("atlases", {}):
            print("sin portrait.body:", c["id"])
            continue
        items.append((c["id"], os.path.join(cdir, d["atlases"][pr["atlas"]]["file"]), pr["body"]))
    rows = (len(items) + COLS - 1) // COLS
    sheet = Image.new("RGBA", (COLS * CW, rows * CH), (0, 0, 0, 0))
    index = {}
    cache = {}
    for i, (cid, atlas, body) in enumerate(items):
        if atlas not in cache:
            cache[atlas] = Image.open(atlas).convert("RGBA")
        sheet.alpha_composite(bust(cache[atlas], body), ((i % COLS) * CW, (i // COLS) * CH))
        index[cid] = i
    buf = io.BytesIO()
    sheet.save(buf, "WEBP", quality=86, method=6)
    data = buf.getvalue()
    # huella de los PÍXELES FUENTE (antes de comprimir): el WebP con pérdida puede dar bytes distintos entre versiones de
    # Pillow, así que "al día" = misma huella fuente y el WebP escrito es el que dice su sha256
    src = hashlib.sha256(sheet.tobytes()).hexdigest()
    ip, jp = os.path.join(ROOT, OUT_IMG), os.path.join(ROOT, OUT_IDX)
    old = json.load(open(jp, encoding="utf-8")) if os.path.exists(jp) else {}
    same = old.get("srcSha256") == src and old.get("index") == index and os.path.exists(ip) \
        and hashlib.sha256(open(ip, "rb").read()).hexdigest() == old.get("sha256")
    if CHECK:
        print("al día" if same else "DESACTUALIZADO"); sys.exit(0 if same else 1)
    if not same:
        meta = {"_doc": "Generado por tools/build_fichas.py (no editar). Retrato de busto 3:4 por personaje; index = posición en la hoja (fila = i // cols).",
                "file": OUT_IMG, "cell": [CW, CH], "cols": COLS, "rows": rows, "sha256": hashlib.sha256(data).hexdigest(), "srcSha256": src, "index": index}
        os.makedirs(os.path.dirname(ip), exist_ok=True)
        open(ip, "wb").write(data)
        open(jp, "w", encoding="utf-8").write(json.dumps(meta, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(items)} fichas · hoja {sheet.size[0]}x{sheet.size[1]} · {os.path.getsize(ip) / 1024:.0f} KB")


# Fondo del selector: la calle del OXXO de Guadalajara de noche (arte del juego), desenfocada y oscurecida AQUÍ, una vez
# (en el teléfono no se gasta nada: sin filtros CSS). 960x540, WebP pequeño.
BG_SRC = "assets/stages/guadalajara_oxxo_background.png"
BG_OUT = "assets/ui/selector_fondo.webp"


def build_bg():
    from PIL import ImageFilter, ImageEnhance
    src = os.path.join(ROOT, BG_SRC)
    im = Image.open(src).convert("RGB")
    w, h = im.size
    s = max(960 / w, 540 / h)
    im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    l = (im.width - 960) // 2; t = (im.height - 540) // 2
    im = im.crop((l, t, l + 960, t + 540)).filter(ImageFilter.GaussianBlur(3.2))
    im = ImageEnhance.Color(im).enhance(0.75)
    im = ImageEnhance.Brightness(im).enhance(0.55)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=72, method=6)
    data = buf.getvalue()
    src_sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
    jp = os.path.join(ROOT, OUT_IDX)
    meta = json.load(open(jp, encoding="utf-8")) if os.path.exists(jp) else {}
    bp = os.path.join(ROOT, BG_OUT)
    same = meta.get("bg", {}).get("srcSha256") == src_sha and os.path.exists(bp) and hashlib.sha256(open(bp, "rb").read()).hexdigest() == meta.get("bg", {}).get("sha256")
    if CHECK:
        return same
    if not same:
        open(bp, "wb").write(data)
        meta["bg"] = {"file": BG_OUT, "src": BG_SRC, "srcSha256": src_sha, "sha256": hashlib.sha256(data).hexdigest(), "_doc": "desenfoque 3.2 px, color x0.75, brillo x0.55"}
        open(jp, "w", encoding="utf-8").write(json.dumps(meta, indent=1, ensure_ascii=False) + "\n")
    print(f"fondo del selector: {os.path.getsize(bp) / 1024:.0f} KB")
    return True


if __name__ == "__main__":
    if CHECK:
        ok_bg = build_bg()
        if not ok_bg:
            print("DESACTUALIZADO (fondo)"); sys.exit(1)
    main()
    if not CHECK:
        build_bg()
