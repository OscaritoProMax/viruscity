// Utilidades de prueba del auth-service (node:test, sin red).
// No forman parte del código de producción: la app no tiene ningún "modo de prueba";
// las pruebas solo le inyectan dependencias (base en memoria, verificador de Google falso).

const { DatabaseSync } = require("node:sqlite");
const { ensureSchema } = require("../db.js");
const { createApp } = require("../app.js");

const JWT_SECRET = "s".repeat(48);
const CLIENT_ID = "123456789012-pruebas.apps.googleusercontent.com";

// Captura todo lo que la app escribe en consola (para comprobar que no filtra secretos)
function captureLogs() {
    const lines = [];
    const original = { log: console.log, error: console.error, warn: console.warn };
    for (const name of Object.keys(original)) {
        console[name] = (...args) => lines.push(args.map(String).join(" "));
    }
    return {
        lines,
        restore() {
            Object.assign(console, original);
        },
    };
}

// Verificador falso: acepta "ok|<sub>|<email>|<true|false>" y lanza (con el token en el mensaje,
// como haría la librería real) para cualquier otro valor
function fakeGoogleVerifier(clientId = CLIENT_ID) {
    return async (idToken) => {
        const parts = String(idToken).split("|");
        if (parts.length !== 4 || parts[0] !== "ok") throw new Error(`ID token rechazado: ${idToken}`);
        return { sub: parts[1], email: parts[2], email_verified: parts[3] === "true", aud: clientId, iss: "https://accounts.google.com" };
    };
}

// Levanta la app en un puerto libre. Devuelve { db, post, get, close }.
async function startApp({ db, verifyGoogle = fakeGoogleVerifier(), jwtExpiresIn = "1h", bcryptRounds = 10 } = {}) {
    if (!db) {
        db = new DatabaseSync(":memory:");
        ensureSchema(db, { dbPath: ":memory:" });
    }
    const app = createApp({ db, jwtSecret: JWT_SECRET, jwtExpiresIn, bcryptRounds, verifyGoogle });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    async function request(method, route, body, headers = { "Content-Type": "application/json" }) {
        const options = { method, headers };
        if (body !== undefined) options.body = typeof body === "string" ? body : JSON.stringify(body);
        const res = await fetch(base + route, options);
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = undefined;
        }
        return { status: res.status, text, json };
    }

    return {
        db,
        post: (route, body, headers) => request("POST", route, body, headers),
        get: (route) => request("GET", route),
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(resolve);
            }),
    };
}

// Payload de un JWT (sin verificar: las pruebas solo miran su contenido)
const decodeJwt = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url"));

module.exports = { JWT_SECRET, CLIENT_ID, captureLogs, fakeGoogleVerifier, startApp, decodeJwt };
