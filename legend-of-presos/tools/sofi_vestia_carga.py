#!/usr/bin/env python3
"""Modo Vestía de Sofi como SÚPER CON CARGA (antes se activaba solo a media vida).

Uso, desde la raíz del proyecto (legend-of-presos/):
    python3 -I tools/sofi_vestia_carga.py           # aplica
    python3 -I tools/sofi_vestia_carga.py --check   # solo verifica (sale con 1 si no está aplicado)
    python3 -I tools/sofi_vestia_carga.py --revert  # vuelve a la transformación automática a media vida

Pedido del usuario (2026-11-19): "el modo bestia lo dejas como especial al activarse con carga".
  - Comando: ↓↘→↓↘→ + Patada (inputs.supers), con la barra LLENA (meterCost = COSTO).
  - Una vez por ronda: tras transformarse (f.transformed) no se puede repetir (engine/pg_sim.js, tryStartMove).
  - Se quita `autoTransform` (queda en `_autoTransformAntes` para --revert). Arte, golpes y chispas no cambian.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = os.path.join(ROOT, "assets", "combat", "sofi", "sofi.char.json")
COSTO = 100
ENTRADA = {"motion": "qcf2", "button": "kick", "move": "modo_vestia"}
CHECK, REVERT = "--check" in sys.argv, "--revert" in sys.argv


def aplicar(d):
    if REVERT:
        if "_autoTransformAntes" in d:
            d["autoTransform"] = d.pop("_autoTransformAntes")
        d["inputs"]["supers"] = [s for s in d["inputs"].get("supers", []) if s.get("move") != "modo_vestia"]
        mv = d["moves"]["modo_vestia"]
        mv["meterCost"] = mv.pop("_meterCostAntes", 0)
        return d
    if "autoTransform" in d:
        d["_autoTransformAntes"] = d.pop("autoTransform")
    sup = d["inputs"].setdefault("supers", [])
    if not any(s.get("move") == "modo_vestia" for s in sup):
        sup.append(dict(ENTRADA))
    mv = d["moves"]["modo_vestia"]
    if "_meterCostAntes" not in mv:
        mv["_meterCostAntes"] = mv.get("meterCost", 0)
    mv["meterCost"] = COSTO
    mv["_docCarga"] = ("2026-11-19 (tools/sofi_vestia_carga.py): súper con carga — ↓↘→↓↘→ + Patada con la barra llena, una vez "
                       "por ronda. Antes se activaba solo a media vida (ver _autoTransformAntes).")
    return d


def main():
    txt = open(P, encoding="utf-8").read()
    d = aplicar(json.loads(txt))
    new = json.dumps(d, indent=2, ensure_ascii=False) + ("\n" if txt.endswith("\n") else "")
    if CHECK:
        ok = new == txt
        print("al día" if ok else "DESACTUALIZADO"); sys.exit(0 if ok else 1)
    if new != txt:
        open(P, "w", encoding="utf-8").write(new)
        print("char.json de Sofi actualizado" + (" (revertido)" if REVERT else ""))
    else:
        print("sin cambios")


if __name__ == "__main__":
    main()
