# Taller 4 – Sistemas Distribuidos · Proyecto final Parte I

**Identidad: login con JWT + lobby en vivo por WebSocket.** Universidad de Boyacá.

Tres procesos independientes que se comunican por red:

- **auth-service**: registra usuarios y emite JWT. HTTP en el puerto 4000, con SQLite.
- **coordinator**: recibe a los jugadores por WebSocket, verifica su token y mantiene la lista de conectados en memoria. HTTP + WebSocket en el puerto 5000.
- **client**: páginas HTML + JS plano (login/registro y lobby), servidas con Express en el puerto 3000.

Cada servicio se expone a Internet con su propio túnel **ngrok**. El cliente usa HTTPS para el auth-service y WSS para el coordinator.

---

## 1. Arquitectura

```
 +-----------------------------------------------------------------------------+
 |                                  NAVEGADOR                                  |
 |      login.html / lobby.html                localStorage: token, username   |
 +-----------------------------------------------------------------------------+
       |   ^                  |   ^                         |   ^
   (0) |   | (0')         (1) |   | (2)                 (3) |   | (4)
 HTTPS |   | HTML, JS   HTTPS |   | { token }           WSS |   | players_update
       |   | /config.js       |   | JWT                     |   | broadcast
       v   |                  v   |                         v   |
 +----------------+     +----------------+        +----------------------------+
 |  túnel ngrok   |     |  túnel ngrok   |        |        túnel ngrok         |
 +----------------+     +----------------+        +----------------------------+
         |                      |                               |
         v                      v                               v
 +----------------+     +----------------+        +----------------------------+
 | client  :3000  |     | auth-service   |        | coordinator  :5000         |
 | Express        |     | :4000  Express |        | Express + ws               |
 | sirve public/  |     | bcrypt + JWT   |        | /connect?token=<JWT>       |
 | /config.js     |     | SQLite         |        | Map en memoria:            |
 | (desde .env)   |     | (users.db)     |        | userId -> { username,      |
 |                |     |                |        |   socket, connectedAt }    |
 +----------------+     +----------------+        +----------------------------+
                                |                               |
                                +--------- JWT_SECRET ----------+
                   el auth firma el token y el coordinator lo verifica;
                         los dos servicios no se llaman entre sí
```

### Flujo

0. El navegador abre el cliente (`/` redirige a `/login.html`). La página carga `/config.js`, que el servidor del cliente genera desde su `.env` con `AUTH_URL` y `COORDINATOR_WS_URL`.
1. **Registro**: `POST {AUTH_URL}/register` con `{ username, password }`. El auth-service valida los datos, guarda el hash bcrypt en SQLite y responde `201 { userId, username }`. No inicia sesión automáticamente.
2. **Login**: `POST {AUTH_URL}/login`. Si las credenciales son correctas responde `200 { token, username }`. El token es un JWT HS256 con `{ userId, username, iat, exp }`. El cliente lo guarda en `localStorage` y abre `lobby.html`.
3. **Conexión WS**: el lobby abre `new WebSocket("{COORDINATOR_WS_URL}/connect?token=<JWT>")`. El coordinator verifica el JWT en el evento `upgrade`, **antes** de registrar al jugador:
   - si es válido, lo agrega al `Map` (`userId → { username, socket, connectedAt }`);
   - si no, completa el handshake y cierra con `4001 "invalid token"`.
4. **Broadcast**: cada alta o baja envía a **todos** los jugadores conectados el mensaje `{ "type": "players_update", "players": [{ "userId", "username" }, ...] }`. El lobby redibuja la lista y marca con "(tú)" la propia entrada.

---

## 2. Estructura del repositorio

```
.
├── .gitignore
├── CLAUDE.md                 # reglas y decisiones del proyecto
├── README.md
├── auth-service/
│   ├── .env.example
│   ├── .npmrc                # ignore-scripts=true (usa los binarios precompilados)
│   ├── index.js              # Express + SQLite + bcrypt + JWT
│   ├── package.json
│   └── package-lock.json
├── coordinator/
│   ├── .env.example
│   ├── index.js              # Express + ws: upgrade con JWT, Map, broadcast, heartbeat
│   ├── package.json
│   ├── package-lock.json
│   └── scripts/
│       └── smoke-test.js     # prueba automatizada S1-S11 (npm run smoke)
└── client/
    ├── .env.example
    ├── server.js             # Express estático + /config.js desde .env
    ├── package.json
    ├── package-lock.json
    └── public/
        ├── login.html
        ├── lobby.html
        ├── css/style.css
        └── js/
            ├── login.js
            └── lobby.js
```

Archivos que existen solo en tu equipo y están ignorados por git: `*/.env`, `*/node_modules/` y `auth-service/users.db` (se crea al arrancar el auth-service).

---

## 3. Requisitos

- **Node.js >= 18** (desarrollado y probado con Node 24) y **npm**.
- **git**.
- **ngrok** con cuenta y authtoken configurado (`ngrok config add-authtoken <TU_TOKEN>`).
- Opcional: **wscat** para probar el coordinator desde la terminal (`npm install -g wscat`).

> En Windows, los comandos de este README están escritos para **Git Bash**. En PowerShell, `curl` es un alias de `Invoke-WebRequest`; usa `curl.exe` y ten en cuenta que las comillas del JSON se escriben distinto.

---

## 4. Instalación y ejecución

Cada servicio se instala y se ejecuta en su propia terminal. Arráncalos en este orden: auth-service, coordinator y client.

### Generar el secreto compartido

`JWT_SECRET` debe ser **idéntico** en `auth-service/.env` y en `coordinator/.env`: el auth firma los tokens con él y el coordinator los verifica con él. Genera uno con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Los dos servicios se niegan a arrancar si `JWT_SECRET` falta o tiene menos de 16 caracteres.

### auth-service

```bash
cd auth-service
npm install
cp .env.example .env
# edita .env: pon en JWT_SECRET el valor generado arriba
npm start
```

Salida esperada: `Auth service en puerto 4000`.

> `auth-service/.npmrc` contiene `ignore-scripts=true`. bcrypt y better-sqlite3 traen binarios precompilados. Sin esa opción, npm 11 intenta compilar better-sqlite3 con node-gyp al instalar desde `package-lock.json`, y la instalación falla en Windows si no está instalado Visual Studio. `npm start` y `npm run dev` funcionan igual.

### coordinator

```bash
cd coordinator
npm install
cp .env.example .env
# edita .env: pon en JWT_SECRET EXACTAMENTE el mismo valor que en auth-service/.env
npm start
```

Salida esperada: `Coordinator en puerto 5000 (HTTP y WebSocket en /connect)`.

### client

```bash
cd client
npm install
cp .env.example .env
# en local no hace falta editar nada; con ngrok ver la sección 7
npm start
```

Salida esperada: `Client en puerto 3000`. Abre <http://localhost:3000>.

### Variables de entorno

**auth-service/.env**

| Variable | Qué hace | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP (por defecto 4000) | `4000` |
| `JWT_SECRET` | Clave para firmar los JWT (HS256). Obligatoria, al menos 16 caracteres, igual que en coordinator | `3f9c…` (64 caracteres hex) |
| `JWT_EXPIRES_IN` | Vigencia del token (formato de jsonwebtoken: `1h`, `30s`, `15m`; solo dígitos = segundos). Por defecto `1h` | `1h` |
| `BCRYPT_ROUNDS` | Costo de bcrypt. Entero entre 10 y 31, por defecto 10 | `10` |
| `DB_PATH` | Archivo SQLite, relativo a la carpeta del servicio. Por defecto `./users.db` | `./users.db` |

**coordinator/.env**

| Variable | Qué hace | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP + WebSocket (por defecto 5000) | `5000` |
| `JWT_SECRET` | Misma clave que el auth-service, para verificar los JWT. Obligatoria | `3f9c…` |
| `HEARTBEAT_INTERVAL_MS` | Cada cuántos ms se hace ping a cada socket; quien no responda antes del siguiente ping se desconecta. Por defecto 30000 | `30000` |
| `AUTH_URL` *(opcional, solo para `npm run smoke`)* | URL del auth-service que usa el smoke-test. Por defecto `http://localhost:4000` | `http://localhost:4000` |
| `COORDINATOR_WS_URL` *(opcional, solo para `npm run smoke`)* | URL WS del coordinator que usa el smoke-test. Por defecto `ws://localhost:5000` | `ws://localhost:5000` |

**client/.env** (las tres son obligatorias; el servidor no arranca si falta alguna o si la URL no es válida)

| Variable | Qué hace | Ejemplo local | Ejemplo con ngrok |
|---|---|---|---|
| `PORT` | Puerto del servidor del cliente | `3000` | `3000` |
| `AUTH_URL` | URL del auth-service (`http://` o `https://`); se entrega al navegador en `/config.js` sin barra final | `http://localhost:4000` | `https://<túnel-4000>` |
| `COORDINATOR_WS_URL` | URL del coordinator (`ws://` o `wss://`); se entrega en `/config.js` sin barra final | `ws://localhost:5000` | `wss://<túnel-5000>` |

---

## 5. Probar la API con curl

Con el auth-service corriendo (base de datos vacía). Estas son las respuestas reales obtenidas al ejecutar los comandos:

```bash
# Estado del servicio
curl -s http://localhost:4000/health
# {"status":"ok"}
```

### POST /register

```bash
# 201: usuario creado
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"userId":"1","username":"alice"}  HTTP 201

# 409: el usuario ya existe
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"error":"El nombre de usuario ya existe"}  HTTP 409

# 400: username inválido (menos de 3 caracteres)
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"ab","password":"secret123"}'
# {"error":"username debe tener entre 3 y 30 caracteres y solo letras, números o guion bajo"}  HTTP 400

# 400: password demasiado corta
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"bob","password":"123"}'
# {"error":"password debe tener entre 6 y 72 caracteres"}  HTTP 400

# 400: JSON roto
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{bad'
# {"error":"JSON inválido"}  HTTP 400
```

### POST /login

```bash
# 200: credenciales correctas (el token real es mucho más largo)
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOi…","username":"alice"}  HTTP 200

# 401: contraseña incorrecta
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"incorrecta"}'
# {"error":"Credenciales inválidas"}  HTTP 401

# 401: usuario inexistente (mismo mensaje, a propósito)
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"noexiste","password":"secret123"}'
# {"error":"Credenciales inválidas"}  HTTP 401

# 400: falta la contraseña
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice"}'
# {"error":"username y password son obligatorios"}  HTTP 400
```

Para guardar el token en una variable y ver su payload:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}' | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).token")

echo "$TOKEN" | cut -d. -f2 | node -e "const p=JSON.parse(Buffer.from(require('fs').readFileSync(0,'utf8').trim(),'base64url'));console.log(p, 'exp-iat =', p.exp-p.iat)"
# { userId: '1', username: 'alice', iat: 1793829122, exp: 1793832722 } exp-iat = 3600
```

---

## 6. Probar el coordinator

### Con wscat

Con el auth-service y el coordinator corriendo, y `$TOKEN` obtenido como en la sección anterior:

```bash
# Conexión válida: llega de inmediato la lista con alice
wscat -c "ws://localhost:5000/connect?token=$TOKEN"
# Connected (press CTRL+C to quit)
# < {"type":"players_update","players":[{"userId":"1","username":"alice"}]}

# Token inválido: el handshake se completa y el servidor cierra con 4001
wscat -c "ws://localhost:5000/connect?token=abc"
# Disconnected (code: 4001, reason: "invalid token")
```

**Dos usuarios viendo el broadcast**: registra a un segundo usuario y conéctalo en otra terminal mientras alice sigue conectada.

```bash
curl -s -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"bob","password":"secret456"}'
TOKEN_B=$(curl -s -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"bob","password":"secret456"}' | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).token")
wscat -c "ws://localhost:5000/connect?token=$TOKEN_B"
```

Las dos terminales reciben `players_update` con alice y bob. Si cierras la de bob (Ctrl+C), la de alice recibe la lista solo con alice. Si abres una segunda conexión con el **mismo** token de alice, la primera se cierra con `Disconnected (code: 4002, reason: "replaced by new session")`.

En cualquier momento, `curl -s http://localhost:5000/health` devuelve `{"status":"ok","players":N}`.

### Prueba automatizada

```bash
cd coordinator
npm run smoke
```

Crea 3 usuarios con sufijo aleatorio y comprueba 11 casos: sin token, token `abc`, token firmado con otra secret y token vencido (todos con 4001), lista con A, lista con A y B, salida de B, sesión duplicada con 4002, que la conexión vieja no borre a la nueva, expiración con el socket abierto (`4001 "token expired"`) y una ruta distinta de `/connect`. Imprime ✔/✘ por caso y termina con código 1 si alguno falla. Requiere el auth-service y el coordinator levantados.

---

## 7. Despliegue con ngrok

1. Con los tres servicios corriendo, abre **una terminal por túnel**:

   ```bash
   ngrok http 4000
   ngrok http 5000
   ngrok http 3000
   ```

   Cada una muestra una URL pública `https://….ngrok-free.app` (el dominio exacto depende de tu cuenta).

2. Edita **solo** `client/.env`, sin barra final:

   ```
   AUTH_URL=https://<host-del-túnel-4000>
   COORDINATOR_WS_URL=wss://<host-del-túnel-5000>
   ```

   En auth-service y coordinator no cambia nada: el auth-service acepta peticiones de cualquier origen (CORS abierto) y el coordinator acepta la conexión de cualquier página que traiga un token válido.

3. **Reinicia el client** (Ctrl+C y `npm start`): `/config.js` se genera con los valores de `.env` al arrancar.

4. Abre en el navegador `https://<host-del-túnel-3000>`.

**¿Por qué `wss://` y no `ws://`?** La página del cliente llega por HTTPS a través de ngrok. Los navegadores bloquean el *contenido mixto*: desde una página `https://` no se puede abrir un WebSocket sin cifrar (`ws://`). Hay que usar `wss://`, que ngrok termina con TLS y reenvía al puerto 5000 local.

**Página de aviso de ngrok**: en el plan gratuito, la primera visita desde el navegador a una URL de ngrok muestra una página de aviso; pulsa **"Visit Site"**. Para que esa página no reemplace las respuestas JSON del auth-service, el cliente envía el header `ngrok-skip-browser-warning: true` en sus `fetch` de registro y login (ver [client/public/js/login.js](client/public/js/login.js)). Si el lobby no logra conectar por WSS, abre una vez `https://<host-del-túnel-5000>/health` en el mismo navegador y pulsa "Visit Site".

> **Nota: varias sesiones de ngrok.** Si ngrok indica que tu cuenta gratuita no permite varias sesiones de agente simultáneas, no abras tres procesos: define los tres túneles en el archivo de configuración de ngrok y levántalos juntos con `ngrok start --all`. El formato del archivo cambia entre versiones, así que consúltalo en la documentación oficial de tu versión: revísala con `ngrok version` (este proyecto se probó con ngrok 3.39.11) y `ngrok config --help`.

---

## 8. Decisiones de diseño

**JWT verificado en el `upgrade` y cierre 4001 tras el handshake.**
El coordinator usa `WebSocketServer({ noServer: true })` y valida el token en `server.on("upgrade")`, así que un jugador con token inválido nunca llega al `Map` ni recibe la lista. Si el token falla no se responde un 401 HTTP: el navegador no expone el status de un upgrade rechazado (solo ve un cierre 1006 genérico). En cambio, completar el handshake y cerrar con `4001 "invalid token"` le da al cliente un código legible para mostrar el mensaje correcto.

**Sesión duplicada: se cierra la anterior con 4002.**
Si la misma cuenta abre otra conexión, se queda la nueva y la anterior recibe `4002 "replaced by new session"`. Lo más probable es que el usuario quiera usar la pestaña o el dispositivo que acaba de abrir, y así nunca hay dos entradas del mismo `userId` en la lista. La pestaña vieja muestra "Tu sesión se abrió en otra pestaña".

**Condición de carrera en el `close`.**
Cuando se reemplaza una sesión, el `close` de la conexión vieja llega *después* de registrar la nueva. Por eso el manejador solo borra al jugador si `players.get(userId)?.socket === ws`. Si no es el socket vigente no hace nada, y el cierre viejo no borra la conexión nueva (lo verifica S9 del smoke-test).

**bcrypt con rounds configurables y mínimo 10.**
`BCRYPT_ROUNDS` permite subir el costo a medida que el hardware mejora, sin tocar el código. El mínimo de 10 evita configuraciones débiles por error, y el servicio no arranca con un valor menor. El máximo de 31 es el límite de bcrypt.

**`JWT_EXPIRES_IN` configurable.**
Por defecto el token dura `1h`. Para demostrar la expiración basta con poner `30s` en `.env` y reiniciar, sin tocar código. Si el valor trae solo dígitos se convierte a número, porque jsonwebtoken interpreta un string numérico como milisegundos.

**Mensaje genérico en 401 y hash ficticio.**
El login responde siempre `401 "Credenciales inválidas"`, exista o no el usuario, para no revelar qué cuentas existen. Si el usuario no existe, igual se ejecuta `bcrypt.compare` contra un `DUMMY_HASH` calculado al arrancar, para que la respuesta tarde lo mismo y no se pueda distinguir por tiempo.

**SQLite propia del auth-service.**
Cada servicio es dueño de sus datos: solo el auth-service conoce usuarios y contraseñas. El coordinator no necesita la base, porque toda la identidad viaja firmada en el JWT. SQLite (better-sqlite3) no requiere un servidor aparte y las consultas son preparadas, nunca SQL concatenado.

**Estado del coordinator en memoria y su limitación.**
El `Map` de jugadores es rápido y simple, pero se pierde si el coordinator se reinicia (los clientes reciben el cierre y vuelven al login). Además, no escala a varios coordinadores: cada uno vería solo a sus propios jugadores. Compartir o replicar ese estado entre coordinadores es justamente el objetivo de las siguientes partes del proyecto.

**Heartbeat.**
Cada `HEARTBEAT_INTERVAL_MS` (30 s por defecto) el servidor hace `ping` a cada socket. Si no llega el `pong` antes del siguiente ciclo, lo termina. Así se detectan conexiones muertas que nunca enviaron el cierre (red caída, laptop suspendida), y el jugador desaparece de la lista de los demás.

**Cierre por expiración del token.**
Verificar el token solo al conectar no basta: un socket podría seguir abierto horas después de vencer el token. Al conectar se programa un `setTimeout` hasta `exp` que cierra con `4001 "token expired"`; el lobby vuelve al login. El timer se limpia en el `close`.

**Cliente sin frameworks y `/config.js` desde `.env`.**
HTML + JS plano basta para dos pantallas y evita dependencias y pasos de build. Las URLs de los servicios no están escritas en el código: `client/server.js` genera `/config.js` desde `.env` (sin barra final y con `Cache-Control: no-store`), así que pasar de localhost a ngrok es editar `.env` y reiniciar.

**`textContent` contra XSS.**
Los nombres de usuario y los mensajes del servidor se insertan siempre con `textContent` y `createElement`, nunca como HTML. Aunque alguien lograra un nombre con `<script>`, el navegador lo mostraría como texto. Además, el registro solo admite `^[A-Za-z0-9_]+$`.

### Decisiones tomadas durante el desarrollo

- **Origen del código**: los archivos del código base estaban copiados en la raíz (commit `3182f36 inicial`). Eran idénticos al repo de GitHub; se movieron a una copia local de solo lectura y se quitaron del repo en el commit de estructura.
- **auth-service, qué se tomó del base**: el base no tiene autenticación y no se copió ningún archivo. Solo se reutilizaron el patrón `app.listen(PORT, (err) => …)` de Express 5 y el formato `res.status(4xx).json({ error })`. Para la configuración se usa dotenv en lugar de `--env-file-if-exists` (que exige Node >= 22.9).
- **auth-service, configuración y logs**:
  - dotenv se carga con `{ quiet: true }` para que no imprima su propio mensaje.
  - `DB_PATH` se resuelve relativo a la carpeta del servicio.
  - `PORT` se valida entre 1 y 65535.
  - El middleware de log va antes de `express.json()`, para que también se registren los 400/413 de JSON roto o cuerpo grande.
- **auth-service, `/login`**: no aplica trim ni reglas de formato al username (solo exige texto no vacío de hasta 1000 caracteres). Por eso el cliente envía el username ya recortado.
- **auth-service, contraseñas**: la longitud de 6–72 se mide en caracteres. bcrypt trunca a 72 bytes, así que con caracteres multibyte (tildes, emojis) los bytes que pasen de 72 no cuentan.
- **auth-service, cierre y bcrypt**: el cierre ordenado fuerza la salida a los 5 s. bcrypt 6.0.0 trae binarios precompilados, así que npm puede avisar que no ejecutó su script de instalación, pero el módulo funciona sin compilar.
- **auth-service, instalación limpia**: la auditoría final detectó que `npm install` desde el lockfile lanzaba un `node-gyp rebuild` de better-sqlite3 y fallaba sin Visual Studio. Se agregó `auth-service/.npmrc` con `ignore-scripts=true`, porque los dos módulos nativos traen binarios precompilados.
- **coordinator, qué se tomó del base**: el `coordinator/index.js` del base no cumplía (sin token, sin upgrade, sin close, manejaba workers) y se reescribió. Se reutilizaron `send()` con el chequeo `readyState === OPEN`, la idea de `broadcast()`, la estructura por secciones y HTTP + WS en el mismo puerto. Se eliminaron roles, workers, pulsos de aplicación, `/status`, el dashboard estático y `cors()`.
- **coordinator, mensajes**: son planos, `{ type: "players_update", players: [...] }`, como pide el enunciado, en vez del sobre `{ type, data }` del base. `broadcastPlayers()` recorre el `Map` y no `wss.clients`, para no enviar la lista a sockets rechazados que aún se están cerrando.
- **coordinator, contenido del token**: además de `userId` y `username` como texto, el payload debe traer `exp` numérico; si no, se rechaza con 4001.
- **coordinator, validaciones y logs**:
  - `HEARTBEAT_INTERVAL_MS` se valida como entero positivo.
  - El log HTTP no incluye la query, porque la de `/connect` lleva el token. Los rechazos registran solo el mensaje de jsonwebtoken (`jwt expired`, `invalid signature`…).
  - Durante el upgrade el socket tiene un manejador de `error`, para que un reset del cliente no tumbe el proceso.
  - 404 y 500 responden JSON `{ error }`.
  - El apagado ordenado (SIGINT/SIGTERM) cierra los sockets con 1001 y fuerza la salida a los 5 s.
- **coordinator, smoke-test**: en S10 usa al usuario B con un token de 3 s, porque B ya está desconectado y así no reemplaza la sesión de A ni de C.
- **client, qué se tomó del base**: `dashboard/style.css` se copió y se adaptó:
  - se conservan la paleta, el modo oscuro, las tarjetas, las pills, los botones y los inputs;
  - se quitaron el grid de servidores, las consolas y los logs;
  - se agregaron formularios, mensajes verde/rojo, el banner y la lista.

  De `dashboard/common.js` solo se tomó el atajo `$`. `setStatus()` del lobby adapta `setWsStatus()` del dashboard del base.
- **client, configuración**: `PORT` también es obligatorio (sin puertos escritos en `server.js`). `AUTH_URL` debe ser http(s) y `COORDINATOR_WS_URL` debe ser ws(s). Responde 404 como JSON y tiene cierre ordenado.
- **client, respuestas raras**: si la respuesta del auth-service no es JSON (por ejemplo, una página de ngrok), se muestra "Error inesperado del servidor (status)".
- **Pruebas en Windows**: los procesos de prueba se levantan con `Start-Process -PassThru` y se detienen por PID, porque el PID leído de `netstat` en Git Bash puede traer un `\r` y hacer fallar `taskkill` sin aviso.

---

## 9. Seguridad

- **Contraseñas nunca en logs ni en respuestas**:
  - Los logs HTTP de los servicios registran solo fecha, método, ruta sin query y status, nunca bodies, hashes ni tokens.
  - El registro responde solo `{ userId, username }`.
  - Los errores 500 registran solo `err.message`, sin stack ni body.
  - En las pruebas, `grep` sobre los logs dio 0 apariciones de la contraseña y 0 de tokens (`eyJ`).
- **Contraseñas con bcrypt**: se guardan como hash bcrypt (`$2b$10$…`), nunca en texto plano.
- **`.env` fuera de git**: `.gitignore` excluye `.env`, `*.db` y `node_modules/`. Solo se versiona `.env.example`, sin secretos reales.
- **Validación de entrada**:
  - Tipos y longitudes de `username` (3–30, `^[A-Za-z0-9_]+$`) y `password` (6–72).
  - Consultas SQL preparadas.
  - JWT verificado con `algorithms: ["HS256"]` y payload completo (`userId`, `username`, `exp`).
  - Las URLs del cliente se validan al arrancar.
- **Límites de tamaño**:
  - Body JSON del auth-service: `express.json({ limit: "10kb" })`; si se supera responde 413.
  - Mensajes WebSocket: `maxPayload: 1024` bytes. El coordinator además ignora cualquier mensaje entrante.
- **Mismo error para todo fallo de login**: el login responde siempre el mismo 401 y aplica un hash ficticio para igualar tiempos (ver decisiones).
- **CORS abierto en el auth-service**: es aceptable porque la sesión no usa cookies. El token se envía explícitamente y lo guarda la propia página.

---

## 10. Guía para la sustentación

Antes de empezar, deja los tres servicios corriendo (en local o con ngrok) y dos navegadores distintos abiertos en el cliente (por ejemplo Chrome y Firefox, o uno en modo incógnito).

**(a) Flujo con dos navegadores, 1 min.**
1. En el navegador 1, registra un usuario: debe salir en verde "Registro exitoso. Ahora inicia sesión.". Inicia sesión y entrarás al lobby con "Conectado" y tu nombre con "(tú)".
2. En el navegador 2, haz lo mismo con otro usuario. Los dos lobbies muestran 2 jugadores al instante.
3. Pulsa "Cerrar sesión" en uno: el otro baja a 1 en vivo.

**(b) Token inválido, 1 min.**
En el lobby, abre DevTools → Application → Local Storage, cambia unos caracteres del final de `token` y recarga. El coordinator cierra con 4001 y la página vuelve al login con el banner "Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.".

**(c) Token vencido, 2 min.**
1. Pon `JWT_EXPIRES_IN=30s` en `auth-service/.env` y reinicia el auth-service (Ctrl+C, `npm start`). El coordinator no necesita reinicio, porque lee `exp` del propio token.
2. Inicia sesión. Antes de que pasen los 30 s, copia el valor de `token` desde DevTools → Local Storage.
3. Espera: a los 30 s como máximo, el coordinator cierra con `4001 "token expired"` y el lobby vuelve al login con el mensaje de sesión expirada.
4. Reconecta con el token vencido para ver el rechazo. Puedes hacerlo de dos formas:
   - con `wscat -c "ws://localhost:5000/connect?token=<token copiado>"` (o `wss://<host-del-túnel-5000>/connect?token=…`), que muestra `Disconnected (code: 4001, reason: "invalid token")`;
   - pegando el token de nuevo en Local Storage y abriendo `lobby.html`, que vuelve al login con el mensaje.
5. Al terminar, restaura `JWT_EXPIRES_IN=1h` y reinicia el auth-service.

**(d) Recorrido del código, 3 min.**

| Punto | Archivo | Qué mostrar |
|---|---|---|
| Verificación del JWT antes de aceptar | [coordinator/index.js](coordinator/index.js#L78) | `verifyToken()` (`jwt.verify` con `algorithms: ["HS256"]` y payload completo) y `server.on("upgrade")` ([línea 98](coordinator/index.js#L98)): 404 si la ruta no es `/connect`, `handleUpgrade` + `close(4001, "invalid token")` si el token falla |
| Alta del jugador y sesión duplicada | [coordinator/index.js](coordinator/index.js#L143) | `wss.on("connection")`: `players.set(...)` y `previous.socket.close(4002, ...)` |
| Broadcast | [coordinator/index.js](coordinator/index.js#L135) | `broadcastPlayers()`: arma `players_update` y lo envía a todos los sockets abiertos del `Map` |
| Manejo del close | [coordinator/index.js](coordinator/index.js#L168) | `ws.on("close")`: limpia el timer de expiración, borra solo si `players.get(userId)?.socket === ws` y vuelve a hacer broadcast |
| Expiración y heartbeat | [coordinator/index.js](coordinator/index.js#L166) | el `setTimeout` con `4001 "token expired"` y el `setInterval` de ping/pong ([línea 190](coordinator/index.js#L190)) |
| Emisión del token (si preguntan) | [auth-service/index.js](auth-service/index.js#L131) | `POST /login`: `DUMMY_HASH`, `bcrypt.compare`, `jwt.sign` |
| Reacción del cliente | [client/public/js/lobby.js](client/public/js/lobby.js#L81) | `ws.onclose`: mensaje según 4001/4002/otro, `sessionStorage` y vuelta al login |

**(e) Preguntas, 3 min.** Respuestas cortas a preguntas probables:

1. **¿Por qué el token va en la query string y no en un header?**
   La API `WebSocket` del navegador no permite enviar headers personalizados en el handshake; la query es la vía estándar. Por eso los logs nunca registran la query y el tráfico va cifrado con WSS.
2. **¿Qué pasa si roban un token?**
   Sirve hasta su `exp`, y por eso la vigencia es corta y configurable. Si vence con el socket abierto, el coordinator cierra la conexión. Para revocarlo antes habría que agregar una lista de tokens revocados, que queda fuera del alcance.
3. **¿Por qué el coordinator no consulta al auth-service para validar el token?**
   El JWT va firmado con HS256 y una clave compartida: verificar la firma basta para confiar en `userId` y `username`. Así el coordinator no depende de que el auth-service esté disponible y no hace una llamada de red por cada conexión.
4. **¿Qué pasa si se reinicia el coordinator?**
   El `Map` vive en memoria y se pierde. Los clientes reciben el cierre y vuelven al login; al volver a entrar, la lista se reconstruye. Mantener ese estado entre varios coordinadores es el tema de las siguientes partes.
5. **¿Cómo evitan que la conexión vieja borre a la nueva en una sesión duplicada?**
   Primero se registra el socket nuevo y luego se cierra el viejo con 4002. En el `close` solo se elimina al jugador si el socket que se cierra sigue siendo el vigente en el `Map`.

---

## Créditos

Basado en el código de referencia **SSD-CommsWS** (<https://github.com/Draklif/SSD-CommsWS>).

- **Reutilizado**:
  - La estructura de `coordinator/index.js` (HTTP + WebSocket en el mismo puerto, secciones comentadas).
  - La función `send()` con chequeo de `readyState` y la idea de `broadcast()`.
  - El patrón `app.listen(PORT, (err) => …)` de Express 5.
  - Los estilos de `dashboard/style.css` (paleta, modo oscuro, tarjetas, botones).
  - El atajo `$` de `dashboard/common.js`.
  - El indicador de estado del WebSocket del dashboard.
- **Cambiado o agregado**:
  - Autenticación completa (auth-service con SQLite, bcrypt y JWT).
  - Verificación del token en el `upgrade` con códigos 4001/4002.
  - `Map` de jugadores en lugar de workers, manejo de `close`, heartbeat con ping/pong y cierre por expiración.
  - Mensajes `players_update`.
  - Cliente de login/lobby con `textContent`.
  - Configuración con dotenv y `.env` por servicio, con un `package.json` por servicio.
  - Se eliminaron roles, workers, pulsos de aplicación, dashboards de depuración y CORS abierto en el coordinator.
