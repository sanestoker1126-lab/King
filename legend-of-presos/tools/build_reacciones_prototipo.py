#!/usr/bin/env python3
"""Reacciones (golpe recibido, caída, derribado, levantarse, K.O., mareo) tomadas del PROTOTIPO de la raíz del repo
("Puente Grande · Arcade Club", public/assets/characters/<id>/atlas_0N.webp). Idempotente.
Uso (desde legend-of-presos/):  python3 -I tools/build_reacciones_prototipo.py [--check]

Por qué: esas hojas (1448x1086) vienen del mismo paquete original que los atlas del juego, pero el juego nunca las integró:
Nadia, Regente y Tobi caían/se levantaban con 1-3 poses repetidas y no tenían `ko_fall` ni `dizzy`.
Las hojas NO traen rejilla: tools/_seg_reacciones.py separa las figuras (componentes conectados -> filas -> columnas) y aquí
se eligen por "fila.columna" (ver qa/entrega_20261106/reacciones_prototipo_*.jpg). Solo se usan cajas con UNA figura limpia.

Reglas que respeta:
 - Escala: cada figura se lleva al alto de pie del atlas base del personaje (figura de pie de la hoja -> alto del idle base).
 - Simulación intacta: el motor mide la levantada con el clip (`ceil(60/fps*frames)`), así que `recovery_pose` y
   `damage_fall` conservan su DURACIÓN exacta (más frames => más fps, mismo producto). `ko_fall`, `dizzy`, `hurt` y `down`
   solo cambian el dibujo. Verificado con tools/qa_20261106/determinism.cjs.
 - Garravas queda fuera: la hoja `garravas/atlas_02` del prototipo es una BESTIA-RATA y el Garravas del juego es un hombre
   de gabardina (tampoco es Don Garras, que va de traje): ese arte no corresponde a ningún personaje del roster.
 - Semillas y Mateo quedan fuera: en Semillas las figuras se tocan en vertical (corte no fiable) y ya tiene caída de 9 poses;
   la hoja de Mateo es de su arte anterior (hoy Mateo usa el arte de El Sable).
La elección de poses es decisión de integración: TODO: VERIFICAR con el usuario.
"""
import hashlib, io, json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _seg_reacciones import segment  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, ".."))
PROTO = os.path.abspath(os.path.join(ROOT, "..", "public", "assets", "characters"))
COLS = 8

# id -> hoja del prototipo (+sha256), figura de pie de referencia, y clips: nombre -> (frames "fila.col", modo)
#   modo "dur"  = conserva la duración del clip actual (fps = fps_viejo * n_nuevo / n_viejo; debe dar entero)
#   modo ("fps", n, extra) = clip de solo dibujo con sus fps y banderas
SPEC = {
    "nadia": {"sheet": "nadia/atlas_02.webp", "sha": None, "stand": "0.0", "clips": {
        "hurt":          (["4.1", "4.2"], ("fps", 20, {"hold": True})),
        "damage_fall":   (["2.0", "2.1", "2.2", "2.3"], "dur"),
        "down":          (["2.4"], ("fps", 10, {"hold": True, "lying": True})),
        "recovery_pose": (["1.0", "1.3", "1.4", "1.5", "1.6", "1.7"], "dur"),
        "ko_fall":       (["4.2", "4.3", "4.4", "4.5", "4.6", "2.4"], ("fps", 10, {"loop": False, "hold": True})),
    }},
    "regente": {"sheet": "regente/atlas_02.webp", "sha": None, "stand": "0.0", "clips": {
        "damage_fall":   (["1.0", "1.0", "1.1", "2.2"], "dur"),
        "down":          (["2.2"], ("fps", 10, {"hold": True, "lying": True})),
        "recovery_pose": (["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"], "dur"),
        "ko_fall":       (["1.0", "1.1", "1.2", "2.2"], ("fps", 8, {"loop": False, "hold": True})),
    }},
    "tobi": {"sheet": "tobi/atlas_01.webp", "sha": None, "stand": "2.7", "clips": {
        "recovery_pose": (["1.2", "1.3", "1.4", "1.5", "1.6", "1.7"], "dur"),
        "dizzy":         (["5.0", "5.1", "5.2", "5.3"], ("fps", 8, {"loop": True})),
        "ko_fall":       (["5.4", "5.5", "1.0"], ("fps", 8, {"loop": False, "hold": True})),
    }},
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def base_stand_height(d, cdir):
    """alto (px del atlas base) de la figura del primer frame de idle."""
    a = d["atlases"]["base"]; im = Image.open(os.path.join(cdir, a["file"])).convert("RGBA")
    fw, fh = d["frameSize"]["w"], d["frameSize"]["h"]; i = d["clips"]["idle"]["frames"][0]
    c = a["columns"]; cell = np.array(im.crop(((i % c) * fw, (i // c) * fh, (i % c + 1) * fw, (i // c + 1) * fh)))[:, :, 3] > 40
    ys = np.nonzero(cell.any(1))[0]
    return int(ys.max() - ys.min() + 1)


def build_char(cid):
    S = SPEC[cid]; cdir = os.path.join(ROOT, "assets/combat", cid)
    d = json.load(open(os.path.join(cdir, cid + ".char.json"), encoding="utf-8"))
    sheet = os.path.join(PROTO, S["sheet"])
    im, lbl, alpha, rows = segment(sheet)
    def box(key):
        r, k = map(int, key.split("."))
        if r >= len(rows) or k >= len(rows[r]): sys.exit("%s: no existe la figura %s en %s" % (cid, key, S["sheet"]))
        return rows[r][k]
    def crop(key):
        x0, y0, x1, y1, lab = box(key)
        a = np.array(im.crop((x0, y0, x1, y1))); a[:, :, 3] = np.where(lbl[y0:y1, x0:x1] == lab, a[:, :, 3], 0)   # sin trozos del vecino
        return Image.fromarray(a, "RGBA")
    sb = box(S["stand"]); k = base_stand_height(d, cdir) / float(sb[3] - sb[1])
    names = []
    for clip, (frames, _) in S["clips"].items():
        for f in frames:
            if f not in names: names.append(f)
    tiles = {}
    for n in names:
        t = crop(n); w, h = max(1, round(t.width * k)), max(1, round(t.height * k))
        t = t.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
        a = np.array(t); a[a[:, :, 3] < 8, 3] = 0; t = Image.fromarray(a, "RGBA"); bb = t.getchannel("A").getbbox()
        tiles[n] = t.crop(bb) if bb else t
    cw = max(t.width for t in tiles.values()) + 8; ch = max(t.height for t in tiles.values()) + 10
    cw += cw % 2; ch += ch % 2
    rws = (len(names) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * cw, rws * ch), (0, 0, 0, 0))
    for i, n in enumerate(names):
        t = tiles[n]; atlas.alpha_composite(t, ((i % COLS) * cw + (cw - t.width) // 2, (i // COLS) * ch + ch - 6 - t.height))
    idx = {n: i for i, n in enumerate(names)}
    fname = cid + "_reacciones.png"
    return d, cdir, atlas, fname, idx, (cw, ch), k, sha256(sheet)


def apply(d, cid, fname, idx, cell, png_sha, sheet_sha, orig):
    S = SPEC[cid]; cw, ch = cell
    d["atlases"]["reacciones"] = {
        "file": fname, "columns": COLS, "rows": (len(idx) + COLS - 1) // COLS, "cell": {"w": cw, "h": ch},
        "anchor": {"x": 0.5, "y": round((ch - 5) / ch, 6)}, "sha256": png_sha,
        "source": "Hoja de reacciones del prototipo de la raíz del repo (public/assets/characters/%s, sha256 %s); "
                  "recortada y escalada por tools/build_reacciones_prototipo.py." % (S["sheet"], sheet_sha)}
    for clip, (frames, mode) in S["clips"].items():
        old = orig.get(clip)
        if mode == "dur":
            n0, f0 = len(old["frames"]), old.get("fps", 10); fps = f0 * len(frames) / n0
            if abs(fps - round(fps)) > 1e-9: sys.exit("%s.%s: %d frames no conservan la duración (%d@%s)" % (cid, clip, len(frames), n0, f0))
            c = {k: v for k, v in old.items() if k not in ("atlas", "frames", "fps", "_doc", "_src", "_antes")}
            c.update({"atlas": "reacciones", "fps": int(round(fps)), "frames": [idx[f] for f in frames]})
        else:
            c = {"atlas": "reacciones", "fps": mode[1], "frames": [idx[f] for f in frames]}; c.update(mode[2])
        c["_src"] = frames
        if old is not None: c["_antes"] = {"atlas": old["atlas"], "frames": old["frames"], "fps": old.get("fps", 10)}
        d["clips"][clip] = c
    d["_reacciones"] = ("2026-11-13: clips %s con el arte de reacciones del prototipo (atlas `reacciones`), generados por "
                        "tools/build_reacciones_prototipo.py (no editar a mano). `_antes` guarda el clip anterior. "
                        "recovery_pose/damage_fall conservan su duración -> simulación idéntica. Elección de poses = TODO: VERIFICAR."
                        % ", ".join(S["clips"]))
    return d


def original_clips(d, cid):
    """clips tal como estaban ANTES de este script (si ya se aplicó, se reconstruyen desde `_antes`)."""
    out = {}
    for clip in SPEC[cid]["clips"]:
        c = d["clips"].get(clip)
        if c is None: continue
        if "_antes" in c:
            o = {k: v for k, v in c.items() if k not in ("_src", "_antes")}; o.update(c["_antes"]); out[clip] = o
        elif c.get("atlas") != "reacciones": out[clip] = c
    return out


def main():
    check = "--check" in sys.argv; ok = True
    for cid in SPEC:
        d, cdir, atlas, fname, idx, cell, k, sheet_sha = build_char(cid)
        out = os.path.join(cdir, fname); cj = os.path.join(cdir, cid + ".char.json")
        old_png = open(out, "rb").read() if os.path.exists(out) else None
        same = old_png is not None and Image.open(io.BytesIO(old_png)).convert("RGBA").tobytes() == atlas.tobytes() \
            and Image.open(io.BytesIO(old_png)).size == atlas.size
        if same: data = old_png
        else:
            buf = io.BytesIO(); atlas.save(buf, "PNG", optimize=True); data = buf.getvalue()
        old_txt = open(cj, encoding="utf-8").read()
        new = apply(json.loads(old_txt), cid, fname, idx, cell, hashlib.sha256(data).hexdigest(), sheet_sha, original_clips(d, cid))
        txt = json.dumps(new, ensure_ascii=False, indent=2) + "\n"
        if check:
            if not same or json.loads(txt) != json.loads(old_txt): ok = False; print("DESACTUALIZADO", cid)
            continue
        if not same: open(out, "wb").write(data)
        if json.loads(txt) != json.loads(old_txt): open(cj, "w", encoding="utf-8").write(txt)
        print("%-9s %s %s celda %dx%d escala %.3f  clips: %s" % (cid, fname, atlas.size, cell[0], cell[1], k,
              ", ".join("%s(%d@%d)" % (c, len(new["clips"][c]["frames"]), new["clips"][c]["fps"]) for c in SPEC[cid]["clips"])))
    if check: print("al día" if ok else "DESACTUALIZADO"); sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
