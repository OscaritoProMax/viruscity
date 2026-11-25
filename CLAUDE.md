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

## VIRUSCITY – METODOLOGÍA (rama viruscity; prevalece sobre decisiones anteriores en caso de conflicto)

### Ciclo de la partida
1. Fases: open_world → countdown → playing → ended → (RESULTS_MS) → open_world.
2. open_world: es el mundo abierto actual; todos caminan libres, sin roles, misiones ni cura. Cuando hay >= MIN_PLAYERS_TO_START (3) jugadores conectados EN TODO EL CLÚSTER empieza countdown de MATCH_COUNTDOWN_MS (10 s). Si baja de 3 durante la cuenta, vuelve a open_world.
3. Al llegar a 0 arranca la partida con roster = los jugadores conectados en ese instante. Se sortea UN infectado inicial al azar. Todos aparecen en la plaza (centro del mundo) en círculo de radio 80, ordenados por userId. Quien entre durante la partida es espectador ("fantasma") hasta la siguiente.
4. Fin: ended durante RESULTS_MS (15 s) con los roles revelados; luego open_world (se borran roles, misiones y cura).

### Infección
5. Acción 'infect' (tecla F). Solo un infectado con infectReadyAt <= ahora, sobre el SANO del roster más cercano a INFECT_RANGE (70 px; el árbitro aplica además RANGE_TOLERANCE 25 px). Sin objetivo → { ok:false, reason:'no_target' } y NO consume enfriamiento. Con éxito: la víctima pasa a infectada con infectReadyAt = ahora + NEW_INFECTED_LOCK_MS (3 min); el atacante infectReadyAt = ahora + INFECT_COOLDOWN_MS (2 min). El infectado inicial empieza con infectReadyAt = inicio + INITIAL_LOCK_MS (60 s). La víctima pierde su misión en curso.
6. Todo infectado puede contagiar (el virus se propaga). Los infectados no hacen misiones.
7. Información oculta: ningún cliente recibe el rol de otro jugador salvo en game_over (results). Un infectado no sabe quiénes más lo están. Los extras (color) NUNCA llevan datos de la partida. /status y state nunca llevan roles.
8. Alerta pública: cada contagio genera un evento 'contagion_alert' para TODOS con la zona más cercana a la víctima ("Nuevo contagio detectado cerca de <zona>"), sin nombres ni ids.

### Misiones y cura
9. Ciudad: 6 zonas (Hospital, Laboratorio, Farmacia, Central de datos, Planta de síntesis, Almacén) con 2 estaciones cada una = 12 misiones fijas. La partida se juega SOLO en el mapa principal de Virus City: cada zona es un edificio real (Hospital Virus Care, Laboratorio Vega, Farmacia, Central de datos, Planta de síntesis y Almacén) y sus estaciones están en la acera de su entrada; la plaza de aparición es el ala este de la Plaza Mayor. Fuente única: client/public/js/play/map/match-places.js, exportada por `npm run map` en virus-city.json (campo city); el coordinador la valida y la usa con MAP_FILE. Sin mapa (pruebas), coordinator/city.js las da normalizadas × tamaño del mundo. El servidor las envía al cliente en welcome.city.
10. Por partida se eligen al azar M = min(12, 3 × (roster − 1)) misiones. Son compartidas y se completan UNA sola vez; cualquier sano puede hacer cualquiera.
11. Flujo: mission_start (estar a <= MISSION_RANGE 60 px + tolerancia de la estación, misión 'available', rol sano en el roster, sin otra misión activa) → la misión pasa a 'in_progress' reservada a ese jugador, que queda INMÓVIL (el servidor ignora su movimiento) → mission_complete (el cliente resolvió el minijuego): válido si pasaron >= MISSION_MIN_MS (8 s) y <= MISSION_MAX_MS (45 s) desde mission_start, el jugador sigue en rango y sigue sano → misión 'done' y cure += 100/M (la última deja exactamente 100). mission_cancel la libera. Se libera sola si expira MISSION_MAX_MS, si el jugador se infecta, se desconecta o se aleja más del rango + tolerancia.
12. La barra de cura (0-100) es pública para todos, infectados incluidos. La lista de misiones es pública (zona, título, tipo, estado available/in_progress/done), NUNCA quién la hace.
13. Misiones (id = id de la estación; zona; título; minijuego): hospital-1 "Recolectar muestras de pacientes" sequence; hospital-2 "Esterilizar el quirófano" hold; laboratorio-1 "Analizar la muestra del paciente cero" slider; laboratorio-2 "Secuenciar el genoma del virus" code; farmacia-1 "Preparar el suero base" wires; farmacia-2 "Etiquetar las dosis" code; central-1 "Restaurar el registro de contagios" wires; central-2 "Descargar el historial clínico" hold; planta-1 "Sintetizar el compuesto" slider; planta-2 "Purificar el reactor" sequence; almacen-1 "Cargar el suero en los camiones" hold; almacen-2 "Inventariar el cargamento" code. Tipos de minijuego: sequence, code, wires, slider, hold.

### Victoria
14. Ganan los jugadores (winner "players") cuando cure >= 100. Ganan los infectados (winner "infected") cuando no queda ningún sano en el roster (se evalúa tras cada contagio y cada baja) o cuando se agota MATCH_DURATION_MS (15 min) sin cura. Si no queda ningún infectado en el roster, ganan los jugadores. Si el roster queda con menos de 2 personas (conectadas o en gracia) la partida se cancela y vuelve a open_world con aviso. Orden de evaluación: cure, sin sanos, sin infectados, tiempo.
15. Desconexión: el miembro del roster desconectado conserva su rol RECONNECT_GRACE_MS (60 s) y su misión se libera de inmediato; si reconecta (a cualquier coordinador) en ese plazo recupera su rol y reaparece en su punto de la plaza; si no, sale del roster y se reevalúan las condiciones de victoria.

### Árbitro y clúster
16. Un solo árbitro decide la partida: el coordinador de menor coordinatorId entre él mismo y sus peers ready. Los demás reenvían las acciones de sus jugadores al árbitro y reciben el estado replicado. Si el árbitro cae, el siguiente menor asume con el último estado replicado (una misión en curso puede perderse). La partida usa las posiciones de la simulación de cada coordinador (las remotas con tolerancia).
17. Mensajes nuevos del mesh (validados como todos): game_action { type, origin, userId, action:{ kind:'infect'|'mission_start'|'mission_complete'|'mission_cancel', missionId? } } (solo el dueño del jugador la envía; solo el árbitro la procesa) y game_state { type, origin, handover?, match, events:[...] } (del árbitro a todos). El árbitro replica cada MATCH_REPLICATE_MS (250 ms) en countdown/playing/ended, cada 1000 ms en open_world, y de inmediato tras procesar una acción (máximo una por 50 ms). match.rev crece en cada cambio.
18. Aceptación de game_state en un coordinador C: (a) si origin es el árbitro que C calcula, se adopta siempre; (b) si trae handover:true, C es el árbitro calculado y (C aún no tiene estado o (matchId, rev) del mensaje es mayor que el propio), se adopta y C sigue siendo árbitro; (c) en cualquier otro caso se ignora. Un árbitro recién elegido SIN estado (arrancó de cero o se reincorporó) con al menos un peer ready espera hasta GAME_SYNC_WAIT_MS (1500) un handover antes de avanzar la partida. El árbitro saliente (el que deja de serlo porque aparece un id menor) envía handover:true a ese peer al completar el handshake.
19. Eventos: cada evento lleva eid creciente (match.eid, que no se reinicia entre partidas) y opcionalmente to (userId). Cada coordinador entrega a sus clientes locales solo eventos con eid mayor al último entregado (si match.eid retrocede respecto al último entregado, se reinicia ese contador); los que llevan to solo si ese jugador es local.

### Protocolo con el cliente
20. Cliente → servidor: { type:'game_action', action:'infect'|'mission_start'|'mission_complete'|'mission_cancel', missionId? } (máx. 5/s por socket; missionId con patrón ^[a-z0-9-]{1,40}$).
    Servidor → cliente:
    - welcome gana city:{ zones:[{id,name,x,y,w,h}], stations:[{id,zoneId,x,y}], plaza:{x,y} } y game:{ minPlayers, missionMinMs, missionMaxMs, infectRange, missionRange }.
    - game (cada GAME_VIEW_MS=250 y tras cada evento; personalizado): { type:'game', serverTime, phase, minPlayers, connected, countdownEndsAt?, startedAt?, endsAt?, resultsEndsAt?, cure, missions:[{id,zoneId,stationId,x,y,title,kind,status}], you:{ role:'healthy'|'infected'|'spectator'|null, infectReadyAt:number|null, missionId:string|null, missionStartedAt:number|null }, results?:{ winner, reason, players:[{userId,username,role}] } }. you.role es null en open_world y countdown; results solo en ended; infectReadyAt solo para un infectado del roster.
    - event: { type:'event', kind, ... } con kinds: match_started {role}; you_infected; infect_result {ok, reason?}; mission_started {missionId}; mission_result {ok, missionId, reason?}; contagion_alert {zone}; cure_update {cure}; match_cancelled {reason}; match_ended {winner}. Motivos de fallo: not_playing, spectator, not_infected, cooldown, no_target, not_healthy, busy, not_available, too_far, too_fast, expired, infected, cancelled, no_active_mission, arbiter_unavailable.
    - state (20 Hz) mantiene su formato y añade ghost:true a los jugadores fuera del roster durante playing (se dibujan translúcidos y no interactúan).

### Config del coordinador (env; defaults; solo balance y pruebas)
MIN_PLAYERS_TO_START=3, MATCH_COUNTDOWN_MS=10000, INITIAL_LOCK_MS=60000, INFECT_COOLDOWN_MS=120000, NEW_INFECTED_LOCK_MS=180000, MATCH_DURATION_MS=900000, RESULTS_MS=15000, RECONNECT_GRACE_MS=60000, MISSION_MIN_MS=8000, MISSION_MAX_MS=45000, INFECT_RANGE=70, MISSION_RANGE=60, RANGE_TOLERANCE=25, MATCH_REPLICATE_MS=250, GAME_TICK_MS=200, GAME_VIEW_MS=250, GAME_SYNC_WAIT_MS=1500.

### Pruebas
- El reducer de la partida (match.js) y las vistas son PUROS, con reloj (ctx.now) y rng inyectables; pruebas node:test exhaustivas e inmutabilidad verificada. Smoke de partidas completas con tiempos reducidos por env: `npm run smoke:viruscity` (con 1 y con 3 coordinadores).

## TALLER 7 – PROYECTO FINAL PARTE IV (prevalece sobre decisiones anteriores en caso de conflicto)

### Objetivo
Varios auth-services replicados con single-writer replication: un líder a la vez acepta escrituras, las réplicas leen y mantienen una copia local de la BD, y si el líder muere se elige otro. Coordinadores y cliente usan AUTH_URLS con failover. Los jugadores conectados NO se desconectan al caer auths: el coordinador valida el JWT sin consultar al auth (no cambiar eso).

### Nodos y mesh de auth
1. Cada auth tiene AUTH_ID (^[A-Za-z0-9_-]{1,32}$), PORT (HTTP público), PEER_PORT (WS del mesh), PUBLIC_URL (http/https que usan clientes y coordinadores; debe coincidir EXACTO, sin barra final, con su entrada en AUTH_URLS), PEER_URL (ws/wss) y AUTH_NODES: lista estática de TODOS los nodos incluido él, entradas `id|publicUrl|peerUrl` separadas por comas. N = tamaño de AUTH_NODES; mayoría = floor(N/2)+1. Sin AUTH_NODES = clúster de uno (líder desde el arranque, AUTH_ID por defecto "auth-solo"). Ejemplos: auth-a 4001/4101, auth-b 4002/4102, auth-c 4003/4103. Scripts start:a/b/c con `node index.js --env .env.auth-X` (el start único se conserva). Una BD por nodo (DB_PATH=./users-a.db ...). JWT_SECRET, CLUSTER_SECRET y GOOGLE_CLIENT_ID idénticos en todos.
2. Roles: leader | replica (internamente también candidate; /status lo expone como replica con election:true). Un solo líder por término. Solo el líder acepta escrituras.
3. Una sola conexión por par: inicia el authId MENOR (comparación de strings); si llega una entrante de un id MAYOR y ya hay una activa hacia él, se cierra la nueva (4010 "duplicate peer"); si llega de un id MENOR reemplaza a cualquier previa. Seguridad igual que el mesh de coordinadores: x-cluster-secret en el upgrade (sha256 + timingSafeEqual), hello en 3 s (4011), id desconocido (fuera de AUTH_NODES) rechazado, el remitente de cada mensaje debe coincidir con el id del peer de esa conexión, ping/pong cada AUTH_PEER_PING_MS, límite de 500 msgs/s, maxPayload 2 MB y validación estricta de cada mensaje.
4. Mensajes (JSON; los campos con + son adicionales al enunciado): hello {type, authId, role, term, +leaderId, +lastSeq, +lastTerm}; heartbeat {type, authId, term, lastSeq, +lastTerm}; +heartbeat_ack {type, authId, term, lastSeq}; write_propagate {type, term, seq, +entryId, op, data}; +write_ack {type, authId, term, seq, entryId, ok, reason?}; +write_abort {type, term, seq, entryId}; request_sync {type, fromSeq, +fromEntryId}; sync_response {type, +term, entries:[{seq, +term, +entryId, op, data}], +conflict, +done}; election {type, candidate, term, lastSeq, +lastTerm}; vote {type, voter, term, voteGranted}; new_leader {type, leader, term}. El receptor de una conexión contesta el hello con el suyo.

### Elección y estabilidad (estilo Raft simplificado)
5. Término monótono, persistido en meta junto con votedFor ANTES de contestar un voto. El líder emite heartbeat cada AUTH_HEARTBEAT_MS (2000). Una réplica sin contacto del líder durante LEADER_TIMEOUT_MS (6000) + jitter aleatorio 0..ELECTION_JITTER_MS (1500) se vuelve candidata: término+1, vota por sí misma y envía election. Concede el voto si el término del candidato es >= al propio, no votó por otro en ese término y su log está al día (lastTerm mayor, o lastTerm igual y lastSeq >= propio). Gana con mayoría: anuncia new_leader y envía heartbeat inmediato. Si la elección vence sin ganador, nuevo término tras otro jitter. Cualquier mensaje con término mayor baja a líderes y candidatos a réplica.
6. Estabilidad: un nodo que escuchó a un líder en los últimos (LEADER_TIMEOUT_MS − 1000) ms NO concede votos ni adopta el término de un candidato (un nodo que vuelve no derriba a un líder sano). Un hello o heartbeat de un líder con término >= al propio se adopta de inmediato. Elección de arranque: un nodo sin líder conocido, con handshake completo con una mayoría (él cuenta) y sin que ningún peer reporte líder (hello.leaderId nulo y role replica) lanza su elección tras un retardo aleatorio de 500..1500 ms (para no esperar 6 s en un arranque en frío). Un nodo que vuelve se incorpora como réplica y sincroniza; nunca recupera el liderazgo por su id.
7. Lease: las réplicas contestan cada heartbeat con heartbeat_ack. Un líder sin contacto con una mayoría (él cuenta) durante LEADER_TIMEOUT_MS se baja a réplica sin líder conocido. Consecuencia documentada: con 2 de 3 nodos caídos el sistema deja de aceptar logins y registros nuevos (los jugadores conectados siguen; el directorio de coordinadores sigue respondiendo).

### Persistencia y consistencia
8. Cada nodo guarda users (esquema EXACTO del Taller 5), oplog(seq INTEGER PRIMARY KEY, term INTEGER NOT NULL, entry_id TEXT NOT NULL UNIQUE, op TEXT NOT NULL, data TEXT NOT NULL) y meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) con current_term y voted_for. lastAppliedSeq = max(seq) del oplog; lastTerm = term de esa entrada (0 si está vacío). Ops: "register" y "register_google" con data { userId (entero), username, provider, password_hash | google_sub + email, created_at }. Arranque con users pero oplog vacío (BD heredada): se generan entradas deterministas (seq = posición por id, term 0, entry_id `legacy-<id>`, op según provider). Las entradas se aplican siempre en orden estricto (seq = lastAppliedSeq + 1), en una transacción atómica oplog+users.
9. Consistencia = OPCIÓN B con mayoría. El líder serializa las escrituras con un mutex; dentro del mutex valida contra su BD, calcula userId = MAX(id)+1 y arma la entrada (seq = lastSeq+1, term actual, entryId uuid); envía write_propagate a las réplicas conectadas; espera acks de mayoría (él cuenta) hasta WRITE_TIMEOUT_MS (3000); con mayoría aplica en su BD y responde tras esperar además hasta ACK_GRACE_MS (150) a las réplicas restantes conectadas (para que /status coincida en todos). Las réplicas aplican AL RECIBIR y contestan write_ack. El líder NO aplica antes de tener mayoría. Sin mayoría de nodos conectados al empezar → 503 { error:"no_quorum" } sin proponer; si vence el tiempo → write_abort y 503 { error:"replication_timeout" }; quien la tenía deshace (borra la fila de users y la del oplog, solo si es la última entrada y coincide el entryId). Justificación para el README: no perder escrituras confirmadas; costo: un RTT de latencia y bloqueo sin mayoría. Resultado ambiguo documentado: si el líder cae tras proponer y antes de responder, el cliente ve error pero la escritura puede existir (un reintento da 409).
10. Conflictos: un write_propagate con seq <= lastAppliedSeq: mismo entry_id → ack idempotente; distinto y seq == lastAppliedSeq → se deshace la última y se aplica la nueva; distinto con seq < lastAppliedSeq, o una violación de unicidad (username, google_sub, id) al aplicar → resincronización completa (borrar users y oplog y pedir sync desde 0). seq > lastAppliedSeq+1 (hueco) → request_sync. Solo se aceptan write_propagate y sync_response del líder del término actual o mayor; con término menor se contesta ok:false (reason "stale_term") con el término propio.
11. Sync: request_sync { fromSeq: lastAppliedSeq, fromEntryId } cuando (a) hace handshake con el líder y le falta, (b) un heartbeat trae lastSeq mayor, (c) detecta un hueco. El líder responde con las entradas con seq > fromSeq en lotes de SYNC_BATCH (500; done:false salvo el último); si su entrada en fromSeq no coincide con fromEntryId o fromSeq > su lastSeq → conflict:true y envía todo desde 1 (la réplica borra y reaplica). Un solo request_sync en vuelo por conexión.
12. Lecturas en réplica (/login y /auth/google de usuario existente): se responden localmente solo si hay líder conocido y leaderSeq − mySeq < READ_TOLERANCE (10), con leaderSeq = lastSeq del último heartbeat. Además, si la lectura FALLARÍA (usuario inexistente o credenciales inválidas) y mySeq < leaderSeq → 503 not_leader en lugar de 401. Más atrasada que la tolerancia → 503 { error:"not_leader", leaderUrl, leaderId }. Sin líder conocido (elección) → 503 { error:"no_leader" }, también para lecturas. Nunca se emite un token con la BD atrasada.
13. Escrituras en réplica (/register, primer login con Google): 503 { error:"not_leader", leaderUrl, leaderId } (sin líder: 503 { error:"no_leader" }). Otros 503: no_quorum, replication_timeout. Todas las respuestas del auth llevan X-Auth-Id y X-Auth-Role (CORS los expone). Durante una elección las escrituras fallan y el cliente debe reintentar.
14. GET /status → { authId, role, publicUrl, peerUrl, leaderUrl (null si no se conoce), knownPeers:[ids de los OTROS nodos], lastAppliedSeq, users, +term, +leaderId, +election, +lastTerm, +checksum (sha256 hex de las líneas `id:username` ordenadas por id) }. GET /peers → { peers:[{ authId, publicUrl, peerUrl, role, +connected }] } de los OTROS nodos (role "leader" si es el líder conocido, si no "replica"). El /peers de COORDINADORES del Taller 6 pasa a GET /coordinator-peers con la misma forma { peers:[{ coordinatorId, peerUrl }] }.
15. Directorio de coordinadores (estado blando): cada coordinador envía su heartbeat HTTP a TODOS los auth de AUTH_URLS (no solo al líder), así cualquier nodo responde /coordinator, /coordinator-peers y /directory incluso durante una elección o sin líder. No pasa por el log de replicación ni por las puertas de lectura.

### Coordinadores y cliente
16. AUTH_URLS (lista separada por comas) reemplaza a AUTH_URL en coordinator y client (si solo existe AUTH_URL, es una lista de uno). Failover (misma lógica en ambos): empezar por el último nodo que respondió; error de red, timeout (4 s) o 5xx distinto de los 503 listados → siguiente nodo; 503 not_leader con leaderUrl EXACTAMENTE igual (normalizada, sin barra final) a una entrada de AUTH_URLS → reintento inmediato contra esa URL (una vez); 503 no_leader / no_quorum / replication_timeout / not_leader sin URL permitida → siguiente nodo y, tras una pasada completa sin éxito, espera de 1 s y nueva pasada hasta un presupuesto de 12 s; cualquier otra respuesta (2xx/4xx) se devuelve. Se registra si hubo reintentos (retried): un /register reintentado puede dar 409 aunque haya funcionado (la UI lo explica: "si acabas de registrarte, inicia sesión").
17. UI: login.html y play.html muestran "Auth: <authId> (líder|réplica)" tomado de X-Auth-Id y X-Auth-Role de la última respuesta.

### Gateway para ngrok (opcional, solo demo)
18. El plan gratuito de ngrok permite pocos endpoints (3 según la documentación actual) y el sistema necesita 7 URLs públicas. Solución: gateway/ (paquete propio) = proxy HTTP + WS por prefijo de ruta con UN solo túnel: / → client (3000); /auth-a /auth-b /auth-c → 4001-4003; /coord-a /coord-b /coord-c → 5001-5003 (se quita el prefijo al reenviar y se soportan upgrades WS). Las URLs públicas pasan a ser https://<dominio>/auth-a, wss://<dominio>/coord-a, etc.; el mesh y los heartbeats siguen por localhost.

### Config del auth (env; defaults)
AUTH_HEARTBEAT_MS=2000, LEADER_TIMEOUT_MS=6000, ELECTION_JITTER_MS=1500, READ_TOLERANCE=10, WRITE_TIMEOUT_MS=3000, ACK_GRACE_MS=150, SYNC_BATCH=500, AUTH_PEER_PING_MS=3000.

### Pruebas
Núcleo de elección puro y nodo de replicación con reloj falso y transporte en memoria (caídas, particiones, reinicios, pérdidas de mensajes); smoke multi-proceso `npm run smoke:auth-cluster` (auth) y `npm run smoke:full` (auth + coordinadores + jugador). Regresión: las pruebas y smokes de Taller 5 y 6 siguen pasando.
