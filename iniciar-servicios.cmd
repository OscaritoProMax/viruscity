@echo off
rem PRUEBAS LOCALES: abre los 7 servicios de Viruscity en este equipo (sin ngrok). Doble clic o: iniciar-servicios.cmd
rem   1. Deja los .env con localhost (por si antes se usó iniciar-ngrok.cmd).
rem   2. Abre auth-a/b/c, coord-a/b/c y el client, cada uno en su ventana.
rem Requisitos: npm ci en auth-service, coordinator y client, y los .env de cada uno (ver README, "Cómo levantar todo").
rem Para las pruebas por ngrok se usa iniciar-ngrok.cmd.
chcp 65001 >nul
cd /d %~dp0
title Viruscity · pruebas locales

echo [1/2] Configurando los .env para pruebas LOCALES...
node tunel\configurar.js --local
if errorlevel 1 (
    echo ✘ No se pudieron dejar los .env en localhost. Revisa el mensaje de arriba.
    pause
    exit /b 1
)

echo.
echo [2/2] Abriendo los 7 servicios...
call scripts\abrir-servicios.cmd
if errorlevel 1 (
    pause
    exit /b 1
)

echo.
echo Servicios lanzados: client 3000 · auth 4001-4003 · coordinadores 5001-5003
echo Abre http://localhost:3000   (clúster: /cluster.html · espectador: /spectate.html)
pause
