// Directorio de coordinadores y reconexión (Taller 6): funciones puras, sin red ni DOM.
//
// Flujo del cliente: login → GET {AUTH_URL}/coordinator → { coordinatorId, publicUrl } → WebSocket a
// {publicUrl}/connect?token=…. Si la conexión se cae, NO se reconecta al mismo coordinador: se vuelve a
// pedir uno al directorio (que solo devuelve coordinadores vivos).
//
// Tiempo de gracia: desde que se pierde la conexión (o desde el primer intento fallido) el cliente reintenta
// durante RECONNECT_GRACE_MS. Si en ese tiempo no vuelve a tener un coordinador, los servicios se dan por caídos y
// vuelve al inicio con un aviso. Se mide por TIEMPO y no por intentos: si el auth también cayó, cada intento puede
// tardar hasta 12 s (failover), y con un límite de intentos la espera se alargaba a minutos.

export const MAX_ATTEMPTS = 20;
export const DEFAULT_RECONNECT_GRACE_MS = 45000;
export const MIN_RECONNECT_GRACE_MS = 5000;
export const CONNECT_TIMEOUT_MS = 8000; // un WebSocket que no abre en este tiempo se da por fallido
export const SERVICES_DOWN_MESSAGE = "Se cayeron los servicios del juego: no hay coordinadores disponibles. Vuelve a entrar cuando estén en línea.";

// RECONNECT_GRACE_MS de /config.js: entero en ms ≥ MIN_RECONNECT_GRACE_MS; cualquier otro valor usa el de por defecto
export function readGraceMs(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= MIN_RECONNECT_GRACE_MS ? n : DEFAULT_RECONNECT_GRACE_MS;
}

// Milisegundos de gracia que quedan (lostAt null = conectado: queda toda la gracia)
export function graceLeftMs(lostAt, now, graceMs) {
    if (lostAt === null || lostAt === undefined) return graceMs;
    return Math.max(0, graceMs - (now - lostAt));
}

// ¿Hay que rendirse? Se acabó la gracia, o se llegó al máximo de intentos (lo que pase primero)
export const shouldGiveUp = (lostAt, now, graceMs, attempts) => (lostAt !== null && lostAt !== undefined && graceLeftMs(lostAt, now, graceMs) === 0) || attempts >= MAX_ATTEMPTS;

// Aviso mientras se reintenta, con la cuenta atrás hasta volver al inicio
export function reconnectNotice(reason, leftMs) {
    return `${reason} Reintentando… si no vuelve en ${Math.ceil(leftMs / 1000)} s, se vuelve al inicio.`;
}

const WS_URL = /^wss?:\/\//i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// ---------- Coordinadores que acaban de fallar ----------
// Si cae coord-a y el directorio todavía lista a coord-b aunque no responda (su TTL de 6 s no venció, o su túnel
// cayó), el cliente recuerda los que le fallaron y pide GET /coordinator?exclude=coord-a,coord-b: así pasa a
// coord-c sin gastar la gracia. Cada fallo se recuerda FAILED_TTL_MS (más que el TTL del directorio).
export const FAILED_TTL_MS = 15000;
const FAILED_MAX = 10;

// failed: { [coordinatorId]: instante del fallo }. Devuelve un objeto NUEVO (sin los vencidos)
export function rememberFailure(failed, id, now) {
    const out = {};
    for (const [k, at] of Object.entries(failed ?? {})) if (now - at < FAILED_TTL_MS) out[k] = at;
    if (typeof id === "string" && id) out[id] = now;
    return out;
}
export function forgetFailure(failed, id) {
    const out = { ...(failed ?? {}) };
    delete out[id];
    return out;
}
// Ids que fallaron hace menos de FAILED_TTL_MS (los más recientes primero, como mucho FAILED_MAX)
export function recentFailures(failed, now) {
    return Object.entries(failed ?? {})
        .filter(([, at]) => now - at < FAILED_TTL_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, FAILED_MAX)
        .map(([id]) => id);
}
// Ruta para pedir coordinador al directorio, saltando los que fallaron
export function coordinatorPath(excludeIds) {
    const ids = (excludeIds ?? []).filter((id) => typeof id === "string" && id);
    return ids.length ? `/coordinator?exclude=${ids.map(encodeURIComponent).join(",")}` : "/coordinator";
}

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

// URL del WebSocket de un ESPECTADOR (track 2.5): sin token; el coordinador lo atiende en /spectate
export function buildSpectateUrl(publicUrl) {
    return `${String(publicUrl).replace(/\/+$/, "")}/spectate`;
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
