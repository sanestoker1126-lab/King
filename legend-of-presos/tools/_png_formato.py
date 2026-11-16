"""Guarda una hoja limpiada en el MISMO formato que su original (lo usan los limpiadores de atlas).
Si el original es PNG de PALETA (modo P con transparencia por índice), se conserva la paleta y solo se cambia el índice de
los píxeles borrados al índice transparente de esa paleta: el archivo pesa lo mismo que antes (en RGBA pesaba ~3 veces más).
Si es RGBA, se guarda RGBA."""
import io
import numpy as np
from PIL import Image


def guardar(orig_path, rgba_limpio):
    """rgba_limpio: imagen RGBA ya limpiada (los píxeles borrados tienen alfa 0). Devuelve los bytes PNG."""
    o = Image.open(orig_path)
    t = o.info.get("transparency")
    if o.mode == "P" and isinstance(t, (bytes, bytearray)) and 0 in t:
        idx = np.array(o)
        orig_a = np.array(o.convert("RGBA"))[..., 3]
        new_a = np.array(rgba_limpio)[..., 3]
        borrar = (new_a == 0) & (orig_a != 0)
        idx[borrar] = t.index(0)
        img = Image.fromarray(idx.astype(np.uint8), "P")
        img.putpalette(o.getpalette())
        b = io.BytesIO()
        img.save(b, "PNG", optimize=True, transparency=bytes(t))
        return b.getvalue()
    b = io.BytesIO()
    rgba_limpio.save(b, "PNG", optimize=True)
    return b.getvalue()
