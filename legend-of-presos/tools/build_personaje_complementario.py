#!/usr/bin/env python3
"""Personaje NUEVO del ZIP ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO (entrega del usuario 2026-11-13). Idempotente.
Uso (desde legend-of-presos/):  python3 -I tools/build_personaje_complementario.py [--check]

El usuario confirmó que es un personaje nuevo pero NO dio su nombre: entra como PROVISIONAL (`provisional: true` en el
roster: se puede elegir, pero no sale como rival automático) con nombre de relleno. TODO: VERIFICAR nombre, ficha y lugar
en la historia con el usuario.

Qué hace: arma assets/combat/<id>/<id>_atlas.png con los cuadros que usa (celdas 192, igual que la fuente), genera el
char.json (clips, golpes, comandos, retrato) y lo da de alta al final de data/roster.json.
 - Cajas de golpe: MEDIDAS del sprite en el cuadro de impacto (mismo método que El Paisa en integrar_entregas_20261106.py:
   lo que sobresale del borde frontal del primer cuadro del clip, a lo sumo 30 % del alto del cuerpo, más hitboxPad).
 - Tiempos: clases de data/normals.json (jab, kick, patada_fuerte, aire_k). Daños/tiempos de especiales = DISEÑO copiado
   del rango del roster. TODO: VERIFICAR jugando.
 - Cuadros en el aire: la fuente los dibuja elevados dentro de la celda; se bajan al pie para no sumar dos veces la altura
   (la física del motor ya sube al luchador).
 - Sin cuadros propios = movimiento desactivado: NO tiene puño fuerte (solo hay una pose de puño), puño aéreo, agarre ni
   mareo (usa el respaldo del motor). El propio LEEME de la fuente avisa que 155 de los 165 cuadros son generados y que el
   aura morada viene pegada al cuerpo: aquí solo se usa en el súper, donde el aura ES el ataque.
Los nombres de los golpes son genéricos (no se inventaron nombres propios).
"""
import hashlib, io, json, math, os, sys, zipfile
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC_ZIP = os.path.join(ROOT, "sources/entregas_2026-11-13/ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO.zip")
SRC_SHA = "1c56b85dca4bf99f7f8ba9473c560506a735a9f6109b49654e50bacc71b460c5"
PRE = "ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO/"
CID = "personaje_complementario"
NAME = "Nuevo (sin nombre)"
TOOL = "tools/build_personaje_complementario.py"
C, COLS, THR, TARGET_H = 192, 10, 40, 150

B = lambda n: ("base_" + n, 0)
def A(anim, *idx): return [(anim, i) for i in idx]

# clip -> (cuadros [(animación de la fuente, índice)], fps, banderas)
CLIPS = {
    "idle":          (A("idle_extra", 0, 1, 2, 3, 4), 6, {"loop": True}),
    "walk":          (A("walk", 0, 1, 2, 3, 4, 5, 6), 10, {"loop": True}),
    "run":           (A("run", 0, 1, 2, 3, 4), 12, {"loop": True}),
    "crouch_guard":  (A("crouch", 2, 3), 8, {"loop": False, "hold": True}),
    "jump_mobility": (A("jump_cycle", 2, 3, 4, 5, 6, 7, 8, 9), 12, {"loop": False, "hold": True}),
    "hurt":          (A("hit_reaction", 1, 2, 3), 10, {"hold": True}),
    "damage_fall":   (A("hit_reaction", 4, 5, 6, 7, 8), 10, {"loop": False}),
    "down":          (A("hit_reaction", 9), 10, {"hold": True, "lying": True}),
    "recovery_pose": (A("knockdown_getup", 6, 7, 8, 9, 10), 16, {"loop": False}),
    "ko_fall":       (A("hit_reaction", 3, 4, 5, 6, 7, 8, 9), 10, {"loop": False, "hold": True}),
    "victory_pose":  (A("taunt_victory", 8, 9, 10, 11, 12), 8, {"loop": False, "hold": True}),
    "atk_light":     (A("standing_guard", 2) + [B("punch")] + A("standing_guard", 0), 14, {"loop": False}),
    "atk_kick":      (A("kick_combo", 1, 2, 3, 6, 7), 14, {"loop": False}),
    "atk_hkick":     (A("kick_combo", 2, 3, 4) + [B("kick")] + A("kick_combo", 9, 10), 14, {"loop": False}),
    "atk_airk":      (A("jump_cycle", 5) + [B("air_knee")] + A("jump_cycle", 8), 14, {"loop": False}),
    "atk_dash":      (A("rush_attack", 2, 3, 4, 5, 6, 7), 12, {"loop": False}),
    "atk_sweep":     (A("low_sweep", 1, 2, 3, 4, 5, 6), 12, {"loop": False}),
    "atk_super":     (A("energy_charge", 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), 12, {"loop": False}),
}
AIR_CLIPS = ("jump_mobility", "atk_airk")
CANCEL_SP = ["embestida", "barrida", "super"]
# move -> datos de DISEÑO; "cls" = clase de data/normals.json; "hit" = índices del clip que muestran el impacto
MOVES = {
    "punch":      {"clip": "atk_light", "cls": "jab", "hit": [1, 1], "damage": 12, "guardType": "high", "name": "Puño",
                   "cancelInto": ["kick", "heavy_kick"] + CANCEL_SP},
    "kick":       {"clip": "atk_kick", "cls": "kick", "hit": [3, 3], "damage": 16, "guardType": "high", "name": "Patada",
                   "cancelInto": ["heavy_kick"] + CANCEL_SP},
    "heavy_kick": {"clip": "atk_hkick", "cls": "patada_fuerte", "hit": [3, 3], "guardType": "high", "name": "Patada alta",
                   "cancelInto": CANCEL_SP},
    "j_kick":     {"clip": "atk_airk", "cls": "aire_k", "hit": [1, 1], "damage": 14, "guardType": "overhead", "air": True,
                   "name": "Rodilla aérea", "extra": {"hitstun": 15, "blockstun": 10, "hitstop": 6, "pushHit": 3, "pushBlock": 3}},
    "embestida":  {"clip": "atk_dash", "hit": [3, 4], "guardType": "high", "name": "Embestida", "raw": {
                   "frames": {"startup": 10, "active": 5, "recovery": 18}, "hitstun": 22, "blockstun": 14, "damage": 22, "hitstop": 9,
                   "pushHit": 6, "pushBlock": 4, "advance": 6, "advanceFrames": [1, 3], "special": True, "meterCost": 0,
                   "cancelFrames": [11, 18], "cancelInto": ["super"]}},
    "barrida":    {"clip": "atk_sweep", "hit": [2, 3], "guardType": "low", "name": "Barrida", "raw": {
                   "frames": {"startup": 9, "active": 4, "recovery": 20}, "hitstun": 18, "blockstun": 12, "damage": 18, "hitstop": 8,
                   "pushHit": 4, "pushBlock": 3, "pushY": -4, "knockdown": True, "special": True, "meterCost": 0,
                   "cancelFrames": [10, 16], "cancelInto": ["super"]}},
    "super":      {"clip": "atk_super", "hit": [6, 8], "guardType": "high", "name": "Descarga", "aura": True, "raw": {
                   "frames": {"startup": 26, "active": 14, "recovery": 24}, "hitstun": 24, "blockstun": 19, "damage": 55, "hitstop": 14,
                   "pushHit": 8, "pushBlock": 3, "pushY": -11, "launcher": True, "invuln": True, "invulnFrames": 26, "super": True,
                   "meterCost": 100, "cinematic": {"kind": "super", "zoom": 1.85, "freeze": 46, "dur": 74}}},
}
INPUTS = {"grounded": {"punch": "punch", "kick": "kick"}, "air": {"kick": "j_kick"}, "forward": {"kick": "heavy_kick"},
          "specials": [{"motion": "qcf", "button": "punch", "move": "embestida"}, {"motion": "qcb", "button": "kick", "move": "barrida"}],
          "supers": [{"motion": "qcf2", "button": "punch", "move": "super"}], "hidden": []}


def sha256b(b): return hashlib.sha256(b).hexdigest()
def bbox(im):
    a = np.array(im.getchannel("A")) > THR; ys = np.nonzero(a.any(1))[0]; xs = np.nonzero(a.any(0))[0]
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(ys) else None


def build():
    raw = open(SRC_ZIP, "rb").read()
    if sha256b(raw) != SRC_SHA: sys.exit("la fuente no coincide con su SHA-256")
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        meta = json.loads(z.read(PRE + "atlas_maestro_2d.json")); src = Image.open(io.BytesIO(z.read(PRE + "atlas_maestro_2d.png"))).convert("RGBA")
    normals = json.load(open(os.path.join(ROOT, "data/normals.json"), encoding="utf-8"))
    keys = []
    for cname, (frs, _, _) in CLIPS.items():
        for k in frs:
            kk = (k, cname in AIR_CLIPS)
            if kk not in keys: keys.append(kk)
    def src_frame(k):
        f = meta["frames"][meta["animations"][k[0]][k[1]]]["frame"]; return src.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    ground = bbox(src_frame(CLIPS["idle"][0][0]))[3]            # fila del pie en la fuente (idle)
    imgs = []
    for (k, air) in keys:
        im = src_frame(k)
        if air:                                                # cuadro en el aire: se baja al pie
            b = bbox(im); dy = ground - b[3]
            if dy: t = Image.new("RGBA", (C, C), (0, 0, 0, 0)); t.alpha_composite(im.crop((0, 0, C, C - max(0, dy))), (0, max(0, dy))); im = t
        imgs.append(im)
    idx = {kk: i for i, kk in enumerate(keys)}
    rows = (len(keys) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * C, rows * C), (0, 0, 0, 0))
    for i, im in enumerate(imgs): atlas.paste(im, ((i % COLS) * C, (i // COLS) * C))
    clips = {}
    for cname, (frs, fps, flags) in CLIPS.items():
        c = {"atlas": "base", "fps": fps}; c.update(flags); c["frames"] = [idx[(k, cname in AIR_CLIPS)] for k in frs]
        c["_src"] = ["%s[%d]" % k for k in frs]; clips[cname] = c
    ib = bbox(imgs[clips["idle"]["frames"][0]]); body_h = ib[3] - ib[1]; rs = round(TARGET_H / body_h, 4)
    AX, AY = C / 2, ground
    REACH = max(8, int(round(0.30 * body_h))); MAXH = int(round(0.40 * body_h)); pad = normals.get("hitboxPad", 4); warn = []

    def measure(clip, hit, aura):
        cf = clips[clip]["frames"]; rb = bbox(imgs[cf[0]]); boxes = []
        for lf in range(hit[0], hit[1] + 1):
            im = imgs[cf[lf]]; b = bbox(im); a = np.array(im.getchannel("A")) > THR
            if aura: x0, y0, x1, y1 = int(AX), b[1], b[2], b[3]              # el aura entera, del centro hacia el frente
            else:
                xt = max(rb[2], b[2] - REACH); sub = a[b[1]:b[3], xt:b[2]]; ys, xs = np.nonzero(sub)
                if not len(ys):      # no sobresale del cuadro previo (rodilla aérea): franja frontal del propio cuadro
                    warn.append("%s[%d]: no sobresale del cuadro 0; caja = franja frontal de %d px" % (clip, lf, REACH))
                    xt = b[2] - REACH; sub = a[b[1]:b[3], xt:b[2]]; ys, xs = np.nonzero(sub)
                ys = ys + b[1]; xs = xs + xt
                if ys.max() - ys.min() + 1 > MAXH:
                    tip = np.nonzero(a[b[1]:b[3], b[2] - 1])[0] + b[1]; cy = tip.mean(); keep = np.abs(ys - cy) <= MAXH / 2; ys, xs = ys[keep], xs[keep]
                x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            boxes.append(((x0 - AX) * rs, (y0 - AY) * rs, (x1 - AX) * rs, (y1 - AY) * rs))
        if not boxes: return None
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes); x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        hb = {"x": int(math.floor(x0)) - pad, "y": int(math.floor(y0)) - pad, "w": int(math.ceil(x1 - x0)) + 2 * pad, "h": int(math.ceil(y1 - y0)) + 2 * pad}
        if hb["h"] < 20: d = 20 - hb["h"]; hb["y"] -= d // 2; hb["h"] = 20
        if hb["w"] < 16: hb["w"] = 16
        return hb

    moves = {}
    for mname, ms in MOVES.items():
        mv = {}
        if ms.get("cls"):
            K = normals["classes"][ms["cls"]]; mv["frames"] = {"startup": K["startup"], "active": K["active"], "recovery": K["recovery"]}
            if "advHit" in K:
                mv["hitstun"] = K["advHit"] + K["active"] - 1 + K["recovery"]; mv["blockstun"] = K["advBlock"] + K["active"] - 1 + K["recovery"]
                mv["cancelFrames"] = [K["startup"] + 1, K["startup"] + K["active"] + 2]
            for kk in ("hitstop", "pushHit", "pushBlock"):
                if K.get(kk) is not None: mv[kk] = K[kk]
            mv["damage"] = ms.get("damage", K.get("damage")); mv["pushY"] = 0
            if ms.get("cancelInto"): mv["cancelInto"] = ms["cancelInto"]
            if ms.get("air"): mv["air"] = True; mv.pop("cancelFrames", None)
            mv.update(ms.get("extra", {}))
        else:
            mv.update(json.loads(json.dumps(ms["raw"]))); mv.setdefault("pushY", 0)
        mv.update({"clip": ms["clip"], "activeIdx": ms["hit"], "guardType": ms["guardType"], "name": ms["name"], "nameSrc": "generico"})
        hb = measure(ms["clip"], ms["hit"], ms.get("aura"))
        if hb is None: sys.exit("no se pudo medir la caja de " + mname)
        mv["hitbox"] = hb
        mv["_measure"] = "%s: caja medida del sprite en %s%s + %d px; tiempos/daño = DISEÑO (TODO: VERIFICAR jugando)" % (TOOL, ms["clip"], ms["hit"], pad)
        moves[mname] = mv
    head = int(round(0.42 * body_h)); hx = int(round((ib[0] + ib[2]) / 2 - head / 2)); i0 = clips["idle"]["frames"][0]; ox, oy = (i0 % COLS) * C, (i0 // COLS) * C
    char = {
        "id": CID, "displayName": NAME,
        "source": "ZIP del usuario ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO (sources/entregas_2026-11-13/, sha256 %s): 165 cuadros 192x192 "
                  "(10 de la imagen original + 155 generados, según su LEEME). Atlas = copia de los cuadros usados, sin reescalar." % SRC_SHA,
        "_generated": "GENERADO por %s: no editar a mano." % TOOL,
        "_frame_data_status": "PROVISIONAL: nombre de relleno (el usuario no lo dio), golpes con nombres genéricos, tiempos y daños de DISEÑO. "
                              "Sin puño fuerte, puño aéreo, agarre ni mareo propios (la fuente no trae esos cuadros). TODO: VERIFICAR.",
        "frameSize": {"w": C, "h": C}, "anchor": {"x": 0.5, "y": round(AY / C, 6)},
        "pivot_note": "bottom_center según el LEEME; pie MEDIDO en idle (fila %d de %d). Cuadros en el aire bajados al pie." % (ground, C),
        "pivotMode": "frame_bottom_center", "vida": 1000, "renderScale": rs,
        "_renderScaleDoc": "alto del idle %d px -> %d px lógicos" % (body_h, TARGET_H),
        "atlases": {"base": {"file": CID + "_atlas.png", "columns": COLS, "rows": rows, "anchor": {"x": 0.5, "y": round(AY / C, 6)}}},
        "style": {"walk": 2.4, "run": 4.4, "jumpNormal": -15, "jumpHigh": -18.5, "airMove": 1.9},
        "clips": clips, "inputs": INPUTS, "moves": moves,
        "portrait": {"atlas": "base", "frame": i0, "head": [ox + hx, oy + ib[1], head, head], "body": [ox + ib[0], oy + ib[1], ib[2] - ib[0], body_h],
                     "_doc": "%s: body = silueta del idle[0]; head = cuadrado de 0.42 x alto en la parte alta." % TOOL},
    }
    return atlas, char, warn


def main():
    check = "--check" in sys.argv
    atlas, char, warn = build()
    cdir = os.path.join(ROOT, "assets/combat", CID); os.makedirs(cdir, exist_ok=True)
    png = os.path.join(cdir, CID + "_atlas.png"); cj = os.path.join(cdir, CID + ".char.json"); rp = os.path.join(ROOT, "data/roster.json")
    old = open(png, "rb").read() if os.path.exists(png) else None
    same = old is not None and Image.open(io.BytesIO(old)).size == atlas.size and Image.open(io.BytesIO(old)).convert("RGBA").tobytes() == atlas.tobytes()
    if same: data = old
    else: buf = io.BytesIO(); atlas.save(buf, "PNG", optimize=True); data = buf.getvalue()
    char["atlases"]["base"]["sha256"] = sha256b(data)
    ctxt = json.dumps(char, ensure_ascii=False, indent=2) + "\n"
    rtxt0 = open(rp, encoding="utf-8").read(); R = json.loads(rtxt0)
    entry = {"id": CID, "name": NAME, "dir": "assets/combat/%s/" % CID, "char": CID + ".char.json", "status": "playable", "provisional": True,
             "origen": "ZIP del usuario ATLAS_MAESTRO_PERSONAJE_COMPLEMENTARIO (sources/entregas_2026-11-13/); atlas y char.json de " + TOOL,
             "notes": "Personaje NUEVO (2026-11-13), PROVISIONAL: el usuario confirmó que es nuevo pero falta su NOMBRE, ficha y lugar en la historia "
                      "(TODO: VERIFICAR). Se puede elegir; no sale como rival automático. Frame-data y daños = DISEÑO. GENERADO por %s: no editar a mano." % TOOL,
             "perfil": {"reo": None, "celda": None, "alias": None, "src": "sin expediente (personaje nuevo, sin nombre todavía)"}}
    R["characters"] = [c for c in R["characters"] if c["id"] != CID] + [entry]
    ind = 1 if json.dumps(json.loads(rtxt0), ensure_ascii=False, indent=1) + "\n" == rtxt0 else 2
    rtxt = json.dumps(R, ensure_ascii=False, indent=ind) + "\n"
    for w in warn: print("AVISO:", w)
    old_c = open(cj, encoding="utf-8").read() if os.path.exists(cj) else None
    if check:
        ok = same and old_c == ctxt and json.loads(rtxt) == json.loads(rtxt0); print("al día" if ok else "DESACTUALIZADO"); sys.exit(0 if ok else 1)
    if not same: open(png, "wb").write(data)
    if old_c != ctxt: open(cj, "w", encoding="utf-8").write(ctxt)
    if json.loads(rtxt) != json.loads(rtxt0): open(rp, "w", encoding="utf-8").write(rtxt)
    print("%s: atlas %s, %d clips, renderScale %s" % (CID, atlas.size, len(char["clips"]), char["renderScale"]))
    for k, m in char["moves"].items(): print("  %-11s %-10s impacto %s caja %s" % (k, m["clip"], m["activeIdx"], m["hitbox"]))


if __name__ == "__main__":
    main()
