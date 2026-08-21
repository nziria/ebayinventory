@echo off
setlocal EnableDelayedExpansion

set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%LOCALAPPDATA%\Programs\node;%PATH%"

echo ======================================================
echo    EBAY INVENTORY AUTOMATION - AVVIO WINDOWS
echo ======================================================
echo.

cd /d "%~dp0"

if not exist "C:\Program Files\nodejs\node.exe" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo ERRORE: Node.js non trovato.
        echo Scarica Node.js da https://nodejs.org
        pause
        exit /b 1
    )
)

echo [OK] Node.js rilevato.
echo [*] Apertura interfaccia su http://localhost:3000
echo [*] Premi CTRL+C per fermare il server.
echo.

start "" "http://localhost:3000"

if exist "C:\Program Files\nodejs\node.exe" (
    "C:\Program Files\nodejs\node.exe" server.js
) else (
    node server.js
)

echo.
echo Il server e' stato terminato.
pause
