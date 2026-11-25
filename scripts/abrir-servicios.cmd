@echo off
rem Abre los 7 servicios de Viruscity, cada uno en su ventana. Lo usan iniciar-servicios.cmd (pruebas locales)
rem e iniciar-ngrok.cmd (pruebas por ngrok); no hace falta ejecutarlo a mano.
rem Si ya hay servicios escuchando en los puertos del sistema, no abre nada (chocarían) y sale con error.
chcp 65001 >nul
cd /d %~dp0..

set OCUPADOS=
for %%P in (3000 4001 4002 4003 5001 5002 5003) do (
    netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul && call set OCUPADOS=%%OCUPADOS%% %%P
)
if defined OCUPADOS (
    echo.
    echo ✘ Ya hay servicios corriendo en los puertos:%OCUPADOS%
    echo   Cierra sus ventanas ^(o Ctrl+C en cada una^) y vuelve a ejecutar.
    exit /b 1
)

rem Primero los 3 auth (eligen líder), luego los 3 coordinadores y al final el client
start "auth-a" cmd /k "cd auth-service && npm run start:a"
start "auth-b" cmd /k "cd auth-service && npm run start:b"
start "auth-c" cmd /k "cd auth-service && npm run start:c"
rem pausa de ~3 s (ping funciona con o sin consola, a diferencia de timeout)
"%SystemRoot%\System32\ping.exe" -n 4 127.0.0.1 >nul
start "coord-a" cmd /k "cd coordinator && npm run start:a"
start "coord-b" cmd /k "cd coordinator && npm run start:b"
start "coord-c" cmd /k "cd coordinator && npm run start:c"
start "client" cmd /k "cd client && npm start"
exit /b 0
