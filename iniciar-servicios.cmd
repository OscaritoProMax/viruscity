@echo off
rem Abre los 7 servicios de Viruscity, cada uno en su ventana (Windows). Doble clic o: iniciar-servicios.cmd
rem Requisitos: npm ci en auth-service, coordinator y client, y los .env de cada uno (ver README, "Cómo levantar todo").
rem Orden: primero los 3 auth (eligen líder), luego los 3 coordinadores y al final el client.
cd /d %~dp0
start "auth-a" cmd /k "cd auth-service && npm run start:a"
start "auth-b" cmd /k "cd auth-service && npm run start:b"
start "auth-c" cmd /k "cd auth-service && npm run start:c"
timeout /t 3 /nobreak >nul
start "coord-a" cmd /k "cd coordinator && npm run start:a"
start "coord-b" cmd /k "cd coordinator && npm run start:b"
start "coord-c" cmd /k "cd coordinator && npm run start:c"
start "client" cmd /k "cd client && npm start"
echo Servicios lanzados: client 3000 · auth 4001-4003 · coordinadores 5001-5003
