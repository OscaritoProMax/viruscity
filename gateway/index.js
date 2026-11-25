// Gateway para ngrok (Taller 7, decisión 18): un solo puerto (y un solo túnel) delante de todo el sistema.
//
//   /auth-a/...  → http://localhost:4001/...      /coord-a/...  → http://localhost:5001/... (también WebSocket)
//   /auth-b/...  → http://localhost:4002/...      /coord-b/...  → http://localhost:5002/...
//   /auth-c/...  → http://localhost:4003/...      /coord-c/...  → http://localhost:5003/...
//   todo lo demás → GATEWAY_DEFAULT (el client, http://localhost:3000)
//
// La ruta más larga que coincida en un límite de segmento gana y se le QUITA el prefijo al reenviar (match.js).
// Los upgrades WebSocket siguen la misma regla; un upgrade sin ruta se cierra (el client no tiene WebSocket).
// Si el destino falla: 502 { error:"bad_gateway" } (o se cierra el socket del WebSocket).
// Nunca se registran cuerpos, headers ni query strings (el token del WebSocket viaja en la query).
//
// Configuración (variables de entorno o gateway/.env): PORT (8080), GATEWAY_ROUTES, GATEWAY_DEFAULT.
// createGateway({ routes, defaultTarget, log }) → http.Server (sin escuchar; lo usan las pruebas)

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const httpProxy = require("http-proxy");
const { DEFAULT_ROUTES, parseRoutes, parseTarget, matchRoute } = require("./match.js");

const SILENT = { log() {}, error() {} };

function createGateway({ routes, defaultTarget, log = SILENT }) {
    const proxy = httpProxy.createProxyServer({ xfwd: true, ws: true });

    // Destino caído o que corta la conexión: 502 en HTTP, cierre en WebSocket
    proxy.on("error", (err, req, resOrSocket) => {
        if (resOrSocket && typeof resOrSocket.writeHead === "function") {
            if (!resOrSocket.headersSent) resOrSocket.writeHead(502, { "Content-Type": "application/json" });
            resOrSocket.end(JSON.stringify({ error: "bad_gateway" }));
        } else {
            resOrSocket?.destroy?.();
        }
        log.error(`[gateway] destino no disponible para ${req.gatewayLabel ?? "?"} (${err.code ?? "error"})`);
    });

    const server = http.createServer((req, res) => {
        const m = matchRoute(req.url, routes);
        req.gatewayLabel = m ? m.prefix : "/";
        if (m) req.url = m.rest;
        // Registro mínimo: método, prefijo y status (sin path completo, query, headers ni cuerpo)
        res.on("finish", () => log.log(`${req.method} ${req.gatewayLabel} ${res.statusCode}`));
        proxy.web(req, res, { target: m ? m.target : defaultTarget });
    });

    server.on("upgrade", (req, socket, head) => {
        socket.on("error", () => {});
        const m = matchRoute(req.url, routes);
        if (!m) {
            socket.destroy(); // WebSocket sin destino
            return;
        }
        req.gatewayLabel = m.prefix;
        req.url = m.rest;
        proxy.ws(req, socket, head, { target: m.target });
    });

    server.on("close", () => proxy.close());
    return server;
}

function main() {
    const envFile = path.join(__dirname, ".env");
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile); // las variables del entorno prevalecen

    let routes;
    let defaultTarget;
    let port;
    try {
        routes = parseRoutes(process.env.GATEWAY_ROUTES?.trim() ? process.env.GATEWAY_ROUTES : DEFAULT_ROUTES);
        defaultTarget = parseTarget("GATEWAY_DEFAULT", process.env.GATEWAY_DEFAULT?.trim() ? process.env.GATEWAY_DEFAULT : "http://localhost:3000");
        port = Number(process.env.PORT || 8080);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un número de puerto válido");
    } catch (err) {
        console.error(`Error de configuración: ${err.message}`);
        process.exit(1);
    }

    const server = createGateway({ routes, defaultTarget, log: console });
    server.listen(port, (err) => {
        if (err) {
            console.error(`No se pudo iniciar el gateway: ${err.message}`);
            process.exit(1);
        }
        console.log(`Gateway en puerto ${port}`);
        for (const r of [...routes].sort((a, b) => a.prefix.localeCompare(b.prefix))) console.log(`  ${r.prefix} → ${r.target}`);
        console.log(`  (resto) → ${defaultTarget}`);
    });
    server.on("error", (err) => {
        console.error(`No se pudo iniciar el gateway: ${err.code === "EADDRINUSE" ? `el puerto ${port} está ocupado` : err.message}`);
        process.exit(1);
    });

    const shutdown = () => {
        server.closeAllConnections?.();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 3000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

if (require.main === module) main();

module.exports = { createGateway };
