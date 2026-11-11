// Directorio de coordinadores y reconexión (Taller 6): funciones puras, sin red ni DOM.
//
// Flujo del cliente: login → GET {AUTH_URL}/coordinator → { coordinatorId, publicUrl } → WebSocket a
// {publicUrl}/connect?token=…. Si la conexión se cae, NO se reconecta al mismo coordinador: se vuelve a
// pedir uno al directorio (que solo devuelve coordinadores vivos).

export const MAX_ATTEMPTS = 20;

const WS_URL = /^wss?:\/\//i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Respuesta de GET /coordinator → { kind: "ok", coordinatorId, publicUrl } | { kind: "none" } | { kind: "error" }
export function parseCoordinatorResponse(status, body) {
    if (status === 200 && body && typeof body === "object") {
        const { coordinatorId, publicUrl } = body;
        if (typeof coordinatorId === "string" && coordinatorId && typeof publicUrl === "string" && WS_URL.test(publicUrl)) {
            return { kind: "ok", coordinatorId, publicUrl };
        }
        return { kind: "error" };
    }
    if (status === 503 && body?.error === "no_coordinators_available") return { kind: "none" };
    return { kind: "error" };
}

// URL del WebSocket del juego
export function buildWsUrl(publicUrl, token) {
    return `${String(publicUrl).replace(/\/+$/, "")}/connect?token=${encodeURIComponent(token)}`;
}

// ¿El navegador bloquearía esta conexión? Una página https no puede abrir ws:// (contenido mixto),
// salvo hacia el propio equipo (localhost, 127.0.0.1, [::1]).
export function isMixedContent(pageProtocol, pageHostname, wsUrl) {
    if (pageProtocol !== "https:") return false;
    let url;
    try {
        url = new URL(wsUrl);
    } catch {
        return false;
    }
    return url.protocol === "ws:" && !LOCAL_HOSTS.has(url.hostname);
}

// Espera antes del intento N (1, 2, 3 s y luego 3 s fijos)
export const nextDelay = (attempt) => Math.min(1000 * Math.max(1, attempt), 3000);

// Qué hacer cuando se cierra el WebSocket del juego
export function classifyClose(code, loggingOut) {
    if (loggingOut) return "none";
    if (code === 4001) return "login-invalid";
    if (code === 4002) return "login-replaced";
    return "reconnect";
}
