@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   Legend of Presos - El Escape de Puente Grande
echo ================================================
echo.
echo Abriendo el juego en tu navegador...
echo (Deja ESTA ventana abierta mientras juegas. Para salir, cierrala.)
echo.
start "" "http://127.0.0.1:8123/game.html"
py -m http.server 8123 2>nul || python -m http.server 8123 2>nul || python3 -m http.server 8123 2>nul
if errorlevel 1 (
  echo.
  echo No se encontro Python en esta PC.
  echo Instalalo gratis desde https://www.python.org/downloads/  ^(marca "Add Python to PATH"^)
  echo y vuelve a abrir este archivo. O pide el enlace web para jugar sin instalar nada.
  pause
)
