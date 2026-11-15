#!/usr/bin/env python3
"""Integra la entrega del usuario del 2026-11-15 (sources/entregas_2026-11-15/, "frames trabajadas").

Uso, desde la raíz del proyecto:
    python3 -I tools/integrar_frames_20261115.py           # escribe
    python3 -I tools/integrar_frames_20261115.py --check   # solo verifica (sale con 1 si algo está desactualizado)
Después, siempre: python3 -I tools/build_frame_data.py  (recalcula los tiempos de Sentencia Firme con su clip nuevo).

Qué hace (idempotente):
  1. Tobi y Diego Cancha: dizzy (8), ko_fall (8) y victory_pose (8) -> atlas <id>_poses_extra.png.
     Escala = alto del idle del atlas base / 520 px (la entrega declara "altura_maxima_pose_de_pie_px": 520 en celdas
     de 640; no trae pose base). Pie MEDIDO (mediana del borde inferior de la silueta, alfa > 40).
  2. Wasirris: Sentencia Firme en 16 cuadros (cuerpo + capa FX compuesta encima, misma cuadrícula 8x2) -> atlas
     wasirris_sentencia.png, a la MISMA escala que sus poses del 2026-11-06 (alto del idle / alto de su base entregada).
     El move pasa a ese clip: impacto en los cuadros 8-9 (el manifest marca el 8 como primer contacto), caja de golpe
     MEDIDA de la palma + destello del cuadro 8, y avance real durante el dash dibujado en el sitio (cuadros 4-7).
     Los FX sueltos que tenía (azul_dash / azul_anillo, para el clip de 6 cuadros) se quitan: ahora vienen dibujados.
Cada clip/move reemplazado guarda lo anterior en `_prev` para poder revertir sin adivinar. Los clips llevan
`_entrega: "2026-11-15"`: tools/build_reacciones_prototipo.py ya no los pisa.

DEFECTO DE LA FUENTE (no se corrige aquí, se documenta): en varias hojas el personaje cambia de tamaño entre cuadros
(Diego dizzy 0-3 y victory 0-3 más chicos que 4-7; Tobi dizzy/victory 4 y 7 más grandes). Ver --report.
"""
import hashlib
import io
import json
import os
import statistics
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "sources", "entregas_2026-11-15")
SRC06 = os.path.join(ROOT, "sources", "entregas_2026-11-06")
TOOL = "tools/integrar_frames_20261115.py"
THR = 40
STAND_H = 520            # manifest: altura_maxima_pose_de_pie_px
CHECK = "--check" in sys.argv
CHANGED = []
ENTREGA = "2026-11-15"


def p(*a):
    return os.path.join(ROOT, *a)


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_bytes(path, data):
    old = open(path, "rb").read() if os.path.exists(path) else None
    if old == data:
        return
    CHANGED.append(rel(path))
    if not CHECK:
        with open(path, "wb") as f:
            f.write(data)


def save_json(path, d):
    write_bytes(path, (json.dumps(d, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


def png_bytes(img, old_path):
    """Si los píxeles no cambiaron se conservan los bytes viejos (Pillow no garantiza bytes idénticos entre versiones)."""
    if os.path.exists(old_path):
        o = Image.open(old_path).convert("RGBA")
        if o.size == img.size and o.tobytes() == img.tobytes():
            return open(old_path, "rb").read()
    b = io.BytesIO()
    img.save(b, format="PNG", optimize=True)
    return b.getvalue()


def bbox(img):
    return img.getchannel("A").point(lambda v: 255 if v > THR else 0).getbbox()


def idle_height(cd, cdir):
    base = cd["atlases"]["base"]
    fw, fh = cd["frameSize"]["w"], cd["frameSize"]["h"]
    atlas = Image.open(os.path.join(cdir, base["file"])).convert("RGBA")
    i = cd["clips"]["idle"]["frames"][0]
    x, y = (i % base["columns"]) * fw, (i // base["columns"]) * fh
    b = bbox(atlas.crop((x, y, x + fw, y + fh)))
    return b[3] - b[1]


def build_atlas(cid, rows, scale_h_deliv, atlas_key, fname_out, src_dir, fx_suffix=None):
    """rows: lista de (clip, archivo, cuadros, columnas_en_hoja). Devuelve (cd, clip->índices, info)."""
    cdir = p("assets", "combat", cid)
    cd = load(os.path.join(cdir, cid + ".char.json"))
    h_atlas = idle_height(cd, cdir)
    src_cell = 640
    out_cell = int(round(src_cell * h_atlas / scale_h_deliv))
    s_eff = out_cell / src_cell
    cols = 8
    total = sum(n for _, _, n, _ in rows)
    nrows = (total + cols - 1) // cols
    out = Image.new("RGBA", (cols * out_cell, nrows * out_cell), (0, 0, 0, 0))
    idx, k, bottoms, heights = {}, 0, [], {}
    for clip, fname, n, scols in rows:
        sheet = Image.open(os.path.join(src_dir, fname)).convert("RGBA")
        fx = None
        if fx_suffix:
            fx = Image.open(os.path.join(src_dir, fname.replace(".png", fx_suffix))).convert("RGBA")
        if sheet.size != (scols * src_cell, ((n + scols - 1) // scols) * src_cell):
            raise SystemExit(f"{fname}: tamaño {sheet.size} inesperado")
        idx[clip] = []
        heights[clip] = []
        for i in range(n):
            box = ((i % scols) * src_cell, (i // scols) * src_cell, (i % scols + 1) * src_cell, (i // scols + 1) * src_cell)
            fr = sheet.crop(box)
            b0 = bbox(fr)
            bottoms.append(b0[3])
            heights[clip].append(b0[3] - b0[1])
            if fx is not None:
                fr = fr.copy()
                fr.alpha_composite(fx.crop(box))       # FX delante del cuerpo (la entrega los dibuja separados del cuerpo)
            sm = fr.resize((out_cell, out_cell), Image.LANCZOS)
            out.alpha_composite(sm, ((k % cols) * out_cell, (k // cols) * out_cell))
            idx[clip].append(k)
            k += 1
    feet = statistics.median_low(bottoms)
    anchor_y = round(feet / src_cell, 6)
    path = os.path.join(cdir, fname_out)
    data = png_bytes(out, path)
    write_bytes(path, data)
    cd["atlases"][atlas_key] = {
        "file": fname_out, "columns": cols, "rows": nrows, "cell": {"w": out_cell, "h": out_cell},
        "anchor": {"x": 0.5, "y": anchor_y}, "sha256": hashlib.sha256(data).hexdigest(),
        "source": (f"{TOOL}: entrega sources/entregas_2026-11-15/{cid}/ (celdas 640) reescalada x{s_eff:.5f} = alto del idle "
                   f"del atlas base ({h_atlas} px) / {scale_h_deliv} px; pie medido en y={feet}/640. Arte GENERATIVO con revisión "
                   f"artística pendiente (ver manifest.json de la entrega)."),
    }
    return cd, idx, {"scale": round(s_eff, 5), "cell": out_cell, "anchor_y": anchor_y, "h_atlas": h_atlas, "heights": heights,
                     "out": out, "cols": cols}


def set_clip(cd, clip, c, man_desc):
    prev = cd["clips"].get(clip)
    c["_entrega"] = ENTREGA
    c["_doc"] = f"Entrega {ENTREGA}. " + " ".join(man_desc.get(clip, {}).get("descripcion", []))
    if prev is not None and prev.get("_entrega") == ENTREGA:   # ya aplicado: se conserva lo que había antes (si había)
        prev = prev.get("_prev")
    if prev is not None:
        c["_prev"] = prev
    cd["clips"][clip] = c


def victory_box(cd, idx, info):
    out, cell, cols, ay = info["out"], info["cell"], info["cols"], info["anchor_y"] * info["cell"]
    l = r = t = 0
    for i in idx:
        x, y = (i % cols) * cell, (i // cols) * cell
        b = bbox(out.crop((x, y, x + cell, y + cell)))
        l, r, t = max(l, cell * 0.5 - b[0]), max(r, b[2] - cell * 0.5), max(t, ay - b[1])
    cd.setdefault("portrait", {}).setdefault("clipBox", {})["victory_pose"] = {"l": int(-(-l // 1)), "r": int(-(-r // 1)), "t": int(-(-t // 1))}


def poses(cid):
    sdir = os.path.join(SRC, cid)
    man = load(os.path.join(sdir, "manifest.json"))
    desc = {e["clip"]: e for e in man["entregas"]}
    rows = [("dizzy", f"{cid}__dizzy.png", 8, 8), ("ko_fall", f"{cid}__ko_fall.png", 8, 8), ("victory_pose", f"{cid}__victory_pose.png", 8, 8)]
    cd, idx, info = build_atlas(cid, rows, STAND_H, "poses_extra", f"{cid}_poses_extra.png", sdir)
    set_clip(cd, "dizzy", {"atlas": "poses_extra", "fps": desc["dizzy"]["fps_sugerido"], "loop": True, "frames": idx["dizzy"]}, desc)
    set_clip(cd, "ko_fall", {"atlas": "poses_extra", "fps": desc["ko_fall"]["fps_sugerido"], "loop": False, "hold": True, "frames": idx["ko_fall"]}, desc)
    set_clip(cd, "victory_pose", {"atlas": "poses_extra", "fps": desc["victory_pose"]["fps_sugerido"], "loop": False, "frames": idx["victory_pose"]}, desc)
    victory_box(cd, idx["victory_pose"], info)
    save_json(p("assets", "combat", cid, cid + ".char.json"), cd)
    return info


def wasirris():
    cid = "wasirris"
    sdir = os.path.join(SRC, cid)
    man = load(os.path.join(sdir, "manifest.json"))
    desc = {e["clip"]: e for e in man["entregas"] if e.get("capa") != "fx"}
    base = Image.open(os.path.join(SRC06, cid, cid + "__base.png")).convert("RGBA")   # misma base que la entrega del 06-11
    bb = bbox(base)
    cd, idx, info = build_atlas(cid, [("sentencia_firme", "wasirris__sentencia_firme.png", 16, 8)], bb[3] - bb[1],
                                "sentencia", "wasirris_sentencia.png", sdir, fx_suffix="__fx.png")
    set_clip(cd, "sentencia_firme", {"atlas": "sentencia", "fps": desc["sentencia_firme"]["fps_sugerido"], "loop": False,
                                     "frames": idx["sentencia_firme"]}, desc)
    # --- move: clip nuevo, impacto 8-9, caja MEDIDA de la palma + destello del cuadro 8 (px fuente -> px lógicos)
    k = (info["cell"] / 640) * cd["renderScale"]
    sheet = Image.open(os.path.join(sdir, "wasirris__sentencia_firme.png")).convert("RGBA")
    fx = Image.open(os.path.join(sdir, "wasirris__sentencia_firme__fx.png")).convert("RGBA")
    box8 = (0, 640, 640, 1280)                                   # cuadro 8 = fila 2, columna 0
    body = sheet.crop(box8).getchannel("A").point(lambda v: 255 if v > THR else 0)
    bb8 = body.getbbox()
    hand = body.crop((bb8[2] - 60, 0, bb8[2], 640)).getbbox()   # la palma: la franja más adelantada del cuerpo
    hx0, hy0, hy1 = bb8[2] - 60 + hand[0], hand[1], hand[3]
    f8 = bbox(fx.crop(box8))                                     # destello de contacto
    feet = info["anchor_y"] * 640
    pad = 4
    x0 = (hx0 - 320) * k - pad
    x1 = (max(bb8[2], f8[2]) - 320) * k + pad
    y0 = (min(hy0, f8[1]) - feet) * k - pad
    y1 = (max(hy1, f8[3]) - feet) * k + pad
    hitbox = {"x": int(round(x0)), "y": int(round(y0)), "w": int(round(x1 - x0)), "h": int(round(y1 - y0))}
    mv = cd["moves"]["sentencia_firme"]
    old_prev = mv.get("_prev")
    snap = {kk: vv for kk, vv in mv.items() if kk not in ("_prev",)}
    tgt = mv["_clipTiming"] if "_clipTiming" in mv else mv
    if old_prev is None:
        mv["_prev"] = {kk: snap[kk] for kk in ("clip", "hitbox", "fx", "advance", "advanceFrames") if kk in snap}
        mv["_prev"]["hitFrames"] = tgt.get("hitFrames")
    mv["clip"] = "sentencia_firme"
    tgt["hitFrames"] = [8, 9]
    mv["hitbox"] = hitbox
    mv.pop("fx", None)
    mv["advance"] = 9
    mv["advanceFrames"] = [4, 7]
    mv["_doc"] = ("Súper (1 barra): dash y palma. Arte de la entrega 2026-11-15 (16 cuadros, cuerpo + FX dibujados). Impacto en los "
                  "cuadros 8-9; caja MEDIDA de la palma + destello del cuadro 8; avanza durante el dash (cuadros 4-7), que la "
                  "entrega dibuja en el sitio. `_prev` = definición anterior. Tiempos: tools/build_frame_data.py. TODO: VERIFICAR jugando.")
    save_json(p("assets", "combat", cid, cid + ".char.json"), cd)
    info["hitbox"] = hitbox
    return info


def report(name, info):
    hs = info["heights"]
    msg = {c: v for c, v in hs.items()}
    print(f"{name}: escala x{info['scale']} celda {info['cell']} pie y={info['anchor_y']}  altos fuente por cuadro: {msg}"
          + (f"  caja {info['hitbox']}" if "hitbox" in info else ""))


def main():
    infos = {"tobi": poses("tobi"), "diego_cancha": poses("diego_cancha"), "wasirris": wasirris()}
    if "--report" in sys.argv or not CHECK:
        for n, i in infos.items():
            report(n, i)
    if CHECK:
        if CHANGED:
            print("DESACTUALIZADO:", ", ".join(CHANGED))
            sys.exit(1)
        print("al día")
    else:
        print("escritos:", ", ".join(CHANGED) if CHANGED else "(nada; ya estaba al día)")


if __name__ == "__main__":
    main()
