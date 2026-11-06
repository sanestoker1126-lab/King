#!/usr/bin/env python3
"""Integra las entregas del 2026-11-06 (sources/entregas_2026-11-06/).

Uso, desde la raíz del proyecto:   python3 -I tools/integrar_entregas_20261106.py [--check]

Qué hace (idempotente: correrlo dos veces deja los mismos bytes):
  1. Wasirris: ko_fall (8), dizzy (8) y victory_pose (8) de la entrega 640x640 -> atlas extra
     assets/combat/wasirris/wasirris_poses_extra.png, reescalado a la escala MEDIDA del atlas base.
  2. personaje_08: ko_fall (8) y victory_pose (8) -> assets/combat/personaje_08/personaje_08_poses_extra.png.
     (dizzy NO se entregó: el motor sigue usando su respaldo hurt/idle.)
  3. El Paisa Sistem (personaje nuevo): atlas de los 216 cuadros 120x120 + anclas por cuadro + char.json
     generado desde tools/specs/el_paisa_sistem_spec.json (cajas de golpe MEDIDAS del sprite) + entrada en data/roster.json.
  4. Dos escenarios nuevos de una sola imagen (Oxxo 2, Pemex 2) al FINAL de data/stages.json
     (las campañas eligen escenario por índice: agregar al final no mueve ninguno existente).
  5. Regenera data/offline_assets.json con la misma regla que ya tenía (todo assets/ menos icons/ y .txt).

Escala: s = alto del idle del atlas base / alto del 'base' de la entrega (alfa > 40 en los dos), así el
personaje mide lo mismo en todos sus clips (el motor aplica un solo renderScale por personaje).
Pie: la entrega declara pies_y=600 en celdas de 640; se MIDE (mediana del borde inferior de la silueta).

--check: no escribe nada; solo informa si los archivos generados están al día (sale con 1 si no).
"""
import hashlib
import io
import json
import math
import os
import statistics
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "sources", "entregas_2026-11-06")
TOOL = "tools/integrar_entregas_20261106.py"
THR = 40            # umbral de alfa para medir siluetas
TARGET_H = 150      # alto lógico en pantalla (data/config.json hurtbox._doc: "~150 px lógicos")
CHECK = "--check" in sys.argv
CHANGED = []
WARN = []


def p(*a):
    return os.path.join(ROOT, *a)


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dumps(d):
    return json.dumps(d, indent=2, ensure_ascii=False) + "\n"


def write_bytes(path, data):
    old = open(path, "rb").read() if os.path.exists(path) else None
    if old == data:
        return
    CHANGED.append(rel(path))
    if CHECK:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def save_json(path, d):
    write_bytes(path, dumps(d).encode("utf-8"))


def png_bytes(img):
    b = io.BytesIO()
    img.save(b, format="PNG", optimize=True)
    return b.getvalue()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def bbox(img, thr=THR):
    return img.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()


def cell(img, idx, cw, ch, cols):
    x, y = (idx % cols) * cw, (idx // cols) * ch
    return img.crop((x, y, x + cw, y + ch))


# ------------------------------------------------------------------ 1-2. poses extra (entregas 640x640)
def poses_extra(cid, sheets, notes):
    """sheets: lista de (clip, archivo, cuadros, fps, loop, hold). Devuelve info medida."""
    cdir = p("assets", "combat", cid)
    cpath = os.path.join(cdir, cid + ".char.json")
    cd = load(cpath)
    sdir = os.path.join(SRC, cid)
    man = load(os.path.join(sdir, "manifest.json"))
    desc = {e["clip"]: e for e in man["entregas"]}

    # alto del idle en el atlas base (cuadro idle[0], rejilla del atlas base)
    base = cd["atlases"]["base"]
    fw, fh = cd["frameSize"]["w"], cd["frameSize"]["h"]
    atlas = Image.open(os.path.join(cdir, base["file"])).convert("RGBA")
    idle0 = cd["clips"]["idle"]["frames"][0]
    bb = bbox(cell(atlas, idle0, fw, fh, base["columns"]))
    h_atlas = bb[3] - bb[1]

    # alto del 'base' de la entrega (misma escala que sus hojas: 520 px de personaje en celda 640)
    dbase = Image.open(os.path.join(sdir, cid + "__base.png")).convert("RGBA")
    dbb = bbox(dbase)
    h_deliv = dbb[3] - dbb[1]
    src_cell = dbase.height
    s = h_atlas / h_deliv
    out_cell = int(round(src_cell * s))
    s_eff = out_cell / src_cell

    cols = max(n for _, _, n, *_ in sheets)
    rows = len(sheets)
    out = Image.new("RGBA", (cols * out_cell, rows * out_cell), (0, 0, 0, 0))
    bottoms = []
    clip_frames = {}
    k = 0
    for r, (clip, fname, n, fps, loop, hold) in enumerate(sheets):
        sheet = Image.open(os.path.join(sdir, fname)).convert("RGBA")
        if sheet.size != (n * src_cell, src_cell):
            raise SystemExit(f"{fname}: tamaño {sheet.size}, se esperaba {(n * src_cell, src_cell)}")
        frames = []
        for i in range(n):
            fr = sheet.crop((i * src_cell, 0, (i + 1) * src_cell, src_cell))
            b0 = bbox(fr)                          # alfa > THR: sin el polvo casi transparente bajo los pies
            bottoms.append(b0[3])
            sm = fr.resize((out_cell, out_cell), Image.LANCZOS)   # Pillow premultiplica el alfa al reescalar RGBA
            idx = r * cols + i
            out.alpha_composite(sm, ((idx % cols) * out_cell, (idx // cols) * out_cell))
            frames.append(idx)
        clip_frames[clip] = frames
        k += n
    feet = statistics.median_low(bottoms)          # borde inferior (exclusivo) de la silueta en la celda fuente
    anchor_y = round(feet / src_cell, 6)

    data = png_bytes(out)
    fname_out = f"{cid}_poses_extra.png"
    write_bytes(os.path.join(cdir, fname_out), data)

    cd["atlases"]["poses_extra"] = {
        "file": fname_out, "columns": cols, "rows": rows,
        "cell": {"w": out_cell, "h": out_cell}, "anchor": {"x": 0.5, "y": anchor_y},
        "sha256": sha256(data),
        "source": (f"{TOOL}: entrega sources/entregas_2026-11-06/{cid}/ (celdas {src_cell}x{src_cell}) reescalada x{s_eff:.5f} "
                   f"= alto del idle del atlas base ({h_atlas} px) / alto del base de la entrega ({h_deliv} px); "
                   f"pie medido en y={feet}/{src_cell}. Arte GENERATIVO con revisión artística pendiente (ver manifest.json de la entrega)."),
    }
    for clip, fname, n, fps, loop, hold in sheets:
        prev = cd["clips"].get(clip)
        c = {"atlas": "poses_extra", "fps": fps, "loop": loop}
        if hold:
            c["hold"] = True
        c["frames"] = clip_frames[clip]
        lines = desc.get(clip, {}).get("descripcion", [])
        c["_doc"] = f"Entrega 2026-11-06 ({fname}). " + " ".join(lines)
        if prev and prev.get("atlas") != "poses_extra":
            c["_prev"] = prev            # lo que había antes, para poder revertir sin adivinar
        elif prev and "_prev" in prev:
            c["_prev"] = prev["_prev"]
        cd["clips"][clip] = c

    # caja de encuadre de la vista previa (pg_frontend.js Preview) para la victoria: l/r/t desde el pie, px del atlas
    if "victory_pose" in clip_frames:
        ax, ay = out_cell * 0.5, anchor_y * out_cell
        l = r = t = 0
        for idx in clip_frames["victory_pose"]:
            b = bbox(cell(out, idx, out_cell, out_cell, cols))
            l, r, t = max(l, ax - b[0]), max(r, b[2] - ax), max(t, ay - b[1])
        cd.setdefault("portrait", {}).setdefault("clipBox", {})["victory_pose"] = {"l": int(math.ceil(l)), "r": int(math.ceil(r)), "t": int(math.ceil(t))}
    save_json(cpath, cd)
    return {"cid": cid, "h_atlas": h_atlas, "h_deliv": h_deliv, "scale": round(s_eff, 5), "cell": out_cell,
            "feet": feet, "anchor_y": anchor_y, "clips": {c: len(f) for c, f in clip_frames.items()}, "notes": notes}


# ------------------------------------------------------------------ 3. El Paisa Sistem
def build_paisa():
    spec = load(p("tools", "specs", "el_paisa_sistem_spec.json"))
    normals = load(p("data", "normals.json"))
    cid = spec["id"]
    C = spec["cell"]
    G = spec["groundY"]
    fdir = p(spec["framesDir"])
    qa = load(p(spec["qaFile"]))
    qa_ground = {e["id"]: e["grounded"] for e in qa.get("new_frames", [])}

    # cuadros por animación, orden alfabético de animación y numérico de cuadro (determinista)
    anims = {}
    for fn in sorted(os.listdir(fdir)):
        if not fn.endswith(".png"):
            continue
        stem = fn[:-4]
        name, num = stem.rsplit("_", 1)
        anims.setdefault(name, []).append((int(num), fn))
    order = []
    for name in sorted(anims):
        lst = sorted(anims[name])
        if [n for n, _ in lst] != list(range(len(lst))):
            raise SystemExit(f"{name}: numeración de cuadros con huecos {[n for n, _ in lst]}")
        for n, fn in lst:
            order.append((name, n, fn))
    if len(order) != qa["checks"]["total_frames"]:
        raise SystemExit(f"cuadros: {len(order)} != QA.json total_frames {qa['checks']['total_frames']}")

    cols = spec["atlasColumns"]
    rows = math.ceil(len(order) / cols)
    atlas = Image.new("RGBA", (cols * C, rows * C), (0, 0, 0, 0))
    index = {}       # anim -> [índice global]
    anchors = []
    frames_img = []
    for k, (name, n, fn) in enumerate(order):
        im = Image.open(os.path.join(fdir, fn)).convert("RGBA")
        if im.size != (C, C):
            raise SystemExit(f"{fn}: {im.size} != {C}x{C}")
        atlas.paste(im, ((k % cols) * C, (k // cols) * C))          # copia exacta (sin reescalar)
        index.setdefault(name, []).append(k)
        frames_img.append(im)
        b = im.getchannel("A").getbbox()
        foot = b[3] - 1                                             # última fila con pie (inclusive)
        key = f"{name}_{n:02d}"
        grounded = qa_ground.get(key, foot >= G)
        if grounded and foot != G:
            WARN.append(f"{key}: en el suelo según QA pero su pie está en y={foot} (suelo {G})")
        ay = G if grounded else foot
        anchors.append({"x": 0.5, "y": round(ay / C, 6)})
    adata = png_bytes(atlas)
    cdir = p("assets", "combat", cid)
    write_bytes(os.path.join(cdir, spec["atlasFile"]), adata)
    save_json(os.path.join(cdir, spec["anchorsFile"]), {"cell": [C, C], "anchors": anchors})

    def gidx(anim, local):
        return index[anim][local]

    # clips
    clips = {}
    for cname, cs in spec["clips"].items():
        if "seq" in cs:
            fr = [gidx(a, i) for a, idxs in cs["seq"] for i in idxs]
        else:
            loc = cs.get("frames", list(range(len(index[cs["anim"]]))))
            fr = [gidx(cs["anim"], i) for i in loc]
        c = {"atlas": "base", "fps": cs["fps"]}
        if "loop" in cs:
            c["loop"] = cs["loop"]
        if cs.get("hold"):
            c["hold"] = True
        c["frames"] = fr
        if cs.get("_doc"):
            c["_doc"] = cs["_doc"]
        clips[cname] = c

    # medidas del cuerpo (idle[0])
    idle_img = frames_img[clips["idle"]["frames"][0]]
    ib = bbox(idle_img)
    body_h = ib[3] - ib[1]
    rs = round(TARGET_H / body_h, 4)

    def anchor_px(gi):
        return anchors[gi]["x"] * C, anchors[gi]["y"] * C

    REACH = max(8, int(round(0.30 * body_h)))      # largo de la extremidad que golpea (puño+antebrazo, pie+espinilla)
    MAXH = int(round(0.40 * body_h))               # data/normals.json _docSanity: la caja mide <= 40% del alto del cuerpo

    def measure(clip_name, local_frames, mode):
        """Caja de golpe MEDIDA en el cuadro de impacto: la extremidad que golpea.
        forward = la punta delantera de la silueta (lo que sobresale del borde frontal del cuadro 0 del clip, a lo
        sumo REACH px desde la punta); up = la punta superior en la mitad frontal (gancho). Si la caja sale más alta
        que MAXH se recorta alrededor de la fila de la punta. Devuelve la caja en px lógicos (relativa al pie) o None."""
        cf = clips[clip_name]["frames"]
        ref = frames_img[cf[0]]
        rb = bbox(ref)
        boxes = []
        for lf in local_frames:
            gi = cf[lf]
            im = frames_img[gi]
            b = bbox(im)
            a = im.getchannel("A").load()
            pts = []
            if mode == "forward":
                xt = max(rb[2], b[2] - REACH)
                pts = [(x, y) for y in range(b[1], b[3]) for x in range(xt, b[2]) if a[x, y] > THR]
                tip = [y for y in range(b[1], b[3]) if a[b[2] - 1, y] > THR]
            elif mode == "up":
                # punta superior de la mitad frontal (el puño del gancho) y una ventana de REACH px alrededor
                top = next(((x, y) for y in range(b[1], b[3]) for x in range(C // 2, b[2]) if a[x, y] > THR), None)
                if top:
                    tx, ty = top
                    pts = [(x, y) for y in range(ty, min(b[3], ty + REACH))
                           for x in range(max(C // 2, tx - REACH // 2), min(b[2], tx + REACH // 2 + 1)) if a[x, y] > THR]
                tip = [top[1]] if top else []
            if not pts:
                WARN.append(f"{clip_name}[{lf}]: sin extensión medible ({mode})")
                continue
            ys = [y for _, y in pts]
            if max(ys) - min(ys) + 1 > MAXH and mode == "forward":
                cy = sum(tip) / len(tip)
                pts = [(x, y) for x, y in pts if abs(y - cy) <= MAXH / 2]
            xs = [x for x, _ in pts]; ys = [y for _, y in pts]
            ax, ay = anchor_px(gi)
            boxes.append(((min(xs) - ax) * rs, (min(ys) - ay) * rs, (max(xs) + 1 - ax) * rs, (max(ys) + 1 - ay) * rs))
        if not boxes:
            return None
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        pad = normals.get("hitboxPad", 4)
        hb = {"x": int(math.floor(x0)) - pad, "y": int(math.floor(y0)) - pad,
              "w": int(math.ceil(x1 - x0)) + 2 * pad, "h": int(math.ceil(y1 - y0)) + 2 * pad}
        # mínimo jugable: una caja muy delgada no conecta nunca (mismo criterio de altura mínima del roster)
        if hb["h"] < 20:
            d = 20 - hb["h"]; hb["y"] -= d // 2; hb["h"] = 20
        if hb["w"] < 16:
            hb["w"] = 16
        return hb

    def impact_check(clip_name, local, mode):
        """El cuadro declarado como impacto debe ser el de mayor extensión (frontal o vertical)."""
        cf = clips[clip_name]["frames"]
        def ext(gi):
            b = bbox(frames_img[gi]); ax, ay = anchor_px(gi)
            return (b[2] - ax) if mode == "forward" else (ay - b[1])
        vals = [ext(g) for g in cf]
        best = max(range(len(vals)), key=lambda i: vals[i])
        if vals[local] < vals[best] - 2:
            WARN.append(f"{clip_name}: impacto declarado [{local}] (ext {vals[local]:.0f}) pero la mayor extensión es [{best}] (ext {vals[best]:.0f})")

    moves = {}
    for mname, ms in spec["moves"].items():
        mv = {}
        cls = ms.get("class")
        if cls:
            K = normals["classes"][cls]
            mv["frames"] = {"startup": K["startup"], "active": K["active"], "recovery": K["recovery"]}
            if "advHit" in K:
                mv["hitstun"] = K["advHit"] + K["active"] - 1 + K["recovery"]
                mv["blockstun"] = K["advBlock"] + K["active"] - 1 + K["recovery"]
            for kk in ("hitstop", "pushHit", "pushBlock"):
                if kk in K:
                    mv[kk] = K[kk]
            if K.get("damage") is not None:
                mv["damage"] = K["damage"]
        for kk, vv in ms.items():
            if kk in ("class", "measure"):
                continue
            mv[kk] = vv
        meas = ms.get("measure")
        if meas:
            hb = measure(ms["clip"], meas["frames"], meas["mode"])
            if hb:
                mv["hitbox"] = hb
            if "activeIdx" in ms:
                impact_check(ms["clip"], ms["activeIdx"][1], meas["mode"])
            mv["_measure"] = f"{TOOL}: caja medida del sprite ({meas['mode']}) en {ms['clip']}{meas['frames']} + {normals.get('hitboxPad', 4)} px; " \
                             + (f"tiempos de data/normals.json clase {cls}; " if cls else "") + "DISEÑO: TODO: VERIFICAR jugando"
        moves[mname] = mv

    # retrato de filiación (HUD) y cajas de vista previa
    hs = int(round(body_h * 0.42))
    top_rows = [y for y in range(ib[1], ib[1] + max(4, body_h // 8))]
    a = idle_img.getchannel("A").load()
    xs = [x for y in top_rows for x in range(C) if a[x, y] > THR]
    hcx = (min(xs) + max(xs)) / 2 if xs else (ib[0] + ib[2]) / 2
    gi0 = clips["idle"]["frames"][0]
    col0, row0 = (gi0 % cols) * C, (gi0 // cols) * C
    head = [int(round(col0 + hcx - hs / 2)), int(row0 + max(0, ib[1] - round(hs * 0.08))), hs, hs]
    body = [col0 + ib[0], row0 + ib[1], ib[2] - ib[0], ib[3] - ib[1]]

    def clipbox(name):
        l = r = t = 0
        for gi in clips[name]["frames"]:
            b = bbox(frames_img[gi]); ax, ay = anchor_px(gi)
            l, r, t = max(l, ax - b[0]), max(r, b[2] - ax), max(t, ay - b[1])
        return {"l": int(math.ceil(l)), "r": int(math.ceil(r)), "t": int(math.ceil(t))}

    cd = {
        "id": cid,
        "displayName": spec["displayName"],
        "source": "Paquete del usuario El_Paisa_Sistem_COMPLETO_216_frames_120x120.zip (216 cuadros 120x120, 39 animaciones; "
                  "sources/entregas_2026-11-06/el_paisa_sistem/). Atlas = copia exacta de los cuadros, sin reescalar.",
        "_generated": f"GENERADO por {TOOL} desde tools/specs/el_paisa_sistem_spec.json: no editar a mano.",
        "_frame_data_status": "DISEÑO — clips elegidos a ojo por nombre y pose del paquete; tiempos de data/normals.json y del roster; "
                              "cajas de golpe medidas del sprite. TODO: VERIFICAR jugando en Android.",
        "theme": spec["theme"],
        "frameSize": {"w": C, "h": C},
        "anchor": {"x": 0.5, "y": round(G / C, 6)},
        "pivot_note": f"bottom_center (60,{G}) según LEEME; los cuadros miran a la DERECHA. Anclas por cuadro en {spec['anchorsFile']}: "
                      "en el aire el ancla va al pie dibujado.",
        "pivotMode": "frame_bottom_center",
        "vida": spec["vida"],
        "renderScale": rs,
        "_renderScaleDoc": f"{TARGET_H} / alto del idle ({body_h} px, alfa > {THR}).",
        "atlases": {"base": {"file": spec["atlasFile"], "columns": cols, "rows": rows,
                             "anchorsFile": spec["anchorsFile"], "anchor": {"x": 0.5, "y": round(G / C, 6)},
                             "sha256": sha256(adata)}},
        "_frameIndex": {name: idxs for name, idxs in sorted(index.items())},
        "style": spec["style"],
        "clips": clips,
        "inputs": spec["inputs"],
        "moves": moves,
        "portrait": {"atlas": "base", "frame": gi0, "head": head, "body": body,
                     "_doc": f"{TOOL}: body = silueta del idle[0] (alfa > {THR}); head = cuadrado de 0.42 x alto centrado en la parte alta.",
                     "clipBox": {"idle": clipbox("idle"), "victory_pose": clipbox("victory_pose")}},
    }
    save_json(os.path.join(cdir, cid + ".char.json"), cd)

    # roster
    rpath = p("data", "roster.json")
    roster = load(rpath)
    entry = {
        "id": cid, "name": spec["displayName"], "dir": f"assets/combat/{cid}/", "char": f"{cid}.char.json", "status": "playable",
        "origen": "paquete del usuario El_Paisa_Sistem_COMPLETO_216_frames_120x120.zip (216 cuadros, sources/entregas_2026-11-06/el_paisa_sistem/); "
                  f"atlas y char.json de {TOOL}",
        "notes": "Personaje NUEVO (2026-11-06). Sin mareo propio (el paquete no trae dizzy: usa el respaldo del motor). "
                 "Frame-data, daños y comandos = DISEÑO, TODO: VERIFICAR jugando. "
                 f"GENERADO por {TOOL} desde tools/specs/el_paisa_sistem_spec.json: no editar a mano.",
        "perfil": {"reo": None, "celda": None, "alias": None, "src": "sin expediente (personaje nuevo del paquete)"},
    }
    chars = roster["characters"]
    pos = next((i for i, c in enumerate(chars) if c["id"] == cid), None)
    if pos is None:
        chars.append(entry)
    else:
        chars[pos] = entry
    save_json(rpath, roster)
    return {"frames": len(order), "anims": len(index), "atlas": atlas.size, "renderScale": rs, "idle_h": body_h,
            "air_frames": sum(1 for a in anchors if a["y"] != round(G / C, 6)),
            "hitboxes": {m: v.get("hitbox") for m, v in moves.items() if v.get("hitbox")}}


# ------------------------------------------------------------------ 4. escenarios
def stages():
    spath = p("data", "stages.json")
    sd = load(spath)
    L = sd["stages"]
    by = {s["id"]: s for s in L}
    new = []
    for sid, name, swatch, src, dst, like in [
        ("oxxo_guadalajara_2", "Oxxo — Guadalajara 2", "#b8322a", "guadalajara_oxxo_2.png", "assets/stages/guadalajara_oxxo_2.png", "oxxo_guadalajara"),
        ("pemex_guadalajara_2", "Pemex — Guadalajara 2", "#1f7a5a", "guadalajara_pemex_2.png", "assets/stages/guadalajara_pemex_2.png", "pemex_guadalajara"),
    ]:
        raw = open(os.path.join(SRC, "escenarios", src), "rb").read()
        im = Image.open(io.BytesIO(raw))
        write_bytes(p(dst), raw)                     # copia byte a byte (arte del usuario intacto)
        base = by[like]
        e = {"id": sid, "name": name, "swatch": swatch,
             "art": {"file": dst, "w": im.width, "h": im.height, "x": -150, "y": 0, "scale": 1,
                     "_doc": f"Fondo de una sola imagen entregado por el usuario el 2026-11-06 (sha256 {sha256(raw)}). "
                             f"{im.width}x{im.height} = mismo formato que puente_grande_exterior (alto de la arena; x=-150 lo centra). "
                             "Suelo de pelea (y=480) sobre el pavimento mojado. Sin halos de luz: no hay medición (tools/build_stage_lights.py)."},
             "theme": dict(base["theme"]),
             "rain": dict(base["rain"]), "wetFloor": dict(base["wetFloor"]),
             "_doc": f"tema, lluvia y piso mojado copiados de '{like}' (mismo lugar). Agregado AL FINAL: las campañas usan índices."}
        new.append(e)
    for e in new:
        i = next((k for k, s in enumerate(L) if s["id"] == e["id"]), None)
        if i is None:
            L.append(e)
        else:
            L[i] = e
    save_json(spath, sd)
    return [(e["id"], L.index(e)) for e in new]


# ------------------------------------------------------------------ 5. lista offline
def offline():
    out = []
    for r, _, fs in os.walk(p("assets")):
        for f in fs:
            rp = rel(os.path.join(r, f))
            if rp.startswith("assets/icons/") or rp.endswith(".txt"):
                continue
            out.append(rp)
    out.sort()
    save_json(p("data", "offline_assets.json"), out)
    return len(out)


def main():
    info = {}
    info["wasirris"] = poses_extra("wasirris", [
        ("ko_fall", "wasirris__ko_fall.png", 8, 10, False, True),
        ("dizzy", "wasirris__dizzy.png", 8, 8, True, False),
        ("victory_pose", "wasirris__victory_pose.png", 8, 8, False, False),
    ], "dizzy, ko_fall y victory_pose nuevos")
    info["personaje_08"] = poses_extra("personaje_08", [
        ("ko_fall", "personaje_08__ko_fall.png", 8, 10, False, True),
        ("victory_pose", "personaje_08__victory_pose.png", 8, 8, False, False),
    ], "ko_fall y victory_pose nuevos; dizzy pendiente (no entregado)")
    info["el_paisa_sistem"] = build_paisa()
    info["stages"] = stages()
    info["offline_assets"] = offline()
    print(json.dumps(info, ensure_ascii=False, indent=1))
    for w in WARN:
        print("AVISO:", w)
    if CHECK:
        print("desactualizados:" if CHANGED else "todo al día", *CHANGED)
        sys.exit(1 if CHANGED else 0)
    print("escritos:", len(CHANGED), *CHANGED, sep="\n  ")


if __name__ == "__main__":
    main()
