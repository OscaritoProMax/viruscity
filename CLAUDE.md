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
- Nombres: "Heroína 11" y "Explorador Pop" (cercanos a los de las demos). El usuario pidió renombrar al tercero con un nombre muy parecido a CJ; se mantuvo "Mensajero", porque renombrar no deja de recrear un personaje de un juego existente. Sus herramientas (mochila cohete, aerosol y subfusil) sí se usaron como poderes.
- Poderes (pedido del usuario): extras.power (validado por personaje en resolveLook) y extras.powerOn durante POWER_MS = 700 ms (tecla E o botón). Efectos solo visuales en characters/powers.js; la escopeta y la espada del Explorador volvieron.
- play.html a pantalla completa: barra superior, jugadores y "Tu personaje" (pestañas Personaje, Colores y Poder) superpuestos y plegables; en pantallas angostas (< 700 px) empiezan plegados.
- Interiores (pedido del usuario): Burger Neón y Supermercado de la referencia en una zona de interiores del mismo mundo (filas 60-79; mundo 3840 × 3840, WORLD_HEIGHT=3840). Las puertas son portales en la grilla del servidor (map.portals; stepPlayers traslada al jugador). No se agregó ningún campo al protocolo: el escenario se deduce de (x, y) con sceneAt y cada cliente dibuja solo a los del mismo escenario.
- Entradas visibles (pedido del usuario): puertas en amarillo en el minimapa (como buildMinimap de la referencia), cartel "ENTRAR · <local>" con flecha en el mapa y "SALIDA" dentro. El minimapa usa la escala de la ciudad (CITY_WIDTH/HEIGHT), no la del mundo con interiores.
- Posición persistente (pedido del usuario): recargar la página o abrir otra pestaña ya no da una aparición al azar (era un teletransporte). El coordinator guarda la última posición por userId al desconectar (lastPositions, en memoria) y la sesión duplicada hereda la de la anterior; resumePosition valida que siga libre y dentro del mundo. Smoke G13 y G14.
- Conversaciones (E) con vecinos y carteles de la referencia: locales, sin red; mientras se conversa se envía la intención {0, 0}. El poder pasó de E a Q. El radio para hablar se amplía 24 px porque la caja del servidor es más alta que la de pies de la referencia.
- Sonido con Web Audio, sin archivos: efectos de la referencia (pasos, puertas, campana, blip, rocola) y uno por poder. Radio Virus 86.6 FM: tres canciones synthwave generadas en el navegador; programa y compás calculados con la hora del servidor (offset con la muestra de menor latencia), así todos oyen lo mismo. Botones para silenciar radio y efectos (localStorage).
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

## TALLER 6 – PROYECTO FINAL PARTE III (prevalece sobre decisiones anteriores en caso de conflicto)

### Objetivo
Varios coordinadores en paralelo, intercambiables, con el mismo estado del juego. El auth-service además es directory service. Cada cliente hace login → GET /coordinator → WS al coordinador asignado. Los coordinadores forman un mesh por WebSocket (cada uno se conecta a todos los demás). No confundir el heartbeat WS de clientes (HEARTBEAT_INTERVAL_MS) con el heartbeat HTTP al auth (HEARTBEAT_AUTH_MS).

### Auth (directory service)
1. POST /heartbeat, body { coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime } → 200 { ok:true }. Exige el header x-cluster-secret (= CLUSTER_SECRET); si falta o no coincide → 401 { error:"invalid_cluster_secret" } (comparación en tiempo constante). Validación → 400: coordinatorId ^[A-Za-z0-9_-]{1,32}$; publicUrl y peerUrl URLs válidas con protocolo ws: o wss: (máx. 200 caracteres); connectedPlayers entero >= 0; uptime número >= 0. Máximo 50 coordinadores → 503 { error:"directory_full" }.
2. Directorio en memoria Map<coordinatorId, { ...info, lastSeen }>. Vivo si Date.now() - lastSeen <= COORDINATOR_TTL_MS (6000). Los muertos no se devuelven y se purgan (barrido cada 2 s).
3. GET /coordinator (público): el vivo con menor carga efectiva = connectedPlayers + reservas activas; empate → el primero en orden de registro; 200 { coordinatorId, publicUrl }; sin vivos → 503 { error:"no_coordinators_available" }. Cada 200 crea una reserva de RESERVATION_TTL_MS (3000; 0 la desactiva) para ese coordinador. Cache-Control: no-store.
4. GET /peers (público): 200 { peers:[{ coordinatorId, peerUrl }] } solo vivos, en orden de registro.
5. GET /directory (público, depuración): 200 { coordinators:[{ coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime, ageMs }], ttlMs } solo vivos.
6. Env nuevas del auth: CLUSTER_SECRET (>= 32 caracteres), COORDINATOR_TTL_MS=6000, RESERVATION_TTL_MS=3000.

### Coordinador
7. Config por instancia (.env o --env <archivo>; las variables ya presentes en el entorno prevalecen): COORDINATOR_ID, PORT (clientes), PEER_PORT (mesh; distinto de PORT), PUBLIC_URL (ws:// o wss:// que usan los CLIENTES), PEER_URL (la que usan los otros coordinadores), AUTH_URL, CLUSTER_SECRET, JWT_SECRET y las del juego. Ejemplos: coord-a 5001/5101, coord-b 5002/5102, coord-c 5003/5103. Scripts start:a, start:b, start:c con `node index.js --env .env.coord-X` (multiplataforma, sin variables inline).
8. Heartbeat HTTP al auth cada HEARTBEAT_AUTH_MS=2000 con connectedPlayers = SOLO jugadores locales y uptime en segundos enteros. Si el auth no responde, el coordinador SIGUE funcionando; el aviso se registra solo cuando cambia el estado (arriba/abajo), no cada 2 s.
9. Descubrimiento: al arrancar y cada PEER_DISCOVERY_MS=3000, GET {AUTH_URL}/peers, filtra su propio id y abre conexión saliente SOLO hacia peers con id MAYOR que el suyo (comparación `<` de JS sobre strings) que aún no tengan conexión; los de id menor esperan que ellos conecten.
10. Una sola conexión por par: si llega una conexión entrante de un peer con id MAYOR y ya existe una activa hacia él, se cierra la nueva (4010 "duplicate peer"); si no hay ninguna, se acepta; si llega de un id MENOR, reemplaza a cualquier conexión previa con ese peer (la vieja se cierra con 4010).
11. Seguridad del mesh: el servidor peer exige x-cluster-secret válido en el upgrade (si no, 401 y destroy); el primer mensaje debe ser hello en 3 s o se cierra (4011 "hello timeout"); hello.coordinatorId debe cumplir el patrón y ser distinto del propio. El receptor contesta con su propio hello; el iniciador verifica que el id coincida con el esperado; tras eso ambos hacen el resync. Cada mensaje posterior al hello lleva origin igual al id del peer de esa conexión (si no, se ignora); los mensajes con origin igual al propio id se descartan (anti-bucles). Nada se retransmite: cada origen envía directamente a cada peer.
12. Mensajes del mesh (JSON): hello { type, coordinatorId }; player_joined { type, origin, userId, username, provider, x, y, connectedAtMs }; player_left { type, origin, userId }; intent_replicate { type, origin, userId, intent:{ dir:{ x, y } } }; extras_replicate { type, origin, userId, extras }; positions_sync { type, origin, players:[{ userId, x, y }] } (adicional, cada PEER_SYNC_MS=1000). userId viaja como string (si llega número se convierte con String()). Todo se valida con las funciones del juego (sanitizeIntent, sanitizeExtras, username 3-32, provider en {local,google}, x/y finitos y dentro del mundo). maxPayload de peers: 262144.
13. Propiedad: cada jugador tiene ownerId (el coordinador donde está su cliente). SOLO el dueño puede mandar intent_replicate, extras_replicate, positions_sync y player_left de ese jugador; si el origin no es el dueño, se ignora.
14. Estado: cada coordinador mantiene en players a TODOS los jugadores (locales con socket; remotos con socket null y ownerId del peer). El game loop (20 Hz) aplica intents a todos; el broadcast de state y de players_update va SOLO a sus clientes locales, pero ambos incluyen a todos los jugadores del mundo, cada uno con coordinatorId (su dueño). welcome y state incluyen el coordinatorId propio.
15. Al conectar un cliente local: se crea el jugador (spawn aleatorio, ownerId propio); si ya existía como local, se cierra el viejo con 4002 (política de Taller 4); si existía como remoto, el nuevo lo reemplaza; se envía player_joined a los peers y players_update a los locales. Al desconectarse: player_left a los peers (solo si el socket que cierra sigue siendo el vigente).
16. Conflicto de sesión entre coordinadores (player_joined de un usuario que ya existe): si existe LOCAL aquí, gana la conexión con mayor connectedAtMs (empate: mayor coordinatorId). Si gana la entrante, se cierra el socket local con 4002 "replaced by new session" y el jugador pasa a remoto con ownerId = origin (SIN enviar player_left); si gana la local, se ignora la entrante. Si existe REMOTO, se reemplaza solo si la entrante es más nueva (mismo criterio).
17. Resync al completar el handshake con un peer: se le envían los jugadores LOCALES como player_joined (con x,y actuales y el connectedAtMs original del registro), luego su intent (intent_replicate, si no es 0,0) y sus extras (extras_replicate, si no están vacíos).
18. Peer caído: al cerrarse la conexión con un peer se eliminan todos los jugadores remotos de ese ownerId y se envía players_update a los locales. Ping/pong entre peers cada PEER_PING_MS=3000 (terminate si no hay pong en el siguiente ciclo).
19. Ctrl+C (SIGINT/SIGTERM): detiene heartbeat y descubrimiento, cierra clientes con 1001 y los peers, y sale. NO se desregistra del auth: el directorio lo descarta por TTL (es lo que se demuestra).
20. Un coordinador sin peers funciona solo (clúster de uno); sin auth tampoco se cae.
21. GET /status en el puerto de clientes: { coordinatorId, uptime, localPlayers, totalPlayers, peers:[ids con handshake completo], authReachable }.

### Cliente
22. Flujo: login → GET {AUTH_URL}/coordinator (con header ngrok-skip-browser-warning) → { coordinatorId, publicUrl } → WS a `${publicUrl}/connect?token=...`. Se muestra "Tick: N Hz · Coordinador: <id>" (N y el id vienen de welcome). Cada jugador de la lista muestra su coordinatorId.
23. Si el WS se cae por cualquier causa distinta de 4001/4002/logout: NO se reconecta al mismo directamente; se pide otra vez GET /coordinator y se conecta al que diga, esperando min(1000*intento, 3000) ms, máximo 20 intentos (luego, login con mensaje). 4001 y 4002 → login con mensaje, sin reintentos. 503 → aviso "Sin coordinadores disponibles. Reintentando…" y se sigue reintentando.
24. Si publicUrl empieza por ws:// y la página es https:// (y el host no es localhost/127.0.0.1/[::1]) se muestra un error claro de contenido mixto en lugar de intentar conectar.
25. client/public/cluster.html: tabla que se refresca cada 1 s desde GET {AUTH_URL}/directory; sin innerHTML.
26. COORDINATOR_WS_URL deja de ser obligatorio en client/server.js (opcional, vacío por defecto).

### Seguridad y pruebas
- Nunca registrar CLUSTER_SECRET, JWT_SECRET, tokens ni contenido de mensajes. Secreto comparado con sha256 + crypto.timingSafeEqual.
- Pruebas: node:test para la lógica pura (directory.js, mesh.js, módulos del cliente) y un smoke multi-proceso (`npm run smoke:cluster`) que levanta auth + coordinadores en puertos de prueba. Regresión: `npm run smoke` del Taller 5 debe seguir pasando con un coordinador solo.
