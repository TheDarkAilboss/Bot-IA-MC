@echo off
title Tumsenoubot v2.0

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js n'est pas installe ! Telecharge-le sur https://nodejs.org
    pause
    exit
)

if not exist "node_modules" (
    echo Installation des dependances...
    npm install
    echo.
)

echo ================================
echo      Tumsenoubot v2.0
echo   Minecraft + Discord + Claude
echo ================================
echo.

node bot.js

echo.
echo ================================
echo  Bot arrete. Appuie sur une
echo  touche pour fermer.
echo ================================
pause
