@echo off
title NETROMANCER.BBS
cd /d "%~dp0"

if not exist "%~dp0node\node.exe" (
    echo.
    echo  node\node.exe not found.
    echo  Unzip the portable Node.js distribution into "%~dp0node\".
    echo.
    pause
    exit /b 1
)

"%~dp0node\node.exe" "%~dp0serve.js"

echo.
echo Server stopped.
pause
