// Client: sirve las páginas estáticas (login y lobby) desde public/
// y genera /config.js con las URLs del auth-service y del coordinator tomadas de .env,
// para que ningún archivo del cliente tenga URLs escritas a mano.
//
// Configuración: variables de entorno cargadas desde .env (ver .env.example).
// PORT y AUTH_URLS (o AUTH_URL) son obligatorios; GOOGLE_CLIENT_ID y COORDINATOR_WS_URL son opcionales.
// Taller 7: AUTH_URLS es la lista de auth-services del clúster (separadas por comas); el navegador hace failover
// entre ellas (js/auth/failover.js). Si solo existe AUTH_URL, es una lista de una.
// Taller 6: el juego ya no se conecta a un coordinador fijo: pide uno a GET {AUTH_URL}/coordinator.
// COORDINATOR_WS_URL queda solo por compatibilidad (vacío por defecto; /config.js lo sigue entregando).

require("dotenv").config({ quiet: true }); // quiet: evita que dotenv imprima su propio mensaje en consola

const path = require("node:path");
const express = require("express");

// ---------- Configuración ----------

// Detiene el proceso con un motivo claro si la configuración no es válida
function fatal(reason) {
    console.error(`Error de configuración: ${reason}`);
    process.exit(1);
}

// Quita las barras finales: "https://x.ngrok-free.app/" -> "https://x.ngrok-free.app"
const trimSlash = (url) => url.replace(/\/+$/, "");

// Comprueba que la URL sea válida y use uno de los protocolos esperados
function checkUrl(name, value, protocols) {
    let url;
    try {
        url = new URL(value);
    } catch {
        fatal(`${name} no es una URL válida`);
    }
    if (!protocols.includes(url.protocol)) fatal(`${name} debe empezar por ${protocols.map((p) => p + "//").join(" o ")}`);
}

const PORT = Number(process.env.PORT);
const AUTH_URLS_RAW = String(process.env.AUTH_URLS || process.env.AUTH_URL || "").trim();
const AUTH_URLS_KEY = process.env.AUTH_URLS ? "AUTH_URLS" : "AUTH_URL";
const COORDINATOR_WS_URL = trimSlash(process.env.COORDINATOR_WS_URL || "");
// Client ID público de Google (Taller 5). Opcional: si falta, el login no muestra el botón de Google.
const GOOGLE_CLIENT_ID = trimSlash((process.env.GOOGLE_CLIENT_ID || "").trim());

if (!process.env.PORT) fatal("PORT es obligatorio");
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fatal("PORT debe ser un número de puerto válido");
if (!AUTH_URLS_RAW) fatal("AUTH_URLS es obligatorio (URLs http:// o https:// del auth-service separadas por comas)");
const AUTH_URLS = AUTH_URLS_RAW.split(",").map((part, i) => {
    const value = trimSlash(part.trim());
    if (!value) fatal(`${AUTH_URLS_KEY}: la entrada ${i + 1} está vacía`);
    checkUrl(AUTH_URLS_KEY, value, ["http:", "https:"]);
    return value;
});
if (new Set(AUTH_URLS).size !== AUTH_URLS.length) fatal(`${AUTH_URLS_KEY} tiene una URL repetida`);
const AUTH_URL = AUTH_URLS[0]; // compatibilidad: el primero
if (COORDINATOR_WS_URL) checkUrl("COORDINATOR_WS_URL", COORDINATOR_WS_URL, ["ws:", "wss:"]); // opcional (Taller 6)

// ---------- HTTP ----------
const app = express();

// La raíz lleva directo a la pantalla de login
app.get("/", (req, res) => {
    res.redirect("/login.html");
});

// Configuración del navegador generada desde .env (sin caché, para que un cambio en .env se note al recargar)
app.get("/config.js", (req, res) => {
    res.set("Content-Type", "application/javascript; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send("window.APP_CONFIG = " + JSON.stringify({ AUTH_URLS, AUTH_URL, COORDINATOR_WS_URL, GOOGLE_CLIENT_ID }) + ";");
});

app.use(express.static(path.join(__dirname, "public")));

// Cualquier otra ruta
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// ---------- Arranque ----------
const server = app.listen(PORT, (err) => {
    if (err) {
        // p. ej. puerto ocupado
        console.error(`No se pudo iniciar el servidor: ${err.message}`);
        process.exit(1);
    }
    console.log(`Client en puerto ${PORT}`);
});

// Cierre ordenado con Ctrl+C o una señal de terminación
const SHUTDOWN_TIMEOUT_MS = 3 * 1000; // espera máxima antes de forzar la salida

function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
