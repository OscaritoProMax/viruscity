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
