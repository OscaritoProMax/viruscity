# Viruscity · Sistemas Distribuidos · Proyecto final (Partes I y II)

Universidad de Boyacá. Tres procesos independientes que se comunican por red:

- **auth-service** (puerto 4000): registro e inicio de sesión con usuario/contraseña **y con Google**. Una sola tabla `users` en SQLite (`node:sqlite`) y JWT HS256.
- **coordinator** (puerto 5000): **servidor autoritativo** del juego en vivo. Recibe a los jugadores por WebSocket, aplica sus *intenciones* en un game loop a 20 Hz y envía el estado a todos.
- **client** (puerto 3000): páginas HTML + JS plano servidas con Express. `login.html` (con botón de Google) y `play.html` (el juego en canvas).

**Parte I (Taller 4)** fue la identidad: login con JWT y lobby en vivo. **Parte II (Taller 5)** agrega el juego en vivo con el servidor como autoridad y el login con Google. Este README describe el estado actual (Taller 5); al final hay un resumen de lo que viene del Taller 4.

**Contenido**
- [Parte II · Taller 5](#parte-ii--taller-5): 1. Arquitectura · 2. Base de datos · 3. Google · 4. API del auth · 5. Coordinador · 6. Extra: color · 7. Cliente · 8. Variables · 9. Correr todo · 10. Google Cloud · 11. ngrok · 12. Decisiones · 13. Errores típicos · 14. Sustentación
- [Estructura del repositorio](#estructura-del-repositorio)
- [Interfaz de Viruscity](#interfaz-de-viruscity)
- [Parte I · Taller 4 (resumen)](#parte-i--taller-4-resumen)
- [Créditos](#créditos)

---

# Parte II · Taller 5

## 1. Arquitectura

```
                         ┌──────────────────────────────────────────────┐
                         │      Google Identity Services (GIS)          │
                         │  accounts.google.com/gsi/client (navegador)  │
                         └──────────────┬───────────────────────────────┘
                                        │ (B1) ID token (JWT de Google)
                                        ▼
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ NAVEGADOR  login.html ── play.html          localStorage: token, username     │
 │            window.lastState = último "state" del servidor                     │
 └──────┬──────────────────────┬─────────────────────────────┬─────────▲─────────┘
        │ (0) HTML, JS,        │ (A) /register, /login       │ (C) WSS │ (D) welcome,
        │     /config.js       │ (B2) /auth/google           │ intent, │     state (20 Hz),
        │                      │      ◄── { token, username }│ extras  │     players_update
        ▼                      ▼                             ▼         │
 ┌────────────────┐   ┌──────────────────────┐   ┌───────────────────────────────┐
 │ túnel ngrok    │   │ túnel ngrok          │   │ túnel ngrok                   │
 └───────┬────────┘   └──────────┬───────────┘   └──────────────┬────────────────┘
         ▼                       ▼                              ▼
 ┌────────────────┐   ┌──────────────────────┐   ┌───────────────────────────────┐
 │ client  :3000  │   │ auth-service  :4000  │   │ coordinator  :5000            │
 │ Express        │   │ Express · bcryptjs   │   │ Express + ws                  │
 │ public/        │   │ google-auth-library  │   │ /connect?token=<JWT>          │
 │ /config.js     │   │ node:sqlite          │   │ Map userId → { username,      │
 │ (desde .env)   │   │ users.db (1 tabla)   │   │   provider, socket, x, y,     │
 └────────────────┘   └──────────┬───────────┘   │   intent, extras }            │
                                 │               │ game loop: tick() a 20 Hz     │
                                 │               └──────────────┬────────────────┘
                                 └──────── JWT_SECRET ──────────┘
                     (el auth firma el JWT y el coordinator lo verifica; no se llaman entre sí)
```

### Flujos

**A. Registro e inicio de sesión local**
1. `POST /register { username, password }` → valida, guarda el hash de bcryptjs con `provider = 'local'` → `201 { userId, username }`.
2. `POST /login { username, password }` → `200 { token, username }`. El token es un JWT HS256 con `{ userId, username, provider: "local" }` más `iat` y `exp`.
3. El cliente guarda `token` y `username` en `localStorage` y abre `play.html`.

**B. Inicio de sesión con Google (Opción A, Google Identity Services)**
1. El botón de Google (dibujado por GIS en `login.html`) entrega al navegador un **ID token** (`credential`).
2. El cliente envía `POST /auth/google { idToken }`. El auth-service verifica el token con Google (firma, emisor, vencimiento y *audience*), exige `email_verified` y busca la cuenta por `sub`.
3. **Si la cuenta ya existe**: `200 { token, username }`.
4. **Si es el primer ingreso**: `409 { error: "username_required", hint }`. El cliente muestra el panel "Elige tu username" y reintenta con `{ idToken, username }` → `200` (o `409 username_taken` si el nombre está ocupado).
5. El JWT es el mismo formato que el local, con `provider: "google"`. El cliente lo guarda y abre `play.html`.

**C. Conexión WebSocket**
1. `play.html` abre `new WebSocket("{COORDINATOR_WS_URL}/connect?token=<JWT>")`.
2. El coordinator verifica el JWT **en el `upgrade`** (HS256, `userId`, `username`, `provider` ∈ {local, google} y `exp`). Si falla, completa el handshake y cierra con `4001 "invalid token"`.
3. Si es válido: aparece en una posición al azar, recibe `welcome` y todos reciben `players_update`.

**D. Game loop (servidor autoritativo)**
1. El cliente envía solo **intenciones** (`{ type: "intent", intent: { dir: { x, y } } }`) y **extras** (`extras_update`). El handler de mensajes solo las **guarda**.
2. Cada tick (20 Hz) el servidor calcula `dt` real, mueve a todos con su intención normalizada, los mantiene dentro del mundo y envía **un** mensaje `state` con todos los jugadores.
3. El cliente guarda ese mensaje en `window.lastState` y lo dibuja (con un suavizado solo visual).

---

## 2. Base de datos

Una sola tabla, con el esquema exacto de [auth-service/db.js](auth-service/db.js#L14):

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('local','google')),
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

Además hay un índice aparte, `users_username_nocase` (`UNIQUE` sobre `username COLLATE NOCASE`), para que "Oscar" y "oscar" sean el mismo nombre. No cambia el esquema de la tabla.

**Invariantes por provider** (se hacen cumplir en `createStatements()` de `db.js` y en `app.js`):

| provider | password_hash | google_sub | email |
|---|---|---|---|
| `local` | obligatorio (hash bcryptjs) | NULL | NULL |
| `google` | NULL | obligatorio (el `sub` de Google) | obligatorio |

**¿Por qué una sola tabla?**
- **Un username no se repite entre providers:** la restricción `UNIQUE` (y el índice sin mayúsculas) vale para todos. Si `alice` es local, nadie puede elegir `alice` con Google, y al revés.
- **Una sola identidad aguas abajo:** coordinador, puntajes o replicación futuros trabajan con un único `userId`. Con dos tablas habría que unir o duplicar esa lógica.

**Migración automática desde el Taller 4.** Al arrancar, `ensureSchema()` revisa `PRAGMA table_info('users')`:
- **Si no hay tabla:** la crea.
- **Si es la tabla del Taller 4 (sin `provider`):**
  1. copia el archivo a `users.db.bak` (o `users.db.<fecha>.bak` si ya existe uno);
  2. dentro de una transacción crea `users_new`, copia los usuarios con `provider = 'local'` conservando sus `id`, borra la tabla vieja y renombra la nueva;
  3. si algo falla, hace `ROLLBACK`;
  4. registra solo el conteo: `[db] migración aplicada: N usuarios conservados como provider=local`.
- **Si ya tiene `provider`:** no hace nada. Es idempotente.

Los `.bak` están en `.gitignore`.

---

## 3. Autenticación con Google

**Opción A: Google Identity Services, con el ID token en el navegador.**
- **No hay Client Secret ni redirect URI.** No hay secreto que guardar ni rutas de callback que proteger: menos superficie de ataque.
- **El navegador recibe el ID token directamente** (un JWT firmado por Google) y lo envía al auth-service, que lo verifica.
- **El `GOOGLE_CLIENT_ID` es público:** viaja en `/config.js` hacia el navegador.

**Validaciones y dónde se hacen**

| Validación | Dónde |
|---|---|
| Forma de JWT (3 segmentos base64url) antes de llamar a Google; así un token basura se rechaza sin ir a la red | [auth-service/google.js](auth-service/google.js#L14) `makeGoogleVerifier()` |
| Firma, emisor y vencimiento con los certificados de Google; `audience` = nuestro `GOOGLE_CLIENT_ID` | `client.verifyIdToken({ idToken, audience: clientId })` en `google.js` |
| **Defensa en profundidad:** además se compara `payload.aud === clientId` | `google.js` (línea 23) |
| `email_verified === true` | [auth-service/app.js](auth-service/app.js#L139) `POST /auth/google` |
| La llave de la cuenta es `sub` (`google_sub`), **nunca el email** (el email puede cambiar o reasignarse) | `findByGoogle(sub)` en `app.js` / `db.js` |
| Nunca se registran el idToken, el email, el sub ni `err.message` de la verificación (la librería puede incluir el token en sus mensajes) | `app.js`: solo el texto fijo `"verificación de ID token fallida"` |

**Respuestas de `POST /auth/google`**

| Código | Cuerpo | Cuándo |
|---|---|---|
| 200 | `{ "token": "eyJ…", "username": "bob_google" }` | Cuenta ya vinculada, o primer ingreso con un username válido y libre |
| 409 | `{ "error": "username_required", "hint": "Primer login con Google: elige un username." }` | Primer ingreso sin `username` |
| 409 | `{ "error": "username_taken" }` | El username elegido ya existe (en cualquier provider y con cualquier combinación de mayúsculas) |
| 401 | `{ "error": "invalid_id_token" }` | Token con formato inválido, firma, emisor o audience incorrectos, o vencido |
| 401 | `{ "error": "email_not_verified" }` | El correo de la cuenta de Google no está verificado |
| 400 | `{ "error": "idToken requerido" }` | Falta `idToken`, no es texto o está vacío |
| 400 | `{ "error": "username debe tener entre 3 y 32 caracteres y solo letras, números o guion bajo" }` | Username con formato inválido |
| 500 | `{ "error": "internal" }` | Error inesperado (se registra un texto fijo, sin detalles) |

---

## 4. API del auth-service

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `GET /health` | — | `200 { "status": "ok" }` |
| `POST /register` | `{ username, password }` | `201 { userId, username }` · `409 { error: "El nombre de usuario ya existe" }` · `400 { error }` |
| `POST /login` | `{ username, password }` | `200 { token, username }` · `401 { error: "Credenciales inválidas" }` (contraseña incorrecta, usuario inexistente **o usuario de Google**: el mismo cuerpo) · `400 { error: "username y password son obligatorios" }` |
| `POST /auth/google` | `{ idToken, username? }` | Ver la tabla de la sección 3 |

Otras respuestas comunes: `400 { error: "JSON inválido" }` · `413 { error: "Cuerpo demasiado grande" }` (más de 4 kB) · `404 { error: "Ruta no encontrada" }`.

**Ejemplos con curl** (Git Bash; con el auth-service en `localhost:4000`):

```bash
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"userId":"1","username":"alice"}  HTTP 201

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"ALICE","password":"secret123"}'
# {"error":"El nombre de usuario ya existe"}  HTTP 409

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"ab","password":"secret123"}'
# {"error":"username debe tener entre 3 y 32 caracteres y solo letras, números o guion bajo"}  HTTP 400

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…","username":"alice"}  HTTP 200

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"incorrecta"}'
# {"error":"Credenciales inválidas"}  HTTP 401
```

**`/auth/google` con curl.** El ID token lo emite Google en el navegador, así que no se puede fabricar. Para obtener uno real:
1. Inicia sesión con el botón de Google en `login.html` con DevTools abierto.
2. En la pestaña **Network**, abre la petición `auth/google` y copia `idToken` desde **Payload**. Vale alrededor de una hora y solo para tu `GOOGLE_CLIENT_ID`.

Con un token ficticio la respuesta es siempre 401:

```bash
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/auth/google -H "Content-Type: application/json" -d '{"idToken":"abc"}'
# {"error":"invalid_id_token"}  HTTP 401

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/auth/google -H "Content-Type: application/json" -d '{}'
# {"error":"idToken requerido"}  HTTP 400
```

---

## 5. Coordinador autoritativo

**El cliente nunca mueve al jugador.** Solo dice hacia dónde quiere ir; el servidor decide dónde está.

**Game loop** ([coordinator/index.js](coordinator/index.js#L274) `tick()` y lógica pura en [coordinator/game.js](coordinator/game.js#L94)):
1. **`dt` real:** se mide con `Date.now()` entre ticks y se acota a 0,25 s (`clampDt`). Así la velocidad no depende del tick rate, y una pausa del proceso no provoca un salto enorme.
2. **Movimiento normalizado:** `stepPlayers` divide la intención por `Math.hypot(x, y)`, así que la diagonal avanza lo mismo que un eje (200 px/s, no 283).
3. **Límites del mundo:** cada jugador queda dentro de `[radio, ancho − radio]` × `[radio, alto − radio]`.
4. **Un broadcast por tick:** `snapshot(players)` se serializa **una vez** y se envía a todos. Los handlers de mensajes nunca hacen broadcast.
5. **20 Hz de verdad:** el loop se programa con una hora objetivo (`scheduleTick`), no con `setInterval`. En Windows `setInterval(50)` dispara cada ~60 ms (≈16,5 Hz).

**Protocolo**

Del servidor al cliente:
```json
{ "type": "welcome", "you": { "userId": "4", "username": "alice", "provider": "local" },
  "world": { "width": 1200, "height": 800, "playerRadius": 16, "tickRate": 20 } }

{ "type": "state", "t": 1794174650735,
  "players": [ { "userId": "4", "username": "alice", "provider": "local", "x": 108.01, "y": 589.1, "extras": { "color": "#ff5500" } },
               { "userId": "7", "username": "bob_google", "provider": "google", "x": 1096.12, "y": 576.09, "extras": {} } ] }

{ "type": "players_update", "players": [ { "userId": "4", "username": "alice" }, { "userId": "7", "username": "bob_google" } ] }
```

Del cliente al servidor:
```json
{ "type": "intent", "intent": { "dir": { "x": 1, "y": -1 } } }
{ "type": "extras_update", "extras": { "color": "#ff5500" } }
```

**Validaciones y límites** ([game.js](coordinator/game.js#L60) e [index.js](coordinator/index.js#L221) `ws.on("message")`):
- **`intent`:** `x` e `y` deben ser `number` finitos; se reducen a −1/0/1 con `Math.sign` (`{9999, -5}` → `{1, -1}`). Strings, NaN, Infinity, arrays o falta de `dir` → se ignora.
- **`extras_update`:** objeto no nulo y no array, de **máximo 1024 bytes** serializado (`MAX_EXTRAS_BYTES`). Si trae `color`, debe cumplir `^#[0-9a-fA-F]{6}$` (si no, se ignora todo el mensaje) y se guarda en minúsculas. Se guarda una **copia** y **reemplaza** los extras anteriores.
- **`maxPayload` de 2048 bytes:** un mensaje mayor cierra el socket.
- **Máximo 60 mensajes por segundo y por socket** (`MAX_MSGS_PER_SEC`): el exceso se descarta en silencio.
- **Lo inválido** (JSON roto, tipos desconocidos) se ignora sin responder ni caer. Nada de lo recibido se registra en logs.
- **Socket vigente:** solo cuentan los mensajes del socket vigente del usuario.

**Otros puntos**
- **`provider` lo pone el servidor**, desde el JWT verificado; no es un extra que el cliente pueda falsificar.
- **Sesión duplicada** (Taller 4): si la misma cuenta abre otra conexión, la anterior se cierra con `4002 "replaced by new session"`. El `close` de la vieja no borra a la nueva.
- **Heartbeat:** `ping` cada `HEARTBEAT_INTERVAL_MS`; quien no responde antes del siguiente ciclo se termina.
- **Expiración:** al conectar se programa el cierre `4001 "token expired"` para el `exp` del token.
- **`GET /health`:** responde `{ "status": "ok", "players": N, "tickRate": 20 }`.

---

## 6. Feature extra: color del jugador e insignia del provider

**Color.** En `play.html` el jugador elige su color con un selector o con seis colores predefinidos.
1. El cliente envía `{ type: "extras_update", extras: { color } }`.
2. El coordinator lo valida (`sanitizeExtras`) y lo guarda en `p.extras` (en `ws.on("message")` de [index.js](coordinator/index.js#L221)).
3. Desde ese tick, el color viaja en **cada `state`** dentro de `extras`, para todos los jugadores.

- **Es replicado:** el estado vive en el servidor y todos lo reciben en el mismo mensaje.
- **Es persistente durante la sesión:** sigue en `p.extras` hasta que el jugador se desconecta. Además el cliente lo guarda en `localStorage` (`playColor`) y lo reenvía al recibir `welcome`, así que se conserva al recargar.

**Insignia del provider.** Cada jugador del `state` trae `provider`, que pone el servidor desde el JWT. El cliente dibuja a la derecha del nombre una **"G"** azul sobre blanco para Google o una **"L"** sobre gris para cuentas locales. Como sale del servidor, nadie puede hacerse pasar por usuario de Google enviando extras.

---

## 7. Cliente

- **`login.html`:** pestañas de iniciar sesión y crear cuenta, más el botón de Google ([js/google-login.js](client/public/js/google-login.js)).
  - Si `GOOGLE_CLIENT_ID` está vacío, el botón no aparece.
  - Si el script de Google no carga en 5 s, se muestra "No se pudo cargar el inicio de sesión con Google".
  - Sin One Tap.
  - Las respuestas de `/auth/google` se interpretan con la función pura `interpretGoogleResponse` de [js/google-flow.js](client/public/js/google-flow.js).
  - Tras el login, local o de Google, se va a **`play.html`**.
- **`play.html`** ([js/play/play.js](client/public/js/play/play.js#L57)):
  - **Estado:** `window.lastState` guarda **el último mensaje `state` completo** del servidor. Es la única fuente de verdad: el cliente no calcula posiciones.
  - **Entrada:** WASD o flechas llenan un `Set` de teclas. `computeIntent` lo convierte en una dirección y se envía **solo cuando cambia**. Al perder el foco o esconder la pestaña se envía `{0, 0}`.
  - **Dibujo:** [js/play/render.js](client/public/js/play/render.js#L42) dibuja con un **suavizado solo visual**: `renderPos` se acerca a la posición del servidor con `1 − e^(−20·dt)` y salta si la diferencia supera 200. Si alguien edita `lastState` en DevTools, la vista lo refleja y el siguiente `state` lo corrige.
  - **Lista de jugadores:** un punto con el color de cada uno, "(tú)" para el local y su insignia.
  - **Aviso:** "Conexión inestable…" si pasan más de 3 s sin `state`.
- **Cierres:**
  - `4001` → "Tu sesión expiró o el token no es válido…";
  - `4002` → "Tu sesión se abrió en otra pestaña…";
  - cualquier otro → "Se perdió la conexión con el coordinador…".

  El mensaje se guarda en `sessionStorage` y se vuelve al login, sin reconexión automática.
- **Vigilancia del token:** si el token guardado cambia o se borra con la sesión abierta, la sesión se cae. Al cerrar, solo se borra el token si sigue siendo el de esa pestaña, y nunca con 4002, porque ese token ya es de la sesión nueva.
- **"Cerrar sesión":** borra `token` y `username`, cierra con `1000 "logout"` y vuelve al login.
- **`lobby.html`:** es **legado del Taller 4**. Sigue funcionando, pero ya nada enlaza a él.

---

## 8. Variables de entorno

Cada servicio tiene su `.env` (ignorado por git) y su `.env.example` (versionado, sin secretos reales).

**auth-service/.env**

| Variable | Función | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP (por defecto 4000) | `4000` |
| `JWT_SECRET` | Clave HS256 para firmar los JWT. Obligatoria, ≥ 32 caracteres, **idéntica** a la del coordinator | 64 caracteres hex |
| `JWT_EXPIRES_IN` | Vigencia del token (`1h`, `30s`…; solo dígitos = segundos). Por defecto `1h` | `1h` |
| `BCRYPT_ROUNDS` | Costo de bcryptjs, entre 10 y 31 (por defecto 10) | `10` |
| `DB_PATH` | Archivo SQLite, relativo a la carpeta del servicio (por defecto `./users.db`) | `./users.db` |
| `GOOGLE_CLIENT_ID` | Client ID de Google (obligatorio; debe terminar en `.apps.googleusercontent.com`; si contiene `localtest` se avisa que es de prueba) | `1234…-abc.apps.googleusercontent.com` |

**coordinator/.env**

| Variable | Función | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP + WebSocket (por defecto 5000) | `5000` |
| `JWT_SECRET` | La misma clave del auth-service (≥ 32 caracteres) | igual que en auth |
| `HEARTBEAT_INTERVAL_MS` | Cada cuánto se hace ping a los sockets | `30000` |
| `WORLD_WIDTH` / `WORLD_HEIGHT` | Tamaño del mundo en unidades | `1200` / `800` |
| `PLAYER_RADIUS` | Radio de los jugadores (2·radio < lado menor del mundo) | `16` |
| `PLAYER_SPEED` | Velocidad en unidades por segundo | `200` |
| `TICK_RATE` | Ticks por segundo del game loop (1–120) | `20` |
| `MAX_EXTRAS_BYTES` | Tamaño máximo de `extras` serializado | `1024` |
| `MAX_MSGS_PER_SEC` | Mensajes por segundo y por socket antes de descartar | `60` |
| `AUTH_URL` / `COORDINATOR_WS_URL` | *(opcionales, solo para `npm run smoke`)* | `http://localhost:4000` / `ws://localhost:5000` |

**client/.env**

| Variable | Función | Local | Con ngrok |
|---|---|---|---|
| `PORT` | Puerto del client (obligatorio) | `3000` | `3000` |
| `AUTH_URL` | URL del auth-service, sin barra final | `http://localhost:4000` | `https://<túnel-4000>` |
| `COORDINATOR_WS_URL` | URL del coordinator, sin barra final | `ws://localhost:5000` | `wss://<túnel-5000>` |
| `GOOGLE_CLIENT_ID` | El mismo Client ID del auth-service (opcional: vacío = sin botón de Google) | `1234…-abc.apps.googleusercontent.com` | igual |

---

## 9. Cómo correr todo en local

**Requisitos:**
- **Node.js ≥ 22.13** (por `node:sqlite` sin flag; se probó con Node 24) y npm.
- git.
- Opcional: ngrok con cuenta.

Los comandos están escritos para Git Bash.

1. **Instala las dependencias** de cada servicio:
   ```bash
   cd auth-service && npm install && cd ..
   cd coordinator && npm install && cd ..
   cd client && npm install && cd ..
   ```
2. **Crea los `.env`** a partir de los ejemplos:
   ```bash
   cp auth-service/.env.example auth-service/.env
   cp coordinator/.env.example coordinator/.env
   cp client/.env.example client/.env
   ```
3. **Genera un secreto** y pon **el mismo valor** en `JWT_SECRET` de `auth-service/.env` y de `coordinator/.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Pon el Client ID de Google** (sección 10) en `GOOGLE_CLIENT_ID` de `auth-service/.env` y de `client/.env`. Para probar sin Google, en el auth basta un valor con el formato correcto, como `000000000000-localtest.apps.googleusercontent.com`.
5. **Arranca cada servicio** en su propia terminal, en este orden:
   ```bash
   cd auth-service && npm start    # Auth service en puerto 4000
   cd coordinator && npm start     # Coordinator en puerto 5000 (…) · game loop a 20 Hz
   cd client && npm start          # Client en puerto 3000
   ```
6. **Abre** <http://localhost:3000> en dos navegadores distintos (o uno en incógnito), entra con dos usuarios y muévete con WASD o las flechas.

**Pruebas**

| Comando | Qué prueba |
|---|---|
| `cd auth-service && npm test` | 20 pruebas: registro, login, Google con verificador falso, migración del Taller 4 y que los logs no filtren datos |
| `cd coordinator && npm test` | 9 pruebas de la lógica pura del juego |
| `cd client && npm test` | 40 pruebas: flujo de Google, intención, colores, ajuste del canvas y la interfaz de Viruscity |
| `cd coordinator && npm run smoke` | Con auth y coordinator levantados: S1–S11 (Taller 4) y G1–G12 (juego en vivo) |

---

## 10. Google Cloud

1. **Crea un proyecto** en <https://console.cloud.google.com>.
2. **Configura la pantalla de consentimiento de OAuth** (en la consola nueva: *Google Auth Platform*):
   - tipo de usuario **External**;
   - nombre de la app y correo de soporte;
   - scopes **`openid`**, **`email`** y **`profile`**;
   - en **Usuarios de prueba** (*Audience → Test users*) agrega las cuentas de Gmail que usarás mientras la app esté en modo prueba.
3. **Crea el cliente OAuth:** *Credenciales → Crear credenciales → ID de cliente de OAuth*, de tipo **Aplicación web**.
   - **Orígenes de JavaScript autorizados:** `http://localhost`, `http://localhost:3000` y la URL **https** del túnel ngrok del client (por ejemplo `https://<túnel-3000>`).
   - **URI de redireccionamiento autorizados:** ninguno. La Opción A no los usa.
4. **Copia el Client ID** (termina en `.apps.googleusercontent.com`) y ponlo, **con el mismo valor**, en `GOOGLE_CLIENT_ID` de `auth-service/.env` y de `client/.env`. Reinicia los dos servicios. El Client Secret no se usa ni se guarda.
5. **Cuando cambie la URL de ngrok** del client: agrega el nuevo origen https en el cliente OAuth y espera unos minutos a que Google aplique el cambio. Si el botón falla con un error de origen, revisa este paso.
6. **Para agregar más personas** mientras la app está en modo prueba: añade su correo en *Usuarios de prueba*. Las demás cuentas verán un aviso de acceso bloqueado.

---

## 11. ngrok

Con los tres servicios corriendo, abre un túnel por servicio, cada uno en su terminal:

```bash
ngrok http 4000
ngrok http 5000
ngrok http 3000
```

Luego edita **solo `client/.env`**, sin barra final:

```
AUTH_URL=https://<host-del-túnel-4000>
COORDINATOR_WS_URL=wss://<host-del-túnel-5000>
```

y **reinicia el client**: `/config.js` se genera al arrancar. Abre `https://<host-del-túnel-3000>` y agrega ese origen en Google Cloud (sección 10).

- **`wss://` y no `ws://`:** la página llega por HTTPS y los navegadores bloquean un WebSocket sin cifrar desde una página segura (*contenido mixto*).
- **Página de aviso de ngrok:** en el plan gratuito, la primera visita muestra un aviso; pulsa **"Visit Site"**. Los `fetch` del cliente envían `ngrok-skip-browser-warning: true` para que el aviso no reemplace las respuestas JSON.
- **Varias sesiones de ngrok:** si la cuenta gratuita no permite varias sesiones de agente, define los tres túneles en el archivo de configuración y usa `ngrok start --all` (consulta `ngrok config --help` en tu versión).
- **En auth y coordinator no hay que cambiar nada:** el auth acepta cualquier origen (CORS abierto, sin cookies) y el coordinator, cualquier conexión con un token válido.

---

## 12. Decisiones de diseño

- **Tabla única:** un solo `userId` por persona y usernames únicos entre providers (sección 2).
- **Opción A de Google:** sin secreto ni redirect URI. El servidor solo verifica un JWT firmado por Google contra los certificados públicos (sección 3).
- **401 genérico en `/login` para usuarios de Google:** se responde exactamente igual que con una contraseña incorrecta, y además se ejecuta un `bcrypt.compare` contra un hash ficticio para igualar tiempos. Así no se puede averiguar qué usernames existen ni de qué provider son (sin enumeración de usuarios).
- **Validación de `extras`, regla por regla:**
  - objeto, no null ni array;
  - ≤ 1024 bytes serializado;
  - `color` con formato `#rrggbb` (si no, se ignora todo el mensaje) y guardado en minúsculas;
  - se guarda una copia y reemplaza al anterior.
- **Límites anti-abuso:**
  - `maxPayload` de 2048 bytes;
  - 60 mensajes/s por socket;
  - `intent` reducido a −1/0/1;
  - body del auth de 4 kB;
  - idToken de hasta 4096 caracteres.
- **`state` sin `socket` ni `intent`:** `snapshot()` publica solo `userId`, `username`, `provider`, `x`, `y` (redondeadas a 2 decimales) y `extras`. La intención de los demás no se revela y el objeto interno nunca sale del servidor.
- **bcryptjs y `node:sqlite`:** sin dependencias nativas, así que la instalación no compila nada y no hace falta Visual Studio en Windows. El costo es que hace falta Node ≥ 22.13 (o 22.5 con `--experimental-sqlite`).
- **Username de 3–32 caracteres (`^[a-zA-Z0-9_]+$`):** se guarda y se muestra con las mayúsculas con que se registró. La **unicidad y el login no distinguen mayúsculas** ("Oscar" = "oscar"), un cambio pedido durante el desarrollo para evitar cuentas casi idénticas.
- **JWT con `provider`:** el coordinator sabe el origen de la cuenta sin consultar la base, y lo publica en el `state`.
- **No se registran tokens, idTokens, emails ni contraseñas:**
  - los logs HTTP solo tienen fecha, método, ruta sin query y status;
  - los errores de Google y los 500 registran textos fijos;
  - las pruebas automáticas lo verifican (L1 del auth).

---

## 13. Errores típicos y dónde se evitan

> Lista reconstruida a partir de las decisiones fijas del Taller 5 (CLAUDE.md); compárala con la del enunciado.

| # | Error típico | Dónde se evita |
|---|---|---|
| 1 | El cliente calcula o envía su posición | [client/public/js/play/play.js](client/public/js/play/play.js#L159) `pushIntent()` solo envía la dirección; el coordinator ignora cualquier otro tipo de mensaje |
| 2 | Mover jugadores o hacer broadcast en el handler de mensajes | [coordinator/index.js](coordinator/index.js#L221) `ws.on("message")` solo guarda `p.intent` / `p.extras`; mover y difundir es cosa de `tick()` |
| 3 | Velocidad que depende del tick rate (sin `dt`) | `tick()` usa `clampDt(now − lastTick)` y [game.js](coordinator/game.js#L94) `stepPlayers(players, dt, cfg)` |
| 4 | La diagonal es más rápida | `stepPlayers()`: dirección dividida por `Math.hypot(x, y)` |
| 5 | Confiar en el intent (NaN, Infinity, 9999, strings) | [game.js](coordinator/game.js#L60) `sanitizeIntent()`: `Number.isFinite` + `Math.sign` |
| 6 | Extras sin límites (tamaño, tipo, color arbitrario, flood) | [game.js](coordinator/game.js#L70) `sanitizeExtras()`, `maxPayload: 2048` y `MAX_MSGS_PER_SEC` en `index.js` |
| 7 | El jugador sale del mundo | `stepPlayers()`: límites `[R, W − R]` y `[R, H − R]` |
| 8 | Usar el email como llave de la cuenta de Google | [auth-service/app.js](auth-service/app.js#L139) `/auth/google`: `findByGoogle(sub)`; `google_sub` es `UNIQUE` |
| 9 | No verificar `audience` ni `email_verified` | [auth-service/google.js](auth-service/google.js#L14) (`verifyIdToken` con `audience` + comparación de `aud`) y `app.js` (`email_verified !== true` → 401) |
| 10 | Dos tablas o username duplicado entre providers | [auth-service/db.js](auth-service/db.js#L14) tabla única + índice `users_username_nocase`; `findByUsername` en `/register` y `/auth/google` |
| 11 | Registrar tokens, idTokens, emails o `err.message` de Google | `app.js`: log de peticiones sin body ni query y textos fijos en los errores; prueba L1 en `auth-service/test/auth.test.js` |

---

## 14. Guía de sustentación

Antes de empezar: los tres servicios corriendo (local o con ngrok), `GOOGLE_CLIENT_ID` real configurado y dos navegadores distintos (o uno en incógnito) en el client.

**(a) Juego con dos pestañas y el extra de color · 3 min**
1. Entra con un usuario en cada navegador: los dos aparecen en el mapa y en "Jugadores en línea (2)".
2. Muévete con WASD en uno: el otro ve el movimiento en vivo. Muévete en diagonal y explica que va a la misma velocidad.
3. Cambia el color en uno (selector o muestras): el otro lo ve al instante. Recarga: el color se mantiene.

**(b) Los dos providers · 3 min**
1. Registra `alice` con contraseña y entra.
2. En el otro navegador entra con Google: en el primer ingreso aparece "Elige tu username"; escribe `bob_google`. Los dos se ven, y la insignia muestra **L** para alice y **G** para bob_google.
3. Muestra que alice no puede usar Google para su cuenta: si en el primer ingreso con Google se elige `alice` (o `ALICE`), la respuesta es `409 username_taken`.
4. Muestra que bob_google no puede usar `/login`: da el mismo 401 que una contraseña incorrecta.
   ```bash
   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"bob_google","password":"cualquiera"}'
   # {"error":"Credenciales inválidas"}  HTTP 401
   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"incorrecta"}'
   # {"error":"Credenciales inválidas"}  HTTP 401
   ```

**(c) El servidor es la autoridad · 2 min**
En la consola de DevTools de una pestaña ejecuta:

```js
const yo = lastState.players.find(p => p.username === localStorage.getItem('username'));
setInterval(() => { const j = lastState.players.find(p => p.username === localStorage.getItem('username')); if (j) { j.x = 100; j.y = 100; } }, 5);
```

Esa pestaña te dibuja en (100, 100), porque edita su copia local de `lastState`. **En la otra pestaña no pasa nada**: el servidor sigue con tu posición real. Al recargar (o al detener el intervalo), el siguiente `state` del servidor corrige la vista.

**(d) Tour del código · 4 min**

| Punto | Archivo y función |
|---|---|
| Game loop | [coordinator/index.js](coordinator/index.js#L274) `tick()` (y `scheduleTick()`); movimiento en [game.js](coordinator/game.js#L94) `stepPlayers()` |
| Validación de inputs | [coordinator/game.js](coordinator/game.js#L60) `sanitizeIntent()` y `sanitizeExtras()` |
| Verificación del ID token | [auth-service/google.js](auth-service/google.js#L14) `makeGoogleVerifier()` y [auth-service/app.js](auth-service/app.js#L139) `POST /auth/google` |
| Dónde se guardan los extras | [coordinator/index.js](coordinator/index.js#L221) `ws.on("message")` → `p.extras`; salen en `snapshot()` dentro de cada `state` |

**(e) Preguntas probables**
1. **¿Por qué el cliente no mueve al jugador?**
   Porque el servidor es la autoridad: si el cliente decidiera su posición, podría hacer trampa (teletransportarse, ir más rápido). El cliente solo manda intenciones y dibuja lo que dice el servidor.
2. **¿Por qué usar `dt`?**
   Los ticks no duran exactamente 50 ms. Multiplicar por el tiempo real hace que la velocidad sea siempre 200 px/s, sin importar el tick rate ni los retrasos.
3. **¿Por qué normalizar la dirección?**
   Sin normalizar, `(1, 1)` mide √2 ≈ 1,41 y la diagonal sería un 41 % más rápida. Con `Math.hypot` todas las direcciones avanzan igual.
4. **¿Por qué `sub` y no el email?**
   `sub` es el identificador estable y único de la cuenta de Google. El email puede cambiar o reasignarse, y usarlo como llave permitiría apropiarse de cuentas.
5. **¿Qué pasa si no se verifica el `audience`?**
   Se aceptaría un ID token emitido para *otra* aplicación: cualquiera con un token de otro sitio que use Google podría entrar como esa persona.
6. **¿Por qué una sola tabla?**
   Para que un username sea único entre providers y cada persona tenga un solo `userId` para el coordinador, los puntajes o la replicación.
7. **¿Por qué el broadcast va en el tick y no en cada mensaje?**
   Así se envía un mensaje por tick con el estado completo y consistente. Si se difundiera por mensaje, el tráfico dependería de cuántas teclas pulsa cada uno y el estado llegaría a medias.
8. **¿Qué pasa si alguien manda extras de 10 MB?**
   El servidor ni siquiera lo lee: un mensaje de más de 2048 bytes (`maxPayload`) cierra ese socket. Uno de menos de 2048 pero con extras de más de 1024 bytes se ignora, y más de 60 mensajes por segundo se descartan.

---

# Estructura del repositorio

```
.
├── .gitignore · CLAUDE.md · README.md
├── auth-service/
│   ├── .env.example · .npmrc · package.json · package-lock.json
│   ├── index.js        # arranque: valida la configuración, abre la base, cierre ordenado
│   ├── app.js          # createApp(): /health, /register, /login, /auth/google
│   ├── db.js           # esquema de la tabla única, migración desde el Taller 4, consultas
│   ├── google.js       # makeGoogleVerifier(): verifica el ID token con audience
│   └── test/           # node:test (auth, Google, migración)
├── coordinator/
│   ├── .env.example · package.json · package-lock.json
│   ├── index.js        # upgrade con JWT, sesiones, mensajes, game loop, heartbeat
│   ├── game.js         # lógica pura: config, spawn, sanitizeIntent/Extras, stepPlayers, snapshot
│   ├── test/           # node:test de game.js
│   └── scripts/smoke-test.js   # S1-S11 y G1-G12 (npm run smoke)
└── client/
    ├── .env.example · package.json · package-lock.json
    ├── server.js       # Express estático + /config.js (AUTH_URL, COORDINATOR_WS_URL, GOOGLE_CLIENT_ID)
    ├── public/
    │   ├── login.html · play.html · lobby.html (legado) · game.html (vista previa de diseño)
    │   ├── css/        # tokens, base, components, login, google-login, play, lobby, game
    │   ├── img/        # logo.svg, favicon.svg
    │   └── js/
    │       ├── login.js · login-ui.js · google-login.js · google-flow.js
    │       ├── lobby.js · game-shell.js
    │       ├── play/   # play.js, render.js, intent.js, colors.js, fit.js
    │       └── ui/     # módulos de la interfaz de Viruscity
    └── test/           # node:test (Google, juego, interfaz)
```

Solo existen en tu equipo (ignorados por git): `*/.env`, `*/node_modules/`, `auth-service/users.db` y sus copias `*.bak`.

---

# Interfaz de Viruscity

La capa visual del cliente: login, sala de espera y una pantalla de juego de diseño (`game.html`). Es HTML, CSS y JS plano con módulos ES, sin CDN, fuentes web ni imágenes remotas. La única dependencia externa es el script de Google en `login.html` (Taller 5).

### Dirección de arte y tokens

**Ciudad de noche con neón biológico.** Los títulos van en fuente monoespaciada, en mayúsculas y con espaciado amplio; el cuerpo, en la fuente del sistema. Los bordes son de 1 px, las esquinas redondeadas y las sombras suaves. El brillo cian se reserva para el foco y los elementos principales.

`client/public/css/tokens.css` es la **única fuente** de colores, espacios, radios, sombras, tipografía y tiempos de animación. Los demás CSS usan `var(--…)`, y el canvas lee los mismos tokens con `getComputedStyle`.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#0b1020` | Fondo de la página y del mapa |
| `--bg-elev` | `#101733` | Superficies elevadas (barra superior, pestañas) |
| `--panel` | `#121a33` | Tarjetas y paneles |
| `--panel-2` | `#18223f` | Campos, filas de jugador, edificios |
| `--border` | `#2a3560` | Bordes de 1 px |
| `--text` | `#e6e9f5` | Texto principal y anillo del jugador local |
| `--muted` | `#8f9bc4` | Etiquetas, ayudas y texto secundario |
| `--accent` | `#4dd2ff` | **Cian**: acciones, foco, estado sano, mensajes correctos |
| `--accent-ink` | `#06121c` | Texto sobre colores llenos (botones, chips) |
| `--infected` | `#7cff6b` | **Verde**: infectado (solo el estado propio) |
| `--danger` | `#ff4d6d` | **Rojo**: errores y peligro |
| `--cure` | `#ffd166` | **Dorado**: cura, progreso y tareas hechas |

El resto de tokens:
- **Espacios:** de `--space-1` (4 px) a `--space-7` (48 px).
- **Radios:** `--radius-s`, `--radius-m` y `--radius-l`.
- **Sombras:** `--shadow-1` y `--shadow-glow`.
- **Tipografía:** `--font-ui`, `--font-mono` y los tamaños de `--fs-s` a `--fs-hero`.
- **Movimiento:** `--ease`, `--t-fast` y `--t-med`.

### Contrato de datos de la interfaz

Los módulos de `js/ui/` **no conocen el WebSocket**: solo reciben datos planos por parámetros.

```js
scene = {
  world: { width, height },
  playerRadius: number,
  me: { userId } | null,
  status: "healthy" | "infected" | null,   // SOLO el estado del jugador local
  players: [{ userId, username, x, y, color?, badge? }],
}
```

| Módulo | Funciones |
|---|---|
| `scene-renderer.js` | `createSceneRenderer(canvas)` → `{ resize(), draw(scene, nowMs) }` · `computeCamera(me, viewW, viewH, world)` |
| `hud.js` | `createHud(root)` → `setMe`, `setCure`, `setPlayerCount`, `setTasks`, `setHint`, `setInfectCooldown`, `setConnection`, `showRoleIntro`, `toast` |
| `end-overlay.js` | `showEndOverlay(root, { winner, reason, players, youWon }, { onBack })` → `{ close() }` |
| `lobby-view.js` | `createLobbyView(root)` → `setUser`, `setStatus`, `setPlayers`, `showNotice` |
| `toast.js` / `modal.js` | `createToaster(contenedor).show(texto, { kind })` · `createModal().open({ title, content, onClose, dismissible })` |

### Vista previa (solo diseño)

Mientras `UI.PREVIEW_ENABLED` sea `true` en `js/ui/ui-config.js`, estas URLs muestran datos de ejemplo sin red ni token:

| URL | Qué muestra |
|---|---|
| `/lobby.html?preview=1` | Jugadores que entran uno a uno, barra hacia 4, una salida y un reingreso |
| `/game.html?preview=1` | Ciudad con 6 edificios, 6 jugadores, HUD completo y panel de controles (tecla **H**) |
| `/game.html?preview=infected` | El jugador local infectado |
| `/game.html?preview=end` | La pantalla de fin de partida |

### Accesibilidad

- **Contraste AA** de los tokens, comprobado con `client/test/contrast.test.mjs`.
- **Foco visible** en todo elemento interactivo.
- **Formularios:** cada campo tiene su `<label>`.
- **Botones:** los de solo icono llevan `aria-label` y todos miden al menos 44 px.
- **Avisos:** `aria-live` en los avisos.
- **Diálogos:** usan `role="dialog"` y devuelven el foco al cerrar.
- **`prefers-reduced-motion`:** respetado en partículas, virus animado y entradas.
- **Texto dinámico:** siempre con `textContent` o `fillText`.
- **Pantallas pequeñas:** funciona desde 360 px.
- **Limitación conocida:** algunas iniciales de avatar en tonos azules y violetas tienen poco contraste (el avatar es decorativo).

### Virus animado del login

El hero del login muestra el logo como un virus "blando" que rebota, basado en `virus_city_loading_screen.html`:
- **Movimiento:** se aplasta y se estira, sus antenas oscilan y suelta esporas.
- **Salto:** con clic, toque, Enter o Espacio da un salto potente.
- **Movimiento reducido:** queda quieto.

### Integración pendiente

- **`game.html` sigue siendo una vista previa de diseño.** La partida del Taller 5 vive en `play.html`. Para usar el diseño de Viruscity en el juego real, el bloque "INTEGRACIÓN REAL" de [client/public/js/game-shell.js](client/public/js/game-shell.js#L21) tendría que alimentar `renderer.draw(scene)` y el HUD con los datos de `window.lastState`.
- **Antes de la entrega:** poner `UI.PREVIEW_ENABLED = false` en [ui-config.js](client/public/js/ui/ui-config.js#L6).

---

# Parte I · Taller 4 (resumen)

La Parte I construyó la identidad y la base del coordinator. Sigue vigente:

- **JWT verificado en el `upgrade` y cierre 4001 tras el handshake:** el navegador no puede leer el status HTTP de un upgrade rechazado (solo ve un 1006), pero sí el código de cierre `4001 "invalid token"`.
- **Sesión duplicada con 4002:** se queda la conexión nueva. El `close` de la vieja solo borra al jugador si `players.get(userId)?.socket === ws`, para no borrar a la nueva.
- **bcrypt con rounds configurables (mínimo 10) y `JWT_EXPIRES_IN` configurable** (`30s` para demostrar la expiración).
- **401 genérico y hash ficticio en el login.**
- **Heartbeat y cierre por expiración** del token con el socket abierto.
- **Estado del coordinator en memoria:** se pierde al reiniciar y no escala a varios coordinadores, que es el objetivo de las siguientes partes.
- **`/config.js` desde `.env`:** ninguna URL escrita en el cliente.
- **`textContent` contra XSS.**

**Lo que cambió en el Taller 5**
- El auth-service pasó de better-sqlite3 + bcrypt a `node:sqlite` + bcryptjs, con una tabla única y `provider` en el JWT.
- Los usernames pasaron de 3–30 a 3–32 caracteres.
- El body del auth bajó de 10 kB a 4 kB.
- El `maxPayload` del coordinator subió de 1024 a 2048 bytes.
- Tras el login se va a `play.html` y no a `lobby.html`.
- Los tokens emitidos antes del Taller 5 (sin `provider`) se rechazan con 4001.

### Decisiones tomadas durante el desarrollo

- **Origen del código:** los archivos del código base estaban copiados en la raíz (commit `3182f36 inicial`); se movieron a una copia local de solo lectura.
- **Configuración común:** dotenv con `{ quiet: true }`; `DB_PATH` relativo a la carpeta del servicio; `PORT` validado; el log de peticiones va antes de `express.json()` para registrar también los 400/413 de JSON roto.
- **`/login` no recorta el username:** solo exige texto no vacío de hasta 1000 caracteres; el cliente lo envía recortado.
- **Contraseñas:** la longitud de 6–72 se mide en caracteres; bcrypt trunca a 72 bytes.
- **`auth-service/.npmrc` (`ignore-scripts=true`):** nació para evitar la compilación de better-sqlite3 en una instalación limpia. Desde el Taller 5 no hay dependencias nativas y ya no es necesario, pero no estorba.
- **Coordinator:**
  - los mensajes son planos (`{ type, … }`);
  - el log HTTP no incluye la query (lleva el token);
  - el socket del upgrade tiene manejador de `error`;
  - el apagado cierra con 1001 y fuerza la salida a los 5 s.
- **Usernames sin distinguir mayúsculas:** "Oscar", "osCar" y "OSCAR" son la misma cuenta. Lo garantiza un índice `COLLATE NOCASE`, y el login devuelve el nombre tal como se registró.
- **Token corrupto con la sesión abierta:** el lobby y `play.html` revisan el token guardado cada segundo y con el evento `storage`. Si cambia o desaparece, la sesión se cae.
- **Pruebas en Windows:** los procesos se levantan y se detienen por PID. `netstat` en Git Bash puede devolver PIDs con `\r`.

---

## Créditos

Basado en el código de referencia **SSD-CommsWS** (<https://github.com/Draklif/SSD-CommsWS>).

- **Reutilizado:**
  - la estructura de `coordinator/index.js` (HTTP + WebSocket en el mismo puerto);
  - `send()` con chequeo de `readyState` y la idea de `broadcast()`;
  - el patrón `app.listen(PORT, (err) => …)` de Express 5;
  - los estilos de `dashboard/style.css` en la primera versión del cliente (luego reemplazados por la interfaz de Viruscity);
  - el atajo `$` y el indicador de estado del WebSocket del dashboard.
- **Cambiado o agregado:**
  - autenticación completa (local y Google) con tabla única;
  - verificación del token en el `upgrade` con códigos 4001/4002;
  - `Map` de jugadores con game loop autoritativo, intención y extras;
  - heartbeat y cierre por expiración;
  - cliente de juego en canvas con `textContent`/`fillText`;
  - configuración con dotenv y un `package.json` por servicio;
  - se eliminaron roles, workers, pulsos de aplicación, dashboards de depuración y CORS abierto en el coordinator.
