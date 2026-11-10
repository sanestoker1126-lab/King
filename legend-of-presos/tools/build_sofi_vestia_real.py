#!/usr/bin/env python3
"""Moveset REAL del Modo Vestía de Sofi desde el atlas que entregó el usuario el 2026-11-08. Idempotente.
Uso (desde la raíz):  python3 -I tools/build_sofi_vestia_real.py [--check]

Fuente: sources/entregas_2026-11-08/POCHECHE_ATLAS_MASTER_GAME_READY.zip. El nombre dice "POCHECHE" pero el usuario
aclaró que es Sofi en Modo Vestía ("solo que está equivocado el nombre"); a ojo: cuernos, diadema, traje negro con rojo, garras.
Trae 103 frames (celdas 256, pivote abajo-centro) en secuencias walk_ref/walk/run/dash/jump/guard/hurt/fall/fall_back/get_up/
kick/claw_attack/claw_special/special_motion/transform_charge/recover_special.

Problemas del atlas fuente que este script corrige (medidos, ver docs/CHANGELOG.md 2026-11-08):
 1) CADA frame venía escalado a 220 px de alto (content.scale distinto por frame): una pose agachada salía tan alta como
    una de pie. Se deshace con su propio content.scale: alto real ∝ 1/scale, y se re-escala con UNA referencia de pie por
    secuencia (REF) -> todas quedan a la escala de la Sofi base (112 px de pie en el atlas, igual que sofi_atlas.png).
    Comprobación: la guardia agachada queda en ~88 px (la base mide 87).
 2) hurt y kick (hoja 'secuencia_de_combate_gótico_anime') traen fondo BLANCO atrapado entre las piernas y entre mechones:
    se borran los componentes casi blancos (y su borde antialias) solo en esas dos secuencias.
 3) El pivote de la fuente es el centro de la caja: en una patada la caja se ensancha y el cuerpo "brincaba". Aquí el ancla
    horizontal son las BOTAS (píxeles oscuros de la franja inferior): el pie de apoyo no patina entre frames.

Además arma las CHISPAS DE IMPACTO del Modo Vestía con los 43 FX morado/carmesí del mismo ZIP (assets/fx/sofi_vestia_fx.webp,
entradas sofi_vestia_fx / vestia_* en data/fx_library.json, y hitAnimVestia en los moves; ver FX_ANIMS / HIT_VESTIA).

Los clips *_vestia son SOLO de dibujo (el render los usa cuando f.transformed): cada uno conserva el número de frames y los
fps del clip base, así el frame activo dibujado cae en los mismos ticks que el golpe de la simulación (determinismo intacto).
La asignación pose->golpe es decisión de integración (TODO: VERIFICAR con el usuario): el golpe BAJO (embestida_cuernos)
usa el barrido deslizante para que se lea bajo; los altos usan poses de pie.
"""
import hashlib, io, json, os, sys, zipfile
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC_ZIP = os.path.join(ROOT, "sources/entregas_2026-11-08/POCHECHE_ATLAS_MASTER_GAME_READY.zip")
SRC_SHA = "128671ee7daa8a3dc5899fef528e6f027a24153bb5c9f5d7ef10f60c2f9246ba"
CHAR = os.path.join(ROOT, "assets/combat/sofi/sofi.char.json")
OUT_NAME = "sofi_vestia_real.png"
OUT = os.path.join(ROOT, "assets/combat/sofi", OUT_NAME)
OLD_RECOLOR = os.path.join(ROOT, "assets/combat/sofi/sofi_vestia_moveset.png")   # recoloreado provisional que esto reemplaza

STAND_SRC, STAND_DST = 220.0, 112.0     # alto de pie en la fuente (normalizado) -> alto de pie de la Sofi base en su atlas
CELL, COLS = 176, 8
FOOT_ROW = CELL - 7                     # última fila de la figura (la base: 137 de 144 -> ancla 138/144)
ANCHOR_Y = (CELL - 6) / CELL

# referencia de pie por secuencia: frame(s) cuya escala define el "alto de pie" de esa fila de la hoja fuente
REF = {
    "walk_ref": ["walk_ref_00", "walk_ref_01", "walk_ref_02", "walk_ref_03", "walk_ref_04", "walk_ref_05", "walk_ref_06", "walk_ref_07"],
    "claw_attack": ["claw_attack_00"],
    "kick": ["kick_00"], "hurt": ["kick_00"],                      # misma hoja fuente
    "walk": ["walk_00", "walk_01", "walk_02", "walk_03"],
    "run": ["walk_00", "walk_01", "walk_02", "walk_03"], "dash": ["walk_00", "walk_01", "walk_02", "walk_03"],
    "jump": ["walk_00", "walk_01", "walk_02", "walk_03"], "fall_back": ["walk_00", "walk_01", "walk_02", "walk_03"],
    "get_up": ["walk_00", "walk_01", "walk_02", "walk_03"], "guard": ["walk_00", "walk_01", "walk_02", "walk_03"],
    "special_motion": ["special_motion_03"], "claw_special": ["claw_special_00"],
    "recover_special": ["recover_special_07"], "transform_charge": ["transform_charge_00"],
}
WHITE_FIX = {"hurt", "kick"}

# clip base -> frames de la fuente (mismo número de frames y fps que el clip base; ver docstring)
MAP = {
    "idle":          ["recover_special_07"],                                   # guardia de pelea de pie
    "walk":          ["walk_ref_%02d" % i for i in range(8)],                   # ciclo (en bucle no hay que sincronizar)
    "run":           ["run_00", "run_01", "run_02", "run_03"],
    "crouch_guard":  ["recover_special_10"],                                   # guardia agachada (la base también)
    "jump_mobility": ["jump_02", "jump_03"],
    "damage_fall":   ["fall_back_00", "fall_back_01", "fall_back_02", "fall_back_03"],
    "hurt":          ["hurt_00", "hurt_01"],
    "down":          ["get_up_00"],
    "recovery_pose": ["get_up_01", "get_up_02", "get_up_03"],
    "victory_pose":  ["transform_charge_08"],
    "atk_light":     ["claw_attack_01", "claw_attack_03", "claw_attack_00"],
    "atk_heavy":     ["claw_attack_00", "claw_attack_01", "claw_attack_03", "claw_attack_02"],
    "atk_kick":      ["kick_00", "kick_01", "kick_02", "kick_03"],
    "atk_kick2":     ["claw_special_04", "claw_special_05", "claw_special_06", "claw_special_07"],
    "atk_sp1":       ["special_motion_06", "claw_special_09", "claw_special_10", "claw_special_11"],   # embestida (BAJO)
    "atk_sp2":       ["claw_special_01", "claw_special_02", "claw_special_03", "claw_special_04"],     # estrella de caramelo
    "atk_sp3":       ["dash_00", "dash_01", "dash_02", "dash_03"],                                     # empuje (embestida de frente)
    "atk_sp4":       ["claw_attack_02", "claw_attack_03"],                                             # giro de listón (ráfaga)
    "atk_super":     ["transform_charge_03", "transform_charge_04", "transform_charge_06", "transform_charge_07"],
}
# fps propios donde el clip base es demasiado entrecortado y el clip va en bucle o es de solo pose (no afecta golpes)
FPS = {"walk": 12, "hurt": 20}

# ---- CHISPAS DE IMPACTO del Modo Vestía (los 43 FX morado/carmesí del mismo ZIP: POCHECHE_FX_PURPURA_CARMESI) ----
# Son efectos sueltos de UNA hoja fuente (no animaciones armadas): aquí se agrupan en anims cortas. Cada frame venía
# re-escalado a su caja (content.scale): se restaura su tamaño relativo (alto real ∝ alto/scale) y la anim se escala para
# que su frame más alto mida `h` px lógicos. Se dibujan con el sistema de hitsparks de siempre (data/fx_library.json).
FX_PAGE_NAME = "sofi_vestia_fx.webp"
FX_PAGE = os.path.join(ROOT, "assets/fx", FX_PAGE_NAME)
FX_LIB = os.path.join(ROOT, "data/fx_library.json")
FX_LIB_ID = "sofi_vestia_fx"
FX_ANIMS = {   # id -> índices del atlas FX fuente (fx_claw_purple_crimson_NN), fps, alto lógico
    "vestia_impacto":   {"frames": [25, 26],                     "fps": 30, "h": 80},    # estallido en estrella
    "vestia_zarpazo":   {"frames": [0, 1, 2, 3, 4],              "fps": 30, "h": 100},   # arco de zarpazo
    "vestia_garras":    {"frames": [8, 9, 10, 12],               "fps": 24, "h": 110},   # marcas de tres garras
    "vestia_cruz":      {"frames": [5, 6, 7],                    "fps": 24, "h": 100},   # corte circular -> en X -> anillo
    "vestia_barrido":   {"frames": [17, 18, 19, 20],             "fps": 24, "h": 70},    # barrido al ras del piso (golpe bajo)
    "vestia_estallido": {"frames": [21, 22, 23, 24, 27, 28],     "fps": 20, "h": 150},   # estallido del súper
}
# golpe -> chispa cuando Sofi YA está transformada (hitAnimVestia; la simulación solo la elige si att.transformed)
HIT_VESTIA = {
    "punch": "vestia_zarpazo", "heavy_punch": "vestia_garras", "kick": "vestia_impacto", "heavy_kick": "vestia_cruz",
    "estrella_caramelo": "vestia_zarpazo", "embestida_cuernos": "vestia_barrido", "empuje_navideno": "vestia_garras",
    "giro_liston": "vestia_zarpazo", "super_festiva": "vestia_estallido",
}
# la propia transformación (modo_vestia) golpea ANTES de quedar transformada: lleva su chispa como hitAnim normal
HIT_ALWAYS = {"modo_vestia": "vestia_garras"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def load_source():
    if not os.path.exists(SRC_ZIP): sys.exit("falta la fuente " + os.path.relpath(SRC_ZIP, ROOT))
    if sha256(SRC_ZIP) != SRC_SHA: sys.exit("la fuente no coincide con su SHA-256 registrado")
    with zipfile.ZipFile(SRC_ZIP) as z:
        meta = json.loads(z.read("pocheche_atlas_master/POCHECHE_ATLAS_MASTER.json"))
        img = Image.open(io.BytesIO(z.read("pocheche_atlas_master/POCHECHE_ATLAS_MASTER.png"))).convert("RGBA")
    return meta, img


def components(mask):
    """etiquetas 4-conexas (sin scipy)."""
    h, w = mask.shape; lbl = np.zeros((h, w), np.int32); n = 0; sizes = [0]
    for sy, sx in zip(*np.nonzero(mask)):
        if lbl[sy, sx]: continue
        n += 1; st = [(sy, sx)]; lbl[sy, sx] = n; c = 0
        while st:
            y, x = st.pop(); c += 1
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lbl[ny, nx]: lbl[ny, nx] = n; st.append((ny, nx))
        sizes.append(c)
    return lbl, sizes


def dilate(m, it=1):
    for _ in range(it):
        p = np.pad(m, 1); m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return m


def fix_white(im):
    """borra el fondo blanco atrapado (hurt/kick): componentes casi blancos de >=6 px + 1 px de su borde antialias claro."""
    a = np.array(im).astype(np.int32); rgb = a[:, :, :3]; A = a[:, :, 3]
    lum = rgb.mean(2); sat = rgb.max(2) - rgb.min(2)
    white = (A > 0) & (lum > 232) & (sat < 26)
    lbl, sizes = components(white)
    big = np.isin(lbl, [i for i in range(1, len(sizes)) if sizes[i] >= 6])
    halo = dilate(big, 1) & (lum > 185) & (sat < 40)
    A = np.where(big | halo, 0, A)
    a[:, :, 3] = A
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def frame_image(meta, img, name):
    f = meta["frames"][name]; c = f["content"]
    x0, y0 = f["frame"]["x"] + c["x"], f["frame"]["y"] + c["y"]
    im = img.crop((x0, y0, x0 + c["w"], y0 + c["h"]))
    if f["sequence"] in WHITE_FIX: im = fix_white(im)
    # el recorte de la fuente nunca llega a alfa 255 en varias hojas (cuerpo ~247-252): se escala para que el cuerpo
    # quede opaco (factor 1.01-1.03; bordes, pelo y brillos conservan su suavidad relativa)
    a = np.array(im).astype(np.float64); body = a[:, :, 3][a[:, :, 3] >= 150]
    if len(body):
        med = float(np.median(body))
        if med < 254: a[:, :, 3] = np.minimum(255, np.round(a[:, :, 3] * 255.0 / med))
    im = Image.fromarray(a.astype(np.uint8), "RGBA")
    refs = REF[f["sequence"]]
    s_ref = sorted(meta["frames"][r]["content"]["scale"] for r in refs)[len(refs) // 2]
    k = (s_ref / c["scale"]) * (STAND_DST / STAND_SRC)
    nw, nh = max(1, round(c["w"] * k)), max(1, round(c["h"] * k))
    im = im.convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")   # premultiplicado: sin halos oscuros
    a = np.array(im); A = a[:, :, 3]
    a[A < 8, 3] = 0                                                           # polvo de alfa del remuestreo
    im = Image.fromarray(a, "RGBA")
    return im, k


def feet_x(im):
    """centro horizontal de las botas (oscuras) en la franja inferior; respaldo: centro de lo opaco de esa franja."""
    a = np.array(im).astype(np.int32); A = a[:, :, 3]; lum = a[:, :, :3].mean(2)
    ys = np.nonzero(A.max(1) > 160)[0]
    if not len(ys): return im.width / 2
    bot = ys.max(); band = max(3, int(round((bot - ys.min() + 1) * 0.07)))
    rows = slice(bot - band + 1, bot + 1)
    m = (A[rows] > 160) & (lum[rows] < 110)
    if m.sum() < 4: m = A[rows] > 160
    xs = np.nonzero(m.any(0))[0]
    return (xs.min() + xs.max() + 1) / 2 if len(xs) else im.width / 2


def build():
    meta, img = load_source()
    names = []
    for clip in MAP:
        for n in MAP[clip]:
            if n not in meta["frames"]: sys.exit("el atlas fuente no tiene el frame " + n)
            if n not in names: names.append(n)
    rows = (len(names) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    info = {}
    for i, n in enumerate(names):
        im, k = frame_image(meta, img, n)
        bb = im.getchannel("A").getbbox()
        if bb: im = im.crop(bb)
        fx = feet_x(im)
        x = int(round(CELL / 2 - fx)); y = FOOT_ROW + 1 - im.height
        cv = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0)); cv.alpha_composite(im, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))
        clipped = x < 0 or y < 0 or x + im.width > CELL
        atlas.paste(cv, ((i % COLS) * CELL, (i // COLS) * CELL))
        info[n] = {"idx": i, "w": im.width, "h": im.height, "k": round(k, 4), "clipped": clipped}
    return atlas, names, info


def load_fx_source():
    with zipfile.ZipFile(SRC_ZIP) as z:
        meta = json.loads(z.read("pocheche_atlas_master/POCHECHE_FX_PURPURA_CARMESI.json"))
        img = Image.open(io.BytesIO(z.read("pocheche_atlas_master/POCHECHE_FX_PURPURA_CARMESI.png"))).convert("RGBA")
    return meta, img


def build_fx():
    """página de FX (solo los frames usados, empaquetados en estantes) + entradas de librería."""
    meta, img = load_fx_source()
    by_idx = {f["index"]: (n, f) for n, f in meta["frames"].items()}
    used = []
    for A in FX_ANIMS.values():
        for i in A["frames"]:
            if i not in by_idx: sys.exit("el atlas FX fuente no tiene el frame %d" % i)
            if i not in used: used.append(i)
    crops = {}
    for i in used:
        n, f = by_idx[i]; c = f["content"]; x0, y0 = f["frame"]["x"] + c["x"], f["frame"]["y"] + c["y"]
        im = img.crop((x0, y0, x0 + c["w"], y0 + c["h"]))
        bb = im.getchannel("A").getbbox()
        crops[i] = (im.crop(bb) if bb else im, c["scale"])
    PAGE_W, PAD = 1024, 2
    x = y = shelf = 0; rects = {}
    for i in used:
        im = crops[i][0]
        if x + im.width + PAD > PAGE_W: x = 0; y += shelf + PAD; shelf = 0
        rects[i] = (x, y, im.width, im.height); x += im.width + PAD; shelf = max(shelf, im.height)
    page = Image.new("RGBA", (PAGE_W, y + shelf), (0, 0, 0, 0))
    for i in used: page.paste(crops[i][0], rects[i][:2])
    frames = {"f%02d" % i: [rects[i][0], rects[i][1], rects[i][2], rects[i][3], 1.0, rects[i][2], rects[i][3]] for i in used}
    anims = {}
    for aid, A in FX_ANIMS.items():
        native = [crops[i][0].height / crops[i][1] for i in A["frames"]]      # alto real relativo (deshace content.scale)
        m = A["h"] / max(native)
        anims[aid] = {"lib": FX_LIB_ID, "frames": ["f%02d" % i for i in A["frames"]], "fps": A["fps"], "loop": False,
                      "scales": [round(m / crops[i][1], 5) for i in A["frames"]],
                      "anchors": [[0.5, 0.5] for _ in A["frames"]], "use": "hitspark", "h": A["h"]}
    return page, frames, anims


def update_fx_lib(L, page, frames, anims):
    L["libs"][FX_LIB_ID] = {
        "image": "assets/fx/" + FX_PAGE_NAME, "runtime": True, "size": [page.width, page.height],
        "source": "POCHECHE_FX_PURPURA_CARMESI (dentro de sources/entregas_2026-11-08/POCHECHE_ATLAS_MASTER_GAME_READY.zip)",
        "owner": "sofi", "confidence": "ALTA",
        "evidence": "Mismo ZIP que el atlas del Modo Vestía; el usuario: 'Este atlas es de Sofía modo vestía'. Garras morado/carmesí = Vestía. "
                    "Lo agrega tools/build_sofi_vestia_real.py (volver a correrlo después de pack_fx_library.py).",
        "frames": frames}
    for aid, A in anims.items(): L["anims"][aid] = A
    note = " Entradas sofi_vestia_fx / vestia_*: tools/build_sofi_vestia_real.py (volver a correrlo después de pack_fx_library.py)."
    if note not in L["_doc"]: L["_doc"] += note
    return L


def update_char(d, names, info, png_sha):
    for mv, aid in HIT_VESTIA.items(): d["moves"][mv]["hitAnimVestia"] = aid
    for mv, aid in HIT_ALWAYS.items(): d["moves"][mv]["hitAnim"] = aid
    idx = {n: info[n]["idx"] for n in names}
    d["atlases"].pop("base_vestia", None)
    d["atlases"]["vestia_real"] = {
        "file": OUT_NAME, "columns": COLS, "rows": (len(names) + COLS - 1) // COLS,
        "cell": {"w": CELL, "h": CELL}, "anchor": {"x": 0.5, "y": round(ANCHOR_Y, 6)}, "sha256": png_sha,
        "source": "Atlas real del Modo Vestía entregado por el usuario el 2026-11-08 (ZIP con nombre equivocado POCHECHE_ATLAS_MASTER_GAME_READY, "
                  "sha256 " + SRC_SHA + "); re-escalado/limpio por tools/build_sofi_vestia_real.py. Reemplaza al recoloreado morado provisional."}
    for clip, frames in MAP.items():
        base = d["clips"][clip]
        c = {k: v for k, v in base.items() if k not in ("atlas", "frames", "fps", "_doc", "hitboxes")}
        c.update({"atlas": "vestia_real", "fps": FPS.get(clip, base.get("fps", 10)), "frames": [idx[n] for n in frames],
                  "_src": frames})
        d["clips"][clip + "_vestia"] = c
    d["_vestia_moveset"] = ("2026-11-08: moveset REAL del Modo Vestía (atlas vestia_real, arte del usuario) en los clips *_vestia; "
                            "lo genera tools/build_sofi_vestia_real.py (no editar a mano). Mismos frames/fps que el clip base "
                            "(salvo walk/hurt, que no marcan golpes) -> el golpe dibujado cae en el mismo tick que en la simulación. "
                            "Tras ejecutar modo_vestia, f.transformed=true y el render dibuja estos clips; buff de daño en engine/pg_sim.js (vestiaDamageMul). "
                            "Asignación pose->golpe = TODO: VERIFICAR con el usuario.")
    return d


def main():
    check = "--check" in sys.argv
    atlas, names, info = build()
    buf = io.BytesIO(); atlas.save(buf, "PNG", optimize=True); data = buf.getvalue()
    png_sha = hashlib.sha256(data).hexdigest()
    d = json.load(open(CHAR, encoding="utf-8"))
    new = update_char(json.loads(json.dumps(d)), names, info, png_sha)
    txt = json.dumps(new, ensure_ascii=False, indent=2) + "\n"
    old_txt = open(CHAR, encoding="utf-8").read()
    old_png = open(OUT, "rb").read() if os.path.exists(OUT) else None
    same_png = old_png is not None and Image.open(io.BytesIO(old_png)).convert("RGBA").tobytes() == atlas.tobytes()
    clipped = [n for n in names if info[n]["clipped"]]
    if clipped: print("AVISO: recortado por la celda:", clipped)
    # chispas de impacto: página WebP SIN pérdida (lo decodificado = lo generado, así --check compara píxeles exactos)
    fx_page, fx_frames, fx_anims = build_fx()
    old_fx = Image.open(FX_PAGE).convert("RGBA") if os.path.exists(FX_PAGE) else None
    same_fx = old_fx is not None and old_fx.size == fx_page.size and old_fx.tobytes() == fx_page.tobytes()
    lib_txt = open(FX_LIB, encoding="utf-8").read()
    new_lib_txt = json.dumps(update_fx_lib(json.loads(lib_txt), fx_page, fx_frames, fx_anims), ensure_ascii=False, indent=1)
    if check:
        ok = same_png and json.loads(old_txt) == json.loads(json.dumps(update_char(json.loads(old_txt), names, info,
                                                                                        hashlib.sha256(old_png).hexdigest() if old_png else "")))
        ok = ok and same_fx and new_lib_txt == lib_txt
        print("al día" if ok else "DESACTUALIZADO"); sys.exit(0 if ok else 1)
    if not same_fx:
        fx_page.save(FX_PAGE, "WEBP", lossless=True, quality=100, method=6, exact=True)
        print("escrito", os.path.relpath(FX_PAGE, ROOT), fx_page.size, len(fx_frames), "FX")
    if new_lib_txt != lib_txt:
        open(FX_LIB, "w", encoding="utf-8").write(new_lib_txt); print("actualizado", os.path.relpath(FX_LIB, ROOT))
    if not same_png:
        open(OUT, "wb").write(data); print("escrito", os.path.relpath(OUT, ROOT), atlas.size, len(names), "frames")
    else:
        png_sha = hashlib.sha256(old_png).hexdigest(); new = update_char(json.loads(json.dumps(d)), names, info, png_sha)
        txt = json.dumps(new, ensure_ascii=False, indent=2) + "\n"
    if txt != old_txt:
        open(CHAR, "w", encoding="utf-8").write(txt); print("actualizado", os.path.relpath(CHAR, ROOT))
    if os.path.exists(OLD_RECOLOR):
        os.remove(OLD_RECOLOR); print("borrado el recoloreado provisional", os.path.relpath(OLD_RECOLOR, ROOT))
    for n in names: print("  %-22s idx=%2d %3dx%3d k=%.3f" % (n, info[n]["idx"], info[n]["w"], info[n]["h"], info[n]["k"]))


if __name__ == "__main__":
    main()
