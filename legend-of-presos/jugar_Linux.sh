#!/bin/bash
cd "$(dirname "$0")"
echo "Legend of Presos — abriendo en tu navegador..."
( sleep 1; xdg-open "http://127.0.0.1:8123/game.html" >/dev/null 2>&1 ) &
python3 -m http.server 8123 || { echo; echo "No se encontro Python 3. Instalalo o pide el enlace web."; read -n1; }
