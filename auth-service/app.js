// App Express del auth-service (sin listen, para poder probarla con una base en memoria).
//
// createApp({ db, jwtSecret, jwtExpiresIn, bcryptRounds, verifyGoogle }) → app
//   db            DatabaseSync ya preparado con ensureSchema
//   verifyGoogle  async (idToken) => payload (en producción, makeGoogleVerifier; en pruebas, uno falso)
//
// Reglas (CLAUDE.md, Taller 5): una sola tabla users; usernames únicos sin distinguir mayúsculas;
// errores siempre como JSON { error }; nunca se registran contraseñas, hashes, tokens, idTokens ni emails.

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createStatements } = require("./db.js");

// ---------- Validación ----------
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // límite de bcrypt
const LOGIN_FIELD_MAX = 1000; // tope de tamaño en el login, sin aplicar las reglas de formato del registro

const INVALID_CREDENTIALS = { error: "Credenciales inválidas" };
const USERNAME_TAKEN = { error: "El nombre de usuario ya existe" };

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

function createApp({ db, jwtSecret, jwtExpiresIn = "1h", bcryptRounds = 10, verifyGoogle }) {
    const users = createStatements(db);

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
