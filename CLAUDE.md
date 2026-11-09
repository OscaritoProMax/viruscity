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
- Fuera de alcance por ahora: lógica de juego, protocolo WebSocket nuevo, Google login, servidores. Se permite SOLO la capa visual (UI) de Viruscity en client/public.

## Decisiones fijas (no cambiar sin preguntarme)
1. username: se aplica trim; 3 a 30 caracteres; regex ^[A-Za-z0-9_]+$; único SIN distinguir mayúsculas ("Oscar", "osCar" y "OSCAR" son la misma cuenta; se guarda y se muestra como se registró; el login acepta cualquier combinación de mayúsculas). Cambiado a pedido del usuario.
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
- Fase 3 (base): `dashboard/style.css` se copió a client/public/css/style.css y se adaptó (se conservan paleta, modo oscuro, tarjetas, pills, botones e inputs; se quitaron grid de servidores, consolas y logs; se agregaron formularios, mensajes verde/rojo, banner y lista del lobby). De `dashboard/common.js` solo se tomó el atajo `$`; `card()`/`esc()` no se usan porque arman HTML como texto. `setStatus()` del lobby adapta `setWsStatus()` de `coordinator/public/index.html` (tres estados en vez de dos).
- client: PORT también es obligatorio en .env (sin valor por defecto), para no tener puertos escritos en server.js; AUTH_URL debe ser http(s) y COORDINATOR_WS_URL ws(s), si no el servidor no arranca.
- client: 404 como JSON `{ error }` y cierre ordenado con SIGINT/SIGTERM.
- client: el formulario envía el username con trim (el /login del auth-service no recorta espacios).
- client: si la respuesta del auth-service no es JSON (p. ej. una página de ngrok) se muestra "Error inesperado del servidor (status)".
- client: detrás de ngrok el cliente se sirve por HTTPS, así que COORDINATOR_WS_URL debe ser `wss://…` (el navegador bloquea ws:// desde una página https).
- Fase 5: la instalación limpia falló porque npm 11 ejecuta `node-gyp rebuild` de better-sqlite3 al instalar desde package-lock.json (sin Visual Studio no compila). Con autorización del usuario se agregó auth-service/.npmrc con `ignore-scripts=true`; bcrypt y better-sqlite3 cargan sus binarios precompilados. Regenerar el lockfile no lo resolvía.
- Fase 5: el tiempo de apagado de auth-service y coordinator pasó a la constante SHUTDOWN_TIMEOUT_MS (el literal 5000 parecía el puerto del coordinator).
- Corrección (antes del Taller 5): usernames únicos sin distinguir mayúsculas. Se busca con `WHERE username = ? COLLATE NOCASE` (registro y login) y un índice aparte `users_username_nocase` (UNIQUE, COLLATE NOCASE) cubre registros simultáneos sin cambiar el esquema de la tabla. Si una base antigua ya tiene duplicados, el servicio avisa por stderr y sigue validando los registros nuevos.
- Corrección (antes del Taller 5): el lobby vigila el token guardado (cada 1 s y con el evento `storage`). Si cambia o desaparece con la sesión abierta, cierra el WebSocket y vuelve al login con "El token de tu sesión no es válido." o "Tu sesión se cerró.". Al cerrar, solo borra el token si sigue siendo el de esa pestaña, y nunca con 4002 (el token ya es de la sesión nueva). La página de juego del Taller 5 (play.html) debe hacer lo mismo.
- Mapa de Virus City (pedido del usuario, referencias en `../referencias modelado/`): virus_city_map.html se pasó a módulos ES en client/public/js/play/map/. layout.js es puro y determinista; `npm run map` (client) exporta su grilla a coordinator/map/virus-city.json y client/test/map.test.mjs exige que coincidan. Sin CDN, Tailwind, Font Awesome ni fuentes web.
- Colisiones en el SERVIDOR: MAP_FILE en el .env del coordinator; parseMap valida el archivo, el mundo sale del mapa (3840 × 2880; WORLD_WIDTH/HEIGHT deben coincidir o no arranca) y moveAxis mueve un eje a la vez, pegando la caja (2·PLAYER_RADIUS) al borde de la casilla sólida. Sin MAP_FILE todo sigue como antes (1200 × 800 por defecto). /health agrega `map`. No se agregaron mensajes al protocolo.
- Del motor de la referencia se dejaron fuera interiores, diálogos, puertas (quedan sólidas), sonido y sprint: cambian posiciones o no aplican al juego distribuido. Vecinos y coches son decorado LOCAL (no chocan, no viajan por la red). La hora de día/noche sale de `state.t` del servidor (un día = 15 min), igual para todos.
- Personajes: Heroína y Explorador adaptados de las demos Funko (sin escopeta ni espada). El tercero de las referencias reproducía a CJ de GTA San Andreas (nombre, colores de Grove Street, armas); no se recreó y se diseñó un personaje original, "Mensajero". La apariencia viaja en extras { character, color, detail, skin }; el servidor solo valida color y el cliente valida el resto con resolveLook (apariencia por defecto estable por userId).
- smoke-test: con mapa, G5–G7 eligen una dirección libre simulando con game.js y G10 verifica que el jugador se detiene contra la pared donde lo calcula el servidor (sin mapa, x == radio como antes).
- Pruebas en Windows: los procesos se levantan con `Start-Process -PassThru` y se detienen por PID. En la Fase 2 quedó vivo un coordinator porque el PID leído de `netstat` en Git Bash traía `\r` y `taskkill` falló sin aviso; se detectó y detuvo en la Fase 3.

## VIRUSCITY – INTERFAZ (solo estética)

### Alcance y límites
- Solo se modifican/crean archivos en client/public (HTML, CSS, JS de presentación). Prohibido tocar auth-service/, coordinator/ y client/server.js.
- NO se cambia la lógica existente: fetch al AUTH_URL, claves de localStorage (token, username), sessionStorage 'sessionMessage', conexión WS a /connect?token=, manejo de cierres 4001/4002/otros, loggingOut. Si un cambio visual exige tocarla, DETENTE y pregunta. Las únicas excepciones permitidas están nombradas en cada fase y hay que reportarlas.
- No se agregan mensajes WS ni endpoints nuevos.
- Sin dependencias externas: nada de CDN, fuentes web, imágenes remotas ni frameworks. Todo local (SVG/CSS/JS plano con módulos ES).
- Texto dinámico siempre con textContent o fillText (nunca innerHTML en JS). El marcado estático va en los .html.
- Todo el texto visible en español.
- En la rama taller-5 SÍ se permite tocar auth-service/, coordinator/ y client/server.js, según lo indiquen las fases T1-T3.

### Estética
Ciudad de noche con neón biológico. Tokens en css/tokens.css (única fuente de colores, espacios, radios y tipografía; ningún color ni tamaño suelto en otros CSS, solo var(--...)). Títulos en var(--font-mono), mayúsculas y letter-spacing .12em. Cuerpo en var(--font-ui). Semántica de color: cian = acento/acciones/sano; verde = infectado; dorado = cura/progreso; rojo = error/peligro. Bordes de 1px var(--border), radios m/l, sombras suaves; el glow cian solo en el foco y en elementos principales.

### Accesibilidad y responsive
- Contraste AA (4.5:1 texto normal, 3:1 texto grande y gráficos). :focus-visible visible en todo elemento interactivo (anillo cian de 2px con offset 2px). Etiquetas <label> asociadas, atributos autocomplete correctos, aria-live en avisos, roles en pestañas y modales.
- Respeta prefers-reduced-motion: sin animaciones continuas (partículas, pulsos); las transiciones se reducen a opacidad.
- Login y lobby funcionan desde 360px de ancho. El juego es de escritorio primero, pero nada se rompe a 360px (el HUD se compacta).
- Objetivos táctiles de botones >= 44px de alto.

### Contrato de datos de la interfaz (planos, sin red)
scene = { world:{width,height}, playerRadius:number, me:{userId}|null, status:"healthy"|"infected"|null, players:[{userId,username,x,y,color?,badge?}] }
- status es SOLO el estado del jugador local. La interfaz NUNCA recibe ni dibuja el estado de infección de otros jugadores.
- Los módulos de UI no conocen el WebSocket: solo reciben datos por parámetros. Así, la integración posterior solo los alimenta.

### Módulos de UI (client/public/js/ui/, ES modules, con package.json {"type":"module"})
ui-config.js, avatar.js, toast.js, modal.js, lobby-view.js, hud.js, end-overlay.js, city-layout.js, scene-renderer.js, particles.js, preview.js. Las funciones puras (avatar, cámara, contraste) se prueban con node:test en client/test/.

### Vista previa (solo diseño)
Con ?preview=1 (o ?preview=<estado>) las páginas muestran datos de ejemplo sin red ni token. Existe una bandera UI.PREVIEW_ENABLED en ui-config.js (true mientras se diseña; DEBE ponerse en false antes de la entrega).

## TALLER 5 – PROYECTO FINAL PARTE II (prevalece sobre decisiones anteriores en caso de conflicto)

### Objetivo
(1) Juego en vivo: el SERVIDOR es la autoridad; el cliente NO calcula su posición, solo manda intenciones. (2) Login con Google además de usuario/contraseña; ambos producen el mismo JWT y conviven en una sola tabla users.

### Decisiones fijas
1. Tabla única, esquema EXACTO:
   CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('local','google')), password_hash TEXT, google_sub TEXT UNIQUE, email TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)
   Invariantes que se hacen cumplir en el código: local → tiene password_hash y NO google_sub; google → tiene google_sub y email y NO password_hash. Un username no se repite entre providers. En SQL, strings siempre con comillas simples.
2. Stack del auth: node:sqlite (DatabaseSync), bcryptjs, google-auth-library, express, cors, jsonwebtoken, dotenv. Se retiran better-sqlite3 y bcrypt.
3. username 3-32 con ^[a-zA-Z0-9_]+$ (único SIN distinguir mayúsculas entre todos los providers: Oscar = oscar; se conserva como se registró; cambiado a pedido del usuario); password 6-72; JWT_SECRET de al menos 32 caracteres; BCRYPT_ROUNDS >= 10.
4. JWT HS256 con payload { userId (string), username, provider ('local'|'google') } + iat/exp (JWT_EXPIRES_IN, por defecto 1h; "30s" para la demo).
5. Autenticación con Google: Opción A (Google Identity Services). El cliente manda POST /auth/google { idToken, username? }. El servidor verifica con client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID }), exige email_verified === true, usa sub como llave (google_sub), nunca el email.
6. Respuestas de /auth/google (códigos EXACTOS): 200 { token, username }; 409 { error:"username_required", hint:"..." }; 409 { error:"username_taken" }; 401 { error:"invalid_id_token" }; 401 { error:"email_not_verified" }; 400 { error:"idToken requerido" } o mensaje de validación del username.
7. /login con un usuario provider 'google' → 401 { error:"Credenciales inválidas" } idéntico al de contraseña incorrecta (sin revelar que existe; se hace un bcrypt.compare ficticio para igualar tiempos).
8. NUNCA registrar en logs: idToken, token, email, contraseña ni err.message de la verificación de Google (esa librería incluye el token en algunos mensajes).
9. Coordinador autoritativo: estado por jugador { username, provider, socket, connectedAt, x, y, intent:{x,y}, extras:{} }; game loop a TICK_RATE Hz (20 por defecto) con dt calculado con Date.now() (acotado a 0.25 s) que aplica intenciones normalizadas con Math.hypot, mantiene al jugador dentro del mundo y hace UN broadcast del state por tick (no hay broadcast en los handlers de mensajes). El handler de mensajes solo guarda intent/extras, jamás mueve.
10. Mensajes cliente→servidor: { type:"intent", intent:{ dir:{ x, y } } } (valores numéricos finitos, se sanean con Math.sign a -1/0/1) y { type:"extras_update", extras:{...} } (objeto no-array, máximo MAX_EXTRAS_BYTES=1024 bytes serializado; si trae color debe cumplir ^#[0-9a-fA-F]{6}$ o se ignora el mensaje; el color se guarda en minúsculas; extras se REEMPLAZA completo). Mensajes inválidos se ignoran sin responder ni caer. ws con maxPayload 2048 y límite de MAX_MSGS_PER_SEC=60 por socket (el exceso se descarta en silencio).
11. Mensajes servidor→cliente: welcome { type, you:{userId,username,provider}, world:{width,height,playerRadius,tickRate} }; state { type:"state", t:number, players:[{userId,username,provider,x,y,extras}] }; y se conservan los de Taller 4 (players_update al entrar/salir, cierres 4001 "invalid token" / "token expired", 4002 "replaced by new session", heartbeat, política de sesión duplicada). provider en el state lo pone el servidor desde el JWT (no es un extra del cliente).
12. Valores por defecto: WORLD_WIDTH 1200, WORLD_HEIGHT 800, PLAYER_RADIUS 16, PLAYER_SPEED 200, TICK_RATE 20. Todo configurable por .env del coordinador.
13. Cliente: la página del juego es play.html (con css/play.css y js/play/). El estado más reciente del servidor vive en la variable GLOBAL window.lastState (el mensaje state completo). El cliente no calcula posiciones: dibuja lo que dice lastState (con suavizado solo visual) y manda intenciones. Tras el login (usuario/contraseña o Google) se redirige a play.html. lobby.html del Taller 4 queda como legado, sin referencias.
14. Excepción a "sin dependencias externas": se permite SOLO el script https://accounts.google.com/gsi/client en login.html. El GOOGLE_CLIENT_ID es público y viaja en /config.js; el Client Secret no se usa ni se guarda.
15. El mínimo de 4 jugadores de Viruscity NO aplica en este taller (la demo es con dos pestañas). Nada de lógica de Viruscity aquí.
16. Pruebas: node:test en cada servicio (`npm test`). Las pruebas de Google usan un verificador falso inyectado; ningún modo de prueba existe en el código de producción.
