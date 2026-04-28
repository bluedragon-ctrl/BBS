@echo off
title NETROMANCER.BBS
cd /d "%~dp0"

echo.
echo  NETROMANCER.BBS - starting local server on http://localhost:8123
echo  Press Ctrl+C to stop.
echo.

start "" http://localhost:8123

python -m http.server 8123

echo.
echo Server stopped.
pause
