#!/bin/bash
cd "$(dirname "$0")"
echo "Legend of Presos — abriendo en tu navegador..."
echo "(Deja esta ventana abierta mientras juegas.)"
( sleep 1; open "http://127.0.0.1:8123/game.html" ) &
python3 -m http.server 8123 || { echo; echo "No se encontro Python 3. Instalalo desde python.org o pide el enlace web."; read -n1; }
