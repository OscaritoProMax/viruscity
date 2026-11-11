// App Express del auth-service (sin listen, para poder probarla con una base en memoria).
//
// createApp({ db, jwtSecret, jwtExpiresIn, bcryptRounds, verifyGoogle, directory, clusterSecret }) → app
//   db            DatabaseSync ya preparado con ensureSchema
//   verifyGoogle  async (idToken) => payload (en producción, makeGoogleVerifier; en pruebas, uno falso)
//   directory     directorio de coordinadores (directory.js); si falta, se crea uno con los valores por defecto
//   clusterSecret secreto compartido con los coordinadores; si falta, POST /heartbeat responde siempre 401
//
// Reglas (CLAUDE.md, Taller 5): una sola tabla users; usernames únicos sin distinguir mayúsculas;
// errores siempre como JSON { error }; nunca se registran contraseñas, hashes, tokens, idTokens ni emails.

const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createStatements } = require("./db.js");
const { createDirectory } = require("./directory.js");

// Valores por defecto del directorio si createApp no recibe uno (CLAUDE.md, Taller 6)
const DEFAULT_TTL_MS = 6000;
const DEFAULT_RESERVATION_TTL_MS = 3000;

// sha256 de un texto: así las dos entradas de timingSafeEqual miden lo mismo (32 bytes)
// y la comparación no revela por tiempo ni el contenido ni la longitud del secreto
const sha256 = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest();

// ---------- Validación ----------
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // límite de bcrypt
const LOGIN_FIELD_MAX = 1000; // tope de tamaño en el login, sin aplicar las reglas de formato del registro

const ID_TOKEN_MAX = 4096;

const INVALID_CREDENTIALS = { error: "Credenciales inválidas" };
const USERNAME_TAKEN = { error: "El nombre de usuario ya existe" };
const GOOGLE_HINT = "Primer login con Google: elige un username.";

// Devuelve null si el username es válido, o el mensaje de error en español
function validateUsername(username) {
    if (typeof username !== "string") return "username es obligatorio y debe ser texto";
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_REGEX.test(username)) {
        return `username debe tener entre ${USERNAME_MIN} y ${USERNAME_MAX} caracteres y solo letras, números o guion bajo`;
    }
    return null;
}

// Violación de UNIQUE en node:sqlite (SQLITE_CONSTRAINT_UNIQUE = 2067)
const isUniqueViolation = (err) => err?.errcode === 2067 || /UNIQUE constraint failed/i.test(err?.message ?? "");

function createApp({ db, jwtSecret, jwtExpiresIn = "1h", bcryptRounds = 10, verifyGoogle, directory, clusterSecret }) {
    const users = createStatements(db);

    // Directory service (Taller 6)
    const coordinators = directory ?? createDirectory({ ttlMs: DEFAULT_TTL_MS, reservationTtlMs: DEFAULT_RESERVATION_TTL_MS });
    const clusterSecretHash = clusterSecret ? sha256(clusterSecret) : null;

    // ¿El header x-cluster-secret coincide con CLUSTER_SECRET? (tiempo constante; nunca se registra)
    function clusterSecretMatches(given) {
        if (!clusterSecretHash || typeof given !== "string" || given.length === 0) return false;
        return crypto.timingSafeEqual(sha256(given), clusterSecretHash);
    }

    // jsonwebtoken interpreta un string numérico ("3600") como milisegundos: solo dígitos → segundos
    const expiresIn = /^\d+$/.test(String(jwtExpiresIn)) ? Number(jwtExpiresIn) : jwtExpiresIn;

    // Hash de relleno: si el usuario no existe (o no es local) se compara igual, para no revelar
    // por tiempo de respuesta qué cuentas existen
    const DUMMY_HASH = bcrypt.hashSync("dummy", bcryptRounds);

    // JWT HS256 con { userId (string), username, provider }; iat y exp los agrega jsonwebtoken
    function emitToken(user) {
        return jwt.sign(
            { userId: String(user.id), username: user.username, provider: user.provider },
            jwtSecret,
            { algorithm: "HS256", expiresIn }
        );
    }

    const app = express();

    // Log de cada petición: solo fecha, método, ruta (sin query ni body) y status.
    // Va primero para registrar también los 400/413 de JSON roto o cuerpo grande.
    app.use((req, res, next) => {
        res.on("finish", () => {
            const route = req.originalUrl.split("?")[0];
            console.log(`${new Date().toISOString()} ${req.method} ${route} ${res.statusCode}`);
        });
        next();
    });

    app.use(cors());
    app.use(express.json({ limit: "4kb" }));

    app.get("/health", (req, res) => {
        res.status(200).json({ status: "ok" });
    });

    // ---------- Registro local ----------
    app.post("/register", async (req, res) => {
        const { username: rawUsername, password } = req.body ?? {}; // Express 5 deja body undefined si no hay JSON

        if (typeof rawUsername !== "string" || typeof password !== "string") {
            return res.status(400).json({ error: "username y password son obligatorios y deben ser texto" });
        }

        const username = rawUsername.trim();
        const usernameError = validateUsername(username);
        if (usernameError) return res.status(400).json({ error: usernameError });

        if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
            return res.status(400).json({ error: `password debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres` });
        }

        // Sin distinguir mayúsculas y entre providers: también choca con usernames de cuentas de Google
        if (users.findByUsername(username)) return res.status(409).json(USERNAME_TAKEN);

        const passwordHash = await bcrypt.hash(password, bcryptRounds);

        let info;
        try {
            info = users.insertLocal(username, passwordHash);
        } catch (err) {
            // Condición de carrera: otro registro con el mismo nombre entró entre el SELECT y el INSERT
            if (isUniqueViolation(err)) return res.status(409).json(USERNAME_TAKEN);
            throw err;
        }

        // Nunca se devuelve el hash
        res.status(201).json({ userId: String(info.lastInsertRowid), username });
    });

    // ---------- Login local ----------
    app.post("/login", async (req, res) => {
        const { username, password } = req.body ?? {};

        const validField = (v) => typeof v === "string" && v.length > 0 && v.length <= LOGIN_FIELD_MAX;
        if (!validField(username) || !validField(password)) {
            return res.status(400).json({ error: "username y password son obligatorios" });
        }

        // Usuario inexistente o de Google: mismo 401 y mismo costo que una contraseña incorrecta
        const row = users.findByUsername(username);
        if (!row || row.provider !== "local") {
            await bcrypt.compare(password, DUMMY_HASH);
            return res.status(401).json(INVALID_CREDENTIALS);
        }

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) return res.status(401).json(INVALID_CREDENTIALS);

        res.status(200).json({ token: emitToken(row), username: row.username });
    });

    // ---------- Login con Google (Google Identity Services) ----------
    // Recibe { idToken, username? }. La llave de la cuenta es payload.sub (google_sub), nunca el email.
    // Nunca se devuelven ni se registran el idToken, el email ni el sub.
    app.post("/auth/google", async (req, res) => {
        const { idToken, username: rawUsername } = req.body ?? {};

        // (1) idToken presente
        if (typeof idToken !== "string" || idToken === "" || idToken.length > ID_TOKEN_MAX) {
            return res.status(400).json({ error: "idToken requerido" });
        }

        // (2) Verificación con Google (firma, expiración, emisor y audience)
        let payload;
        try {
            payload = await verifyGoogle(idToken);
        } catch {
            console.error("verificación de ID token fallida"); // texto fijo: el error puede incluir el token
            return res.status(401).json({ error: "invalid_id_token" });
        }
        if (!payload || typeof payload !== "object") return res.status(401).json({ error: "invalid_id_token" });

        // (3) Email verificado y datos mínimos
        if (payload.email_verified !== true) return res.status(401).json({ error: "email_not_verified" });
        const { sub, email } = payload;
        if (typeof sub !== "string" || sub === "" || typeof email !== "string" || email === "") {
            return res.status(401).json({ error: "invalid_id_token" });
        }

        try {
            // (4) Cuenta ya vinculada: entra con su username (se ignora el que venga en el body)
            const existing = users.findByGoogle(sub);
            if (existing) return res.status(200).json({ token: emitToken(existing), username: existing.username });

            // (5) Primer login: hace falta elegir username
            if (rawUsername === undefined || rawUsername === null || rawUsername === "") {
                return res.status(409).json({ error: "username_required", hint: GOOGLE_HINT });
            }

            // (6) Mismas reglas de formato que el registro local
            const username = typeof rawUsername === "string" ? rawUsername.trim() : rawUsername;
            const usernameError = validateUsername(username);
            if (usernameError) return res.status(400).json({ error: usernameError });

            // Sin distinguir mayúsculas y entre providers ("Alice" local bloquea "alice" de Google)
            if (users.findByUsername(username)) return res.status(409).json({ error: "username_taken" });

            // (7) Alta de la cuenta de Google
            let info;
            try {
                info = users.insertGoogle(username, sub, email);
            } catch (err) {
                if (!isUniqueViolation(err)) throw err;
                // Dos primeros logins simultáneos del mismo sub: el otro ya la creó → se entra con esa cuenta
                if (/users\.google_sub/i.test(err.message ?? "")) {
                    const created = users.findByGoogle(sub);
                    if (created) return res.status(200).json({ token: emitToken(created), username: created.username });
                }
                return res.status(409).json({ error: "username_taken" });
            }

            const user = { id: info.lastInsertRowid, username, provider: "google" };
            return res.status(200).json({ token: emitToken(user), username });
        } catch {
            console.error("error interno en /auth/google"); // texto fijo, sin detalles
            return res.status(500).json({ error: "internal" });
        }
    });

    // ---------- Directory service de coordinadores (Taller 6) ----------
    // Latido de un coordinador: solo con el secreto del clúster. No se registra el header ni el body.
    app.post("/heartbeat", (req, res) => {
        if (!clusterSecretMatches(req.get("x-cluster-secret"))) {
            return res.status(401).json({ error: "invalid_cluster_secret" });
        }
        const check = coordinators.validateHeartbeat(req.body);
        if (!check.ok) return res.status(400).json({ error: check.error });
        const result = coordinators.heartbeat(check.value);
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.status(200).json({ ok: true });
    });

    // Las consultas del directorio son públicas y nunca se guardan en caché (cambian cada 2 s)
    const noStore = (req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
    };

    // Coordinador asignado a un cliente: el vivo con menor carga (jugadores + reservas recientes)
    app.get("/coordinator", noStore, (req, res) => {
        const chosen = coordinators.pick();
        if (!chosen) return res.status(503).json({ error: "no_coordinators_available" });
        res.status(200).json({ coordinatorId: chosen.coordinatorId, publicUrl: chosen.publicUrl });
    });

    // Coordinadores vivos para armar el mesh (en orden de registro)
    app.get("/peers", noStore, (req, res) => {
        res.status(200).json({ peers: coordinators.peers() });
    });

    // Vista de depuración del directorio (cluster.html)
    app.get("/directory", noStore, (req, res) => {
        res.status(200).json({ coordinators: coordinators.list(), ttlMs: coordinators.ttlMs });
    });

    // ---------- Errores ----------
    app.use((req, res) => {
        res.status(404).json({ error: "Ruta no encontrada" });
    });

    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
        if (err.type === "entity.too.large") return res.status(413).json({ error: "Cuerpo demasiado grande" });
        // Solo un texto fijo: sin stack, sin body y sin el mensaje (podría traer datos de la petición)
        console.error("Error interno del servidor");
        res.status(500).json({ error: "Error interno del servidor" });
    });

    return app;
}

module.exports = { createApp, validateUsername };
