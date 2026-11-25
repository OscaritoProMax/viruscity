@echo off
rem PRUEBAS POR NGROK: despliega los 7 servicios con un túnel de ngrok cada uno. Doble clic o: iniciar-ngrok.cmd
rem   1. Escribe en los .env las URLs públicas de tunel\tunel.env (falla si falta algún authtoken).
rem   2. Abre auth-a/b/c, coord-a/b/c y el client, cada uno en su ventana.
rem   3. Espera a que el client responda y abre los 7 túneles, cada uno en su ventana.
rem Requisitos: ngrok instalado y tunel\tunel.env con los 7 dominios y los 7 authtoken (copia de tunel.example.env).
rem Para las pruebas locales se usa iniciar-servicios.cmd.
chcp 65001 >nul
cd /d %~dp0
title Viruscity · pruebas por ngrok

where ngrok >nul 2>&1
if errorlevel 1 (
    echo ✘ No se encontró ngrok. Instálalo ^(https://ngrok.com/download^) y vuelve a ejecutar.
    pause
    exit /b 1
)
if not exist tunel\tunel.env (
    echo ✘ Falta tunel\tunel.env: copia tunel\tunel.example.env como tunel\tunel.env y llena los dominios y authtokens.
    pause
    exit /b 1
)

echo [1/3] Configurando los .env para pruebas por NGROK...
node tunel\configurar.js --exigir-tokens
if errorlevel 1 (
    echo ✘ No se configuró nada. Revisa el mensaje de arriba.
    pause
    exit /b 1
)

echo.
echo [2/3] Abriendo los 7 servicios...
call scripts\abrir-servicios.cmd
if errorlevel 1 (
    pause
    exit /b 1
)

echo.
echo [3/3] Esperando a que los servicios respondan para abrir los túneles...
set /a INTENTOS=0
:esperar
"%SystemRoot%\System32\curl.exe" -s -o nul http://localhost:3000/ && goto abrir
set /a INTENTOS+=1
if %INTENTOS% geq 40 goto abrir
"%SystemRoot%\System32\ping.exe" -n 2 127.0.0.1 >nul
goto esperar
:abrir
"%SystemRoot%\System32\ping.exe" -n 4 127.0.0.1 >nul
call tunel\abrir-tuneles.cmd

echo.
echo Túneles abiertos. Cada ventana de ngrok debe decir "Forwarding https://... -^> http://localhost:<puerto>".
echo Entra por la URL del client que aparece arriba ^(pulsa "Visit Site" en el aviso de ngrok la primera vez^).
echo Para volver a pruebas locales: cierra todas las ventanas y ejecuta iniciar-servicios.cmd
pause
