#!/usr/bin/env python3
"""Recolorea el atlas base de Sofi a su versión 'Modo Vestía' (morado/oscuro) para el moveset persistente.
Uso (desde la raíz):  python3 -I tools/build_sofi_vestia_moveset.py
Entrada: assets/combat/sofi/sofi_atlas.png   Salida: assets/combat/sofi/sofi_vestia_moveset.png
Mapeo: blanco/claro -> morado; rojo -> carmesí oscuro; piel -> pálida grisácea (se ve la cara); cabello/oscuro -> morado oscuro.
Es un recoloreado determinista del arte existente (no arte nuevo): preserva pose y sombreado."""
import os
from PIL import Image
import numpy as np
ROOT=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))
SRC=os.path.join(ROOT,"assets/combat/sofi/sofi_atlas.png")
OUT=os.path.join(ROOT,"assets/combat/sofi/sofi_vestia_moveset.png")
a=Image.open(SRC).convert("RGBA"); arr=np.array(a).astype(float)
R,G,B,A=arr[:,:,0],arr[:,:,1],arr[:,:,2],arr[:,:,3]
lum=(0.299*R+0.587*G+0.114*B)/255.0
isred=(R>120)&(R>G*1.5)&(R>B*1.5)
isskin=(R>175)&(G>130)&(G<205)&(B>95)&(B<180)&(R>G)&(G>B)&(~isred)
sh=np.array([18,6,28]); hi=np.array([150,70,200])           # duotono morado (sombra->luz)
duo=np.stack([sh[i]+(hi[i]-sh[i])*lum for i in range(3)],axis=2)
crim=np.stack([np.clip(R*0.80,0,255),G*0.22+8,np.clip(B*0.42+42,0,255)],axis=2)   # rojo -> carmesí
skin=np.stack([np.clip(R*0.62+40,0,235),np.clip(G*0.52+30,0,205),np.clip(B*0.70+60,0,225)],axis=2)  # piel pálida morada
out=duo.copy()
out=np.where(isred[...,None],crim,out)
out=np.where(isskin[...,None],skin,out)
res=np.dstack([np.clip(out,0,255),A]).astype("uint8")
new=Image.fromarray(res,"RGBA")
if not os.path.exists(OUT) or Image.open(OUT).tobytes()!=new.tobytes():
    new.save(OUT); print("escrito",os.path.relpath(OUT,ROOT))
else: print("sin cambios")
