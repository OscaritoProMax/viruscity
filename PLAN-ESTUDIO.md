# Plan de estudio: Viruscity · Sistemas Distribuidos (Partes I–IV + juego)

## Contexto
Para la sustentación final hay que poder explicar con seguridad el software: la arquitectura, las reglas fijas, las funciones clave, los patrones distribuidos y las reglas del juego Viruscity. El código está repartido así:
- **Talleres 4 a 7:** rama `taller-7`.
- **Juego Viruscity:** rama `viruscity`. Sus archivos (`coordinator/match.js`, `arbiter.js`, `missions.js`, `city.js` y `client/public/js/vc/`) se ven con `git checkout viruscity` o `git show viruscity:<ruta>`; después de la fusión estarán en una sola rama.

Este plan ordena el estudio de lo general a lo específico. Cada sesión dice qué leer, qué ejecutar y qué preguntas responder sin mirar. Sirve hasta el día de la sustentación.

**Resultado al terminar:**
- Dibujar la arquitectura de memoria.
- Explicar cada flujo (login, conexión, movimiento, elección, replicación, partida).
- Defender cada decisión con su porqué.
- Hacer las demos sin apuntes.

---

## Cómo estudiar cada sesión (≈ 2 h)
1. **Repaso (10 min):** repasar en voz alta la "Hoja de memoria" del final.
2. **Leer (40 min):** primero la sección del README indicada, luego las funciones listadas en el código. Lee las pruebas de esa parte: dicen qué debe pasar.
3. **Hacer (40 min):** el ejercicio práctico (levantar, romper, observar).
4. **Autoevaluar (20 min):** responder las preguntas por escrito, sin mirar, y luego comprobar.
5. **Explicar (10 min):** contar el tema en 2 minutos como si fuera la sustentación (grábate si puedes).

---

## Sesión 0: mapa general
- **Leer:** el inicio del README (las tres piezas y los puertos), el diagrama del Taller 7 §1 y la estructura del repositorio.
- **Hacer:** levantar todo en local con las 7 terminales:
  - `auth-service`: `npm run start:a`, `start:b`, `start:c`
  - `coordinator`: `npm run start:a`, `start:b`, `start:c`
  - `client`: `npm start`

  Entra con dos pestañas y abre `cluster.html`.
- **Preguntas:**
  - ¿Qué proceso guarda los usuarios?
  - ¿Cuál decide la posición de los jugadores?
  - ¿Cuál sirve las páginas?
  - ¿Qué puertos usa cada uno y para qué son 4101–4103 y 5101–5103?

---

## Bloque A · Parte I (Taller 4): base

### Sesión 1: auth-service (registro, login, JWT)
- **Leer:**
  - README "Parte I · Taller 4" y "Parte II · Taller 5" §2 y §4 (API del auth).
  - `auth-service/app.js`: `createApp` (rutas /register y /login) y `validateUsername`.
  - `auth-service/db.js`: `ensureSchema`, `createStatements`, índice `NOCASE`.
- **Conceptos:**
  - bcrypt (sal, rounds ≥ 10, límite de 72 bytes).
  - JWT HS256: payload `{userId (string), username, provider}`, `iat` y `exp`.
  - Por qué el login fallido siempre da 401 "Credenciales inválidas" (no revelar si el usuario existe).
  - Usernames únicos sin distinguir mayúsculas.
- **Hacer:** registrar y entrar con `curl` (ejemplos del README T5 §4) y decodificar el token con `node -e` (base64 del payload). Cambia `JWT_EXPIRES_IN=30s` y observa el cierre.
- **Preguntas:**
  - ¿Por qué el `userId` es string?
  - ¿Por qué no se registra el body en los logs?
  - ¿Qué pasa si `JWT_SECRET` difiere entre auth y coordinador?

### Sesión 2: coordinador WebSocket
- **Leer:** `coordinator/index.js`:
  - `verifyToken` (upgrade de `/connect?token=`);
  - `send` y `broadcastPlayers`;
  - el temporizador de expiración y el heartbeat ping/pong.
- **Conceptos:**
  - Códigos de cierre 4001 "invalid token" / "token expired" y 4002 "replaced by new session".
  - Política de sesión duplicada: gana la nueva.
  - Heartbeat de 30 s.
- **Hacer:** abre la misma cuenta en dos pestañas (4002) y prueba un token alterado (4001).
- **Preguntas:**
  - ¿Por qué se valida el JWT sin consultar al auth? (Clave para el Taller 7: los jugadores no se caen si caen los auth.)

---

## Bloque B · Parte II (Taller 5): juego autoritativo y Google

### Sesión 3: servidor autoritativo y mapa
- **Leer:**
  - README T5 §5, §7 y §12.
  - `coordinator/game.js`: `sanitizeIntent`, `sanitizeExtras`, `stepPlayers`, `moveAxis`, `boxBlocked`, `clampDt`, `parseMap`, `randomSpawn`, `portalAt`.
  - `coordinator/index.js`: `tick` y `scheduleTick` (20 Hz).
  - Cliente: `client/public/js/play/intent.js` (`computeIntent`), `view.js` (`computeView`, `nextAnim`) y `window.lastState` en `play.js`.
- **Conceptos:**
  - Cliente "tonto": solo envía intenciones; el servidor mueve.
  - Un broadcast por tick.
  - `dt` acotado a 0.25 s.
  - Saneo con `Math.sign`.
  - `maxPayload` de 2048 y 60 msgs/s.
  - Choques en el servidor con la misma grilla que dibuja el cliente (`npm run map` + `client/test/map.test.mjs`).
- **Hacer:** la demo de trampas desde DevTools (README T5): intenta mandar una posición o `dir: {x: 50}` y observa que no cambia nada.
- **Preguntas:**
  - ¿Qué ganaría un tramposo si el cliente calculara la posición?
  - ¿Por qué se mueve un eje a la vez?

### Sesión 4: login con Google y la tabla única
- **Leer:**
  - README T5 §3 y §10.
  - `auth-service/google.js` (`makeGoogleVerifier`) y la ruta `/auth/google` en `app.js`.
  - `client/public/js/google-flow.js` (`interpretGoogleResponse`) y `google-login.js`.
- **Conceptos:**
  - `verifyIdToken` con `audience`.
  - `email_verified` obligatorio.
  - La llave es `sub` (nunca el email).
  - Códigos exactos: 200, 409 `username_required` / `username_taken`, 401 `invalid_id_token` / `email_not_verified`, 400.
  - Invariantes `local`/`google` en una sola tabla.
  - `bcrypt.compare` ficticio para igualar tiempos.
  - No registrar el `idToken`.
- **Preguntas:**
  - ¿Por qué no usar el email como identificador?
  - ¿Qué es el Client Secret y por qué no se usa?

---

## Bloque C · Parte III (Taller 6): varios coordinadores

### Sesión 5: el auth como directorio y la reconexión
- **Leer:**
  - README T6.
  - `auth-service/directory.js`: `createDirectory` (TTL 6 s, reservas de 3 s, menor carga) y `validateHeartbeat`.
  - `coordinator/directory-client.js`: `startHeartbeatLoop` y `sendHeartbeatAll`.
  - `client/public/js/play/directory.js`: `parseCoordinatorResponse`, `classifyClose`, `MAX_ATTEMPTS`, `isMixedContent`.
- **Conceptos:**
  - Estado blando con TTL (no se desregistra; caduca).
  - Reservas para repartir la carga en ráfagas.
  - `x-cluster-secret` comparado con sha256 + `timingSafeEqual`.
  - Reintentos con espera `min(1000·n, 3000)`.
  - Contenido mixto (ws:// desde https).
- **Hacer:** mata un coordinador con Ctrl+C. Mira cómo `cluster.html` lo saca a los ~6 s y cómo el jugador se reconecta a otro.

### Sesión 6: mesh de coordinadores
- **Leer:**
  - `coordinator/peers.js` (`createPeerNetwork`).
  - `coordinator/mesh.js`: `resolveLink`, `validatePeerMessage`, `applyPeerMessage`, `resolveJoin`, `buildResync`, `buildPositionsSync`, `dropPeerPlayers`.
- **Conceptos:**
  - Malla completa con una conexión por par (inicia el id menor; 4010 duplicado).
  - `hello` en 3 s (4011).
  - Dueño de cada jugador (`ownerId`): solo el dueño replica.
  - Anti-bucles: nada se retransmite.
  - Conflicto de sesión entre coordinadores: gana el `connectedAtMs` mayor y, si empatan, el id mayor.
  - Resync al reconectar.
  - Jugadores remotos con socket null.
- **Preguntas:**
  - ¿Por qué un desempate determinista?
  - ¿Qué pasa con los jugadores de un coordinador que cae?
  - ¿Por qué `positions_sync` cada 1 s si ya se replican las intenciones? (Deriva por diferencias de `dt`.)

---

## Bloque D · Parte IV (Taller 7): auth replicados (lo más difícil: 3 sesiones)

### Sesión 7: elección estilo Raft simplificado
- **Leer:**
  - README T7 §1–§3.
  - `auth-service/replication/election.js`: `step` (reductor puro: evento → acciones), `startElection`, `onMessage` (votos), `leaderContact`, `onTick` (timeout + jitter, lease), `becomeLeader`, `stepDown`, `adoptTerm`, `STABILITY_MARGIN_MS`.
  - Las pruebas del simulador con reloj falso en `auth-service/test/`.
- **Conceptos:**
  - Término monótono; `votedFor` persistido ANTES de votar.
  - Regla del log al día (`lastTerm`, `lastSeq`).
  - Mayoría `floor(N/2) + 1`.
  - Jitter para evitar empates.
  - Estabilidad: no votar si se oyó al líder hace < 5 s.
  - Elección de arranque a los 500–1500 ms.
  - Lease: el líder sin mayoría se baja.
  - Un nodo que vuelve no recupera el liderazgo.
- **Hacer:** con los 3 auth arriba, mata al líder y mide en `/status` cuánto tarda el nuevo (≤ ~8 s) y que el término subió.
- **Preguntas:**
  - ¿Por qué puede haber como mucho un líder por término?
  - ¿Por qué con 2 de 3 caídos no hay líder?
  - ¿Qué evita que un nodo aislado infle su término y derribe al líder?

### Sesión 8: replicación y consistencia
- **Leer:**
  - README T7 §4.
  - `auth-service/replication/node.js` (`createReplicationNode`: camino de escritura, acks, `write_abort`, sync, conflictos).
  - `replication/mutex.js`.
  - `auth-service/oplog.js`: `applyEntry`, `undoLast`, `wipe`, `entriesAfter`, `bootstrapLegacy`, `usersChecksum`, `transaction`.
  - `replication/standalone.js` (clúster de uno).
- **Conceptos:**
  - Un solo escritor con mutex.
  - Mayoría antes de aplicar en el líder.
  - Timeout → `write_abort` y deshacer.
  - Idempotencia por `entryId`.
  - Conflicto en la cola → deshacer y aplicar; conflicto profundo → borrado y resync completo.
  - Sync por lotes de 500.
  - Puerta de lectura (`READ_TOLERANCE` 10; `not_leader` en vez de 401 si va atrasado).
  - Errores `no_quorum`, `replication_timeout`, `no_leader`.
  - Resultado ambiguo (un reintento da 409).
  - CAP: se elige consistencia (CP) sobre disponibilidad de escrituras.
- **Hacer:**
  - Registra un usuario en una réplica (503 `not_leader` + `leaderUrl`) y luego en el líder (201).
  - Compara `checksum` y `users` en los 3 `/status`.
  - Apaga un auth, registra, enciéndelo y mira cómo se sincroniza.
- **Preguntas:**
  - ¿Por qué el líder no aplica antes de la mayoría?
  - ¿Qué se pierde y qué se gana frente a la replicación asíncrona?
  - ¿Por qué nunca se emite un token con la BD atrasada?

### Sesión 9: failover del cliente, directorio blando y gateway
- **Leer:**
  - README T7 §5, §6 y §9.
  - `client/public/js/auth/failover.js`: `classifyResponse`, `isAllowedLeaderUrl`, `normalizeUrl`, `createAuthClient` (4 s por intento, pasadas, pausa de 1 s, presupuesto de 12 s, `AuthUnavailableError`).
  - `client/public/js/auth-fetch.js` y `auth-node.js` (indicador "Auth: X (líder/réplica)").
  - `gateway/match.js` (`parseRoutes`, `matchRoute`) y `gateway/index.js` (`createGateway`).
- **Conceptos:**
  - Solo se sigue un `leaderUrl` que esté en `AUTH_URLS`. Es seguridad: evita que un nodo malicioso redirija las contraseñas.
  - Heartbeats a TODOS los auth: el directorio responde aun sin líder.
  - Proxy inverso por prefijo con un solo túnel de ngrok.
  - `PUBLIC_URL` igual a su entrada en `AUTH_URLS`.
- **Preguntas:**
  - ¿Por qué el juego sigue cuando caen 2 auth y el login no?
  - ¿Por qué hace falta el gateway con ngrok gratis?

---

## Bloque E · Viruscity (el juego)

### Sesión 10: reglas y máquina de estados de la partida
- **Leer:**
  - CLAUDE.md "VIRUSCITY – METODOLOGÍA" (rama `viruscity`) y la sección Viruscity del README de esa rama.
  - `coordinator/match.js`: `advance`, `startMatch`, `tickPlaying`, `applyAction`, `doInfect`, `doMissionStart`, `doMissionComplete`, `doMissionCancel`, `evaluateVictory`, `syncRoster`, `buildClientView`.
  - `coordinator/missions.js` (`pickMissions`) y `coordinator/city.js` (`buildCity`, `zoneNear`).
- **Reglas que debes poder recitar:**
  - Fases `open_world → countdown (10 s, ≥ 3 jugadores) → playing → ended (15 s)`.
  - Roster y espectadores fantasma.
  - Un infectado inicial; bloqueo de 60 s; enfriamiento de 2 min; víctima bloqueada 3 min; rango de 70 px.
  - `M = min(12, 3·(roster−1))` misiones; jugador inmóvil durante la misión; 8–45 s; cura `+100/M`.
  - Victoria en este orden: cura, sin sanos, sin infectados, tiempo (15 min). Se cancela si el roster queda con < 2.
  - Gracia de reconexión de 60 s.
  - Información oculta: los roles solo se revelan en `game_over`; la alerta pública no lleva nombres.
- **Conceptos:** el reductor puro con reloj y rng inyectados (se prueba sin red) y la vista personalizada por jugador.

### Sesión 11: el árbitro distribuido y el cliente del juego
- **Leer:**
  - `coordinator/arbiter.js`: `computeArbiter` (id menor entre los listos), `shouldAdoptGameState` (handover), `sanitizeGameAction`, `selectEventsToDeliver`, `routeEvents`.
  - Mensajes `game_action` y `game_state` en el mesh.
  - Cliente: `client/public/js/vc/` (`view.js`, `hud.js`, `actions.js`, `mission.js`, `minigames/`).
- **Conceptos:**
  - Un solo árbitro; los demás reenvían las acciones.
  - Replicación del estado cada 250 ms; `rev` y `eid` crecientes.
  - Handover cuando cambia el árbitro (puede perderse una misión en curso).
  - Antitrampa: `MISSION_MIN_MS`, rango + tolerancia, máximo 5 acciones/s.
- **Hacer:** `npm run smoke:viruscity` en la rama `viruscity` y leer qué verifica cada prueba (V1–V12).

---

## Bloque F · Transversal y simulacro

### Sesión 12: seguridad, pruebas y patrones
- **Seguridad:**
  - Secretos solo en `.env` (con su `.example` versionado).
  - Configuración que falla al arrancar si es inválida (`loadConfig` en cada servicio).
  - Nada sensible en los logs.
  - `textContent` en lugar de `innerHTML`; CORS; límites de tamaño y de frecuencia.
  - Validación estricta de cada mensaje del mesh.
- **Pruebas:**
  - `node:test` sobre la lógica pura.
  - Simulador con reloj falso y transporte en memoria (particiones, pérdidas).
  - Smokes multiproceso: `smoke`, `smoke:cluster`, `smoke:auth-cluster`, `smoke:full`, `smoke:viruscity`.
  - Regresión entre talleres.
- **Tabla de patrones** (sabe nombrarlos y señalar dónde están):

| Patrón | Dónde |
|---|---|
| Núcleo puro + capa con efectos | `election.js`, `match.js`, `game.js` y `mesh.js` frente a `index.js`, `node.js` y `peers.js` |
| Reductor / máquina de estados | `election.step`, `match.advance` / `applyAction` |
| Inyección de dependencias (`now`, `rng`, `fetchImpl`, `verifyGoogle`, `transport`) | `createApp`, `createReplicationNode`, `createAuthClient` |
| Líder único (single-writer) + quórum de mayoría | `node.js`, `mutex.js` |
| Log de operaciones replicado | `oplog.js` |
| Heartbeat / lease / TTL (estado blando) | `directory.js`, `election.js` |
| Desempate determinista por id | `resolveLink`, `resolveJoin`, `computeArbiter` |
| Idempotencia | `entryId`, ack repetido |
| Failover con reintentos y presupuesto | `failover.js`, `play/directory.js` |
| Proxy inverso | `gateway/` |
| Servidor autoritativo | `game.js`, `tick` |

### Sesión 13: simulacro de sustentación
- Hacer las guías del README sin apuntes:
  - T5 §14
  - T6 §12
  - T7 §11 (las 5 demos con un jugador conectado todo el tiempo)
  - Viruscity §11 (demo de 5 minutos)
- Responder las preguntas de cada guía.
- Explicar estos escenarios de fallo y lo que se ve en cada uno:
  1. Cae el líder de auth.
  2. Caen 2 auth.
  3. Cae un coordinador.
  4. Cae el árbitro a mitad de partida.
  5. La misma cuenta en dos coordinadores.
- Presentar la arquitectura en 3 minutos con el diagrama hecho a mano.

---

## Hoja de memoria (repasar al inicio de cada sesión)
- **Puertos:**
  - client 3000
  - auth 4001–4003 (mesh 4101–4103; 4000 = auth solo)
  - coordinadores 5001–5003 (mesh 5101–5103)
  - gateway 8080
- **Cierres WS:** 4001 token inválido o vencido · 4002 sesión reemplazada · 4010 peer duplicado · 4011 sin `hello` a tiempo.
- **Errores del auth:**
  - 401 "Credenciales inválidas"
  - 409 nombre ya existe / `username_required` / `username_taken`
  - 503 `not_leader` (+ `leaderUrl`), `no_leader`, `no_quorum`, `replication_timeout`
  - 503 `no_coordinators_available`
  - 401 `invalid_cluster_secret`
- **Tiempos:**
  - Juego: tick de 20 Hz.
  - Coordinadores: heartbeat al auth 2 s · TTL del directorio 6 s · reserva 3 s · ping del mesh 3 s · `positions_sync` 1 s.
  - Auth: heartbeat del líder 2 s · `LEADER_TIMEOUT` 6 s + jitter 0–1,5 s · escritura 3 s · gracia de acks 150 ms · `READ_TOLERANCE` 10 · lotes de sync 500.
  - Failover: 4 s por intento / 12 s en total.
  - Viruscity: cuenta regresiva 10 s · partida 15 min · resultados 15 s · gracia 60 s.
- **Reglas de datos:**
  - username de 3–32 caracteres `[A-Za-z0-9_]`, único sin distinguir mayúsculas.
  - password de 6–72 caracteres; bcrypt con ≥ 10 rounds.
  - `JWT_SECRET` de ≥ 32 caracteres; `userId` siempre string.

## Si hay poco tiempo (versión de 5 días)
| Día | Sesiones |
|---|---|
| 1 | 0, 1, 2 |
| 2 | 3, 5, 6 |
| 3 | 7, 8 |
| 4 | 9, 10, 11 |
| 5 | 12, 13 |

La sesión 4 (Google) se repasa solo con la hoja de memoria.

## Verificación (cómo saber que estás listo)
- Dibujas la arquitectura y los flujos de login → `/coordinator` → WS sin mirar.
- Respondes por escrito ≥ 80 % de las preguntas de las 4 guías del README.
- Haces las demos T7 y Viruscity de corrido, con un jugador conectado, sin consultar apuntes.
- Para cada patrón de la tabla, abres el archivo y señalas la función en < 1 minuto.

## Al aprobar este plan
Lo guardo como `PLAN-ESTUDIO.md` en la raíz del repo, **sin commitearlo** (lo commiteo solo si me lo pides), para tenerlo a mano junto al código.
