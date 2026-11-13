#!/usr/bin/env python3
"""Auditoría de poses por personaje: cuántas poses distintas tiene cada golpe y cada reacción. Solo lee datos.
Uso (desde legend-of-presos/):  python3 -I tools/qa_20261106/audit_poses.py > qa/entrega_20261106/auditoria_golpes_y_reacciones.txt
Columnas: golpes = moves; sinTiem = moves sin tiempos explícitos (frames{}); sinPrep = golpes cuyo impacto es la primera pose
(sin preparación dibujada); <=2pose = golpes con 2 poses distintas o menos; media = poses distintas por golpe;
hurt/caida/levan/mareo/ko/guard = poses distintas del clip (0 = no lo tiene y usa el respaldo del motor)."""
import json
R = json.load(open("data/roster.json")); rows = []
for c in R["characters"]:
    if c["status"] != "playable": continue
    cid = c["id"]; d = json.load(open("assets/combat/%s/%s.char.json" % (cid, cid))); cl = d["clips"]; mv = d["moves"]
    sinprep = pobres = 0; lens = []
    for m in mv.values():
        c2 = cl.get(m.get("clip"))
        if not c2: continue
        L = len(set(c2["frames"])); lens.append(L); a = m.get("activeIdx")
        if m.get("frames") and a and a[0] == 0: sinprep += 1
        if L <= 2: pobres += 1
    u = lambda k: len(set(cl[k]["frames"])) if k in cl else 0
    rows.append((cid, len(mv), sum(1 for m in mv.values() if not m.get("frames")), sinprep, pobres, round(sum(lens) / max(1, len(lens)), 1),
                 u("hurt"), u("damage_fall"), u("recovery_pose"), u("dizzy"), u("ko_fall"), u("crouch_guard")))
print("%-18s %6s %7s %7s %7s %5s | %4s %5s %5s %5s %3s %5s" % ("personaje", "golpes", "sinTiem", "sinPrep", "<=2pose", "media", "hurt", "caida", "levan", "mareo", "ko", "guard"))
for r in sorted(rows, key=lambda r: (r[5], r[7])): print("%-18s %6d %7d %7d %7d %5.1f | %4d %5d %5d %5d %3d %5d" % r)
n = len(rows)
print("\nDe %d jugables: sin mareo propio %d · sin K.O. propio %d · golpe recibido de 1 pose o menos %d · media de poses por golpe menor a 3: %d"
      % (n, sum(1 for r in rows if r[9] == 0), sum(1 for r in rows if r[10] == 0), sum(1 for r in rows if r[6] <= 1), sum(1 for r in rows if r[5] < 3)))
