#!/usr/bin/env python3
"""Tiempos explícitos para los golpes de suelo que dependían del reloj del clip.

Uso, desde la raíz del proyecto (legend-of-presos/):
    python3 -I tools/build_frame_data.py           # escribe los char.json
    python3 -I tools/build_frame_data.py --check   # solo verifica que estén al día (sale con 1 si no)
    python3 -I tools/build_frame_data.py --revert  # deja los moves como estaban antes de este script

Fuente de verdad: data/frame_data.json (clases de especiales/súpers/ocultos) y data/normals.json (normales).
Cada move convertido guarda su definición anterior en `_clipTiming`, así que el script es idempotente: siempre
recalcula desde lo original y nunca acumula cambios. No toca cajas de golpe, daño total, clips ni arte.

Qué hace con cada move de suelo que tiene `hitFrames` y no tiene `frames`:
  - frames {startup, active, recovery} según su clase; activeIdx = primer y último cuadro de impacto (o de lanzamiento
    del proyectil). La animación del clip se reparte sobre esos tiempos (framePhase en engine/pg_sim.js).
  - hitstun/blockstun calculados para la ventaja objetivo de la clase (stun = adv + frames que le quedan al atacante
    tras el último impacto). Derribos y lanzadores conservan su hitstun.
  - cuadros de impacto no seguidos ([2,4,6]) -> multiHit, un impacto por grupo y daño repartido (no sube el total).
  - cancelWindow (por cuadro del clip) -> cancelFrames [primer frame activo, fin de la fase activa + 2].
"""
import json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHECK = "--check" in sys.argv
REVERT = "--revert" in sys.argv
KEYS = ("frames", "activeIdx", "hitFrames", "hitstun", "blockstun", "cancelFrames", "cancelWindow", "multiHit", "damage")


def load(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def groups(idx):
    """[1,2,4] -> [[1,2],[4]]"""
    out = []
    for i in sorted(idx):
        if out and i == out[-1][-1] + 1:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def klass(mv, hidden):
    proj = bool(mv.get("spawns"))
    if hidden:
        return "oculto_proyectil" if proj else "oculto"
    if mv.get("super"):
        return "super_proyectil" if proj else "super"
    if proj:
        return "proyectil"
    if mv.get("launcher") or mv.get("invuln"):
        return "especial_lanzador"
    if mv.get("guardType") == "low":
        return "especial_bajo"
    return "especial"


def convert(cid, name, mv, d, FD, NORM, hidden):
    """Devuelve el move nuevo (dict) o None si no aplica."""
    src = mv.get("_clipTiming")
    base = dict(mv)
    if src is not None:  # recalcular siempre desde la definición original
        for k in KEYS:
            base.pop(k, None)
        base.update({kk: vv for kk, vv in src.items() if kk != "_keys"})
        base.pop("_clipTiming", None)
        base.pop("_timing", None)
        order = src.get("_keys") or list(base)
        base = {**{kk: base[kk] for kk in order if kk in base}, **{kk: vv for kk, vv in base.items() if kk not in order}}
    if REVERT:
        return base
    if base.get("type") in ("throw", "command_grab") or base.get("air") or "frames" in base or "hitFrames" not in base:
        return base
    if f"{cid}.{name}" in FD.get("skip", []):
        return base
    clip = d["clips"].get(base["clip"])
    if not clip:
        return base
    n = len(clip["frames"])
    hf = list(base.get("hitFrames") or [])
    sf = base.get("spawnFrame")
    marks = hf + ([sf] if sf is not None else [])
    if not marks:
        return base
    a0, a1 = min(marks), max(marks)
    if a1 >= n:  # dato que apunta fuera del clip: no se adivina
        return base

    is_normal = not base.get("special") and not base.get("super")
    if is_normal:
        cname = NORM["map"].get(name)
        if not cname or cname not in NORM["classes"]:
            return base
        C = dict(NORM["classes"][cname])
        cls = "normal:" + cname
    else:
        cls = klass(base, hidden)
        C = dict(FD["classes"][cls])

    out = dict(base)
    # impactos: seguidos = uno sostenido; separados = multiHit, uno por grupo
    multi = bool(base.get("multiHit"))
    hits = hf
    if hf and not multi and FD.get("multiHitFromSeparatePoses") and len(groups(hf)) > 1:
        hits = [g[0] for g in groups(hf)]
        multi = True
        out["multiHit"] = True
        out["damage"] = max(1, round(base.get("damage", 12) / len(hits)))
    k = FD["framesPerHitPose"]
    span = a1 - a0 + 1
    if multi and len(hits) > 1:
        A = k * span
    else:
        A = max(C["active"], span)
    S = max(C["startup"], min(C["startup"] + FD["startupExtraMax"], FD["startupPerPose"] * a0))
    R = max(C["recovery"], n - 1 - a1)
    out["frames"] = {"startup": S, "active": A, "recovery": R}
    out["activeIdx"] = [a0, a1]
    out["hitFrames"] = hits
    # frame (moveFrame) en que entra el último impacto
    last = max(hits) if hits else a0
    lastF = S + 1 + ((last - a0) * A) // span
    if (last - a0) * A % span:
        lastF += 1
    left = S + A + R - lastF
    knock = base.get("launcher") or base.get("knockdown") or base.get("hardKnockdown")
    if hits:
        if "advBlock" in C:
            out["blockstun"] = max(4, C["advBlock"] + left)
        if "advHit" in C and not knock:
            out["hitstun"] = max(base.get("hitstun", 0) if multi and len(hits) > 1 else 0, C["advHit"] + left)
    if base.get("cancelInto"):
        out.pop("cancelWindow", None)
        # proyectil: la bola tarda en llegar; se puede cancelar mientras dura la recuperación temprana
        out["cancelFrames"] = [S + 1, S + A + (FD.get("projectileCancelExtra", 10) if base.get("spawns") else 2)]
    out["_clipTiming"] = {kk: base[kk] for kk in KEYS if kk in base}
    out["_clipTiming"]["_keys"] = list(base)   # orden original de las claves, para que --revert deje el archivo idéntico
    out["_timing"] = f"tools/build_frame_data.py clase {cls} (data/frame_data.json). DISEÑO: TODO VERIFICAR jugando"
    return out


def main():
    FD = json.loads(load(os.path.join(ROOT, "data/frame_data.json")))
    NORM = json.loads(load(os.path.join(ROOT, "data/normals.json")))
    roster = json.loads(load(os.path.join(ROOT, "data/roster.json")))["characters"]
    stale, changed, total = [], 0, 0
    for c in roster:
        cid = c["id"]
        p = os.path.join(ROOT, "assets/combat", cid, cid + ".char.json")
        if not os.path.exists(p):
            continue
        txt = load(p)
        d = json.loads(txt)
        hidden = {h["move"] for h in (d.get("inputs", {}).get("hidden") or [])}
        moves = {}
        for name, mv in d["moves"].items():
            nv = convert(cid, name, mv, d, FD, NORM, name in hidden)
            # orden de claves estable: el del archivo actual y luego las nuevas (idempotente byte a byte)
            if "_clipTiming" in nv:
                nv = {**{kk: nv[kk] for kk in mv if kk in nv}, **{kk: vv for kk, vv in nv.items() if kk not in mv}}
            if "_clipTiming" in nv:
                total += 1
            moves[name] = nv
        d["moves"] = moves
        new = json.dumps(d, indent=2, ensure_ascii=False) + ("\n" if txt.endswith("\n") else "")
        if new != txt:
            stale.append(cid)
            if not CHECK:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(new)
                changed += 1
    if CHECK:
        if stale:
            print("DESACTUALIZADOS:", ", ".join(stale))
            sys.exit(1)
        print(f"al día ({total} moves con tiempos explícitos de este script)")
    else:
        print(f"{changed} char.json escritos; {total} moves con tiempos explícitos de este script")


if __name__ == "__main__":
    main()
