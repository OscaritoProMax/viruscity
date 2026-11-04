# Taller 4 – Sistemas Distribuidos (Proyecto final Parte I) – Universidad de Boyacá

## Qué es
Tres procesos separados: auth-service (HTTP, puerto 4000, SQLite + JWT), coordinator (HTTP + WebSocket, puerto 5000, lista de jugadores en memoria) y client (HTML + JS plano servido con Express, puerto 3000). Cada uno se expone con su propio túnel ngrok.

## Código base de referencia
- Repo: https://github.com/Draklif/SSD-CommsWS.git, clonado en _base-ref/ (ignorado por git, SOLO LECTURA: nunca lo modifiques, nunca ejecutes npm install ni su código ahí).
- El análisis está en BASE-ANALISIS.md. Léelo al empezar cada fase.
- Prioridad cuando haya conflicto: 1) requisitos del enunciado del taller (resumidos en este archivo y en el prompt de cada fase), 2) este CLAUDE.md, 3) el código base. El base nunca gana sobre el enunciado.
- Antes de crear un archivo, revisa si el base tiene un equivalente. Si existe y cumple, reutilízalo: cópialo por nombre a la carpeta correspondiente y ajústalo; mantén su estilo y nombres cuando no contradigan las reglas. Si no cumple, reescríbelo y anota el motivo en "Decisiones tomadas durante el desarrollo".
- Nunca copies del base: .git, node_modules, .env, *.db, secretos ni URLs fijas. Si el base trae un secreto o una contraseña hardcodeada, no la reutilices y anótalo.
- Si el base es un instructivo, sigue sus pasos mientras no contradigan el enunciado.
- En el README deja un crédito: "Basado en el código de referencia SSD-CommsWS", indicando qué se reutilizó y qué se cambió.
- Los commits deben seguir siendo incrementales aunque reutilices código del base: no copies todo en un solo commit.

## Reglas permanentes
- Node >= 18, CommonJS (require), sin TypeScript. Cliente: HTML + JS plano, sin frameworks.
- Comentarios en español. Mensajes de error visibles al usuario en español.
- NADA hardcodeado: secret de JWT, puertos y URLs van en .env (cargado con dotenv). Cada servicio tiene su .env (ignorado por git) y su .env.example (versionado, sin secretos reales). JWT_SECRET debe ser idéntico en auth-service y coordinator.
- Cada servicio tiene su propio package.json con scripts "start": "node index.js" (el client usa server.js).
- Nunca registrar en logs contraseñas, hashes, tokens ni bodies de peticiones.
- Respuestas de error siempre como JSON: { "error": "mensaje" }.
- userId siempre es string (en BD es entero autoincremental; se convierte con String()).
- No instales paquetes fuera de los que indique cada fase. Si `npm install bcrypt` falla por compilación nativa, DETENTE y avísame; no cambies a bcryptjs sin mi autorización.
- No ejecutes ngrok (lo ejecuto yo). No hagas `git push` (lo hago yo). No uses `git commit --amend` ni `git rebase`.
- Commits: uno por paso lógico, mensajes en español con prefijo (feat, fix, chore, docs, test). Antes de cada commit revisa `git status` y agrega archivos por nombre; nunca `git add .` sin revisar. Jamás commitear .env, *.db, node_modules, _base-ref/ ni BASE-ANALISIS.md.
- Antes de levantar un servicio comprueba que su puerto esté libre. Al terminar las pruebas detén TODO proceso que hayas levantado y borra archivos temporales (por ejemplo users.db de pruebas).
- Al terminar cada fase: resumen breve de lo hecho, resultado de cada prueba (pasó/falló) y DETENTE. No avances a otra fase por iniciativa propia.
- No implementes nada fuera del alcance (nada de juego, posiciones ni replicación; eso es de partes futuras).

## Decisiones fijas (no cambiar sin preguntarme)
1. username: se aplica trim; 3 a 30 caracteres; regex ^[A-Za-z0-9_]+$; distingue mayúsculas/minúsculas.
2. password: 6 a 72 caracteres (72 es el límite de bcrypt).
3. bcrypt: rounds configurables con BCRYPT_ROUNDS, valor por defecto 10, mínimo permitido 10.
4. JWT: algoritmo HS256; payload { userId (string), username }; iat y exp los agrega jsonwebtoken; expiración con JWT_EXPIRES_IN (por defecto "1h"; debo poder cambiarlo a "30s" solo editando .env).
5. Login fallido: siempre 401 con el mismo mensaje "Credenciales inválidas", exista o no el usuario.
6. WebSocket: ruta /connect?token=XXX. Códigos de cierre propios: 4001 "invalid token" (token ausente, malformado, vencido o firmado con otra clave al conectar), 4001 "token expired" (el token vence con el socket ya abierto), 4002 "replaced by new session" (misma cuenta abre otra conexión).
7. Sesión duplicada: se cierra la conexión ANTERIOR con 4002 y se queda la nueva.
8. Heartbeat: ping del servidor cada 30 s (configurable); si no hay pong antes del siguiente ciclo, se termina el socket.

## Decisiones tomadas durante el desarrollo
(agregar aquí cualquier decisión nueva, una línea cada una, incluyendo qué se reutilizó del base y qué se corrigió; la fase del README las usará)
- Fase 0: los archivos del base estaban copiados en la raíz (commit `3182f36 inicial`); eran idénticos al repo de GitHub, se movieron a _base-ref/ y se quitaron del repo en el commit de estructura.
- Fase 1 (base): el base no tiene auth; no se copió ningún archivo. Solo se reutilizó el patrón `app.listen(PORT, (err) => …)` de Express 5 (`coordinator/index.js`) y el formato `res.status(4xx).json({ error })` (`worker/index.js`). No se reutilizó `parseArgs` ni `--env-file-if-exists` (requiere Node >= 22.9); se usa dotenv.
- auth-service: dotenv se carga con `{ quiet: true }` para que no imprima su propio mensaje en consola.
- auth-service: DB_PATH se resuelve relativo a la carpeta del servicio (`path.resolve(__dirname, …)`), no al directorio desde donde se lanza.
- auth-service: además del mínimo 10, BCRYPT_ROUNDS tiene máximo 31 (límite de bcrypt) y PORT se valida entre 1 y 65535.
- auth-service: el middleware de log va antes de `express.json()` para que también se registren los 400/413 de JSON roto o cuerpo grande.
- auth-service: /login no aplica trim ni reglas de formato al username (solo string no vacío ≤ 1000); el cliente debe enviar el username ya recortado.
- auth-service: la longitud 6–72 de password se mide en caracteres; bcrypt trunca a 72 bytes, así que con caracteres multibyte (tildes, emojis) los bytes sobrantes no cuentan.
- auth-service: el cierre ordenado fuerza la salida a los 5 s si alguna conexión no termina.
- auth-service: bcrypt 6.0.0 trae binarios precompilados (win32-x64); npm 11 avisa que no ejecutó su script de instalación, pero el módulo carga y funciona sin compilar.
- Fase 2 (base): coordinator/index.js del base no cumple (sin token, sin upgrade, sin close, maneja workers) y se reescribió. Se reutilizaron `send()` (chequeo `readyState === OPEN`) y la idea de `broadcast()`, la estructura por secciones y HTTP + WS en el mismo puerto. Se eliminaron roles, workers, pulsos de aplicación, `/status`, dashboard estático y `cors()`.
- coordinator: los mensajes son planos `{ type: "players_update", players: [...] }` como pide el enunciado, no el sobre `{ type, data }` del base.
- coordinator: broadcastPlayers recorre el Map y no `wss.clients`, para no enviar la lista a sockets rechazados con 4001 que aún se están cerrando.
- coordinator: además de userId y username string, el payload debe traer `exp` numérico; sin él el token se rechaza con 4001 (si no, el temporizador de expiración recibiría NaN y cerraría al instante).
- coordinator: HEARTBEAT_INTERVAL_MS se valida como entero positivo; PORT entre 1 y 65535; dotenv con `{ quiet: true }`.
- coordinator: log HTTP solo con método, ruta sin query y status (la query de /connect lleva el token); los rechazos registran solo el mensaje de jsonwebtoken ("jwt expired", "invalid signature"...).
- coordinator: el socket crudo recibe un manejador de 'error' vacío al empezar el upgrade, para que un reset del cliente durante el handshake no tumbe el proceso.
- coordinator: 404 y 500 HTTP como JSON `{ error }`; el apagado ordenado fuerza la salida a los 5 s (terminate) si algún cliente no completa el cierre.
- coordinator: smoke-test usa B con un token de 3 s para S10 (B ya está desconectado), así no reemplaza la sesión de A ni de C.
