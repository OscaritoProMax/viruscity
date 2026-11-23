// Failover entre los auth-services del clúster (Taller 7, decisión 16). Lógica pura con fetch, sleep y reloj
// inyectables: la usan el navegador (auth-fetch.js) y el smoke completo del coordinador.
//
// normalizeUrl(u)                         → URL sin barras finales ("" si no es texto)
// isAllowedLeaderUrl(leaderUrl, urls)     → true solo si es EXACTAMENTE (normalizada) una entrada de AUTH_URLS
// classifyResponse(status, body, urls)    → 'return' | 'follow' | 'next' | 'retry'
// authNodeLabel(info)                     → "Auth: auth-b (líder)" | "Auth: auth-a (réplica)" | "Auth: —" (decisión 17)
// createAuthClient({ urls, fetchImpl, sleep, now, timeoutMs, budgetMs }) → { request(path, init), lastNode() }
//   request → Promise<{ response, authId, authRole, retried, nodeUrl }>; si se agota el presupuesto lanza
//   AuthUnavailableError con el último motivo (reason) y, si el último nodo respondió, su status y su cuerpo
//   (así GET /coordinator puede distinguir "sin coordinadores" de "sin auth").
//
// Reglas (decisión 16):
// - Se empieza por el último nodo que respondió.
// - Error de red, timeout (4 s) o 5xx distinto de los 503 de abajo → siguiente nodo ('next').
// - 503 not_leader con leaderUrl EXACTAMENTE igual a una entrada de AUTH_URLS → reintento inmediato contra esa
//   URL, una sola vez ('follow').
// - 503 no_leader / no_quorum / replication_timeout, o not_leader sin URL permitida → siguiente nodo ('retry');
//   tras una pasada completa sin éxito se espera 1 s y se hace otra, hasta un presupuesto de 12 s.
// - Cualquier otra respuesta (2xx, 4xx…) se devuelve tal cual ('return').
// Las peticiones son siempre secuenciales: un POST nunca se manda a dos nodos a la vez.

export const RETRY_ERRORS = Object.freeze(["no_leader", "no_quorum", "replication_timeout", "not_leader"]);
export const PASS_PAUSE_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 4000;
export const DEFAULT_BUDGET_MS = 12000;

// Texto del indicador del auth que respondió (X-Auth-Id y X-Auth-Role de la última respuesta)
const ROLE_LABELS = { leader: "líder", replica: "réplica" };
export function authNodeLabel(info) {
    const id = typeof info?.authId === "string" && info.authId ? info.authId : null;
    if (!id) return "Auth: —";
    const role = ROLE_LABELS[info.authRole];
    return role ? `Auth: ${id} (${role})` : `Auth: ${id}`;
}

export class AuthUnavailableError extends Error {
    constructor(reason, last = {}) {
        super(`No hay servidores de autenticación disponibles (${reason ?? "sin respuesta"})`);
        this.name = "AuthUnavailableError";
        this.reason = reason ?? "sin respuesta";
        this.status = last.status ?? null; // status de la última respuesta (null si fue error de red)
        this.body = last.body ?? null;
    }
}

export function normalizeUrl(u) {
    return typeof u === "string" ? u.trim().replace(/\/+$/, "") : "";
}

export function isAllowedLeaderUrl(leaderUrl, urls) {
    const target = normalizeUrl(leaderUrl);
    return target !== "" && (urls ?? []).some((u) => normalizeUrl(u) === target);
}

// status y cuerpo (ya leído como JSON, o null) → qué hacer
export function classifyResponse(status, body, urls = []) {
    if (status === 503) {
        const error = body && typeof body === "object" ? body.error : null;
        if (error === "not_leader" && isAllowedLeaderUrl(body.leaderUrl, urls)) return "follow";
        if (RETRY_ERRORS.includes(error)) return "retry";
        return "next"; // otro 503: como cualquier 5xx
    }
    if (status >= 500) return "next";
    return "return";
}

function timeoutSignal(ms) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

export function createAuthClient({
    urls,
    fetchImpl = (...args) => fetch(...args),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    budgetMs = DEFAULT_BUDGET_MS,
} = {}) {
    const list = [...new Set((urls ?? []).map(normalizeUrl).filter(Boolean))];
    if (list.length === 0) throw new Error("createAuthClient: hace falta al menos una URL del auth");
    let last = 0; // índice del último nodo que respondió

    // Un intento contra una URL: { kind, response?, reason }
    async function attempt(baseUrl, path, init) {
        let response;
        try {
            response = await fetchImpl(baseUrl + path, { ...init, signal: timeoutSignal(timeoutMs) });
        } catch (err) {
            return { kind: "next", reason: err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "error de red" };
        }
        let body = null;
        if (response.status >= 500) {
            try {
                body = await response.clone().json();
            } catch {
                body = null;
            }
        }
        const kind = classifyResponse(response.status, body, list);
        return { kind, response, body, reason: body?.error ?? `HTTP ${response.status}` };
    }

    function done(response, nodeUrl, attempts) {
        const i = list.indexOf(nodeUrl);
        if (i !== -1) last = i;
        const headers = response.headers;
        return {
            response,
            authId: headers?.get?.("X-Auth-Id") ?? null,
            authRole: headers?.get?.("X-Auth-Role") ?? null,
            retried: attempts > 1,
            nodeUrl,
        };
    }

    async function request(path, init = {}) {
        const start = now();
        let attempts = 0;
        let lastReason = null;
        let lastSeen = {};
        const fail = () => new AuthUnavailableError(lastReason, lastSeen);
        const outOfBudget = () => now() - start >= budgetMs;
        for (;;) {
            const first = last;
            for (let i = 0; i < list.length; i++) {
                if (outOfBudget()) throw fail();
                const nodeUrl = list[(first + i) % list.length];
                attempts += 1;
                const r = await attempt(nodeUrl, path, init);
                lastReason = r.reason;
                lastSeen = { status: r.response?.status ?? null, body: r.body ?? null };
                if (r.kind === "return") return done(r.response, nodeUrl, attempts);
                if (r.kind === "follow") {
                    // Una réplica indica el líder: un solo reintento inmediato contra esa URL
                    const leaderUrl = normalizeUrl(r.body.leaderUrl);
                    if (outOfBudget()) throw fail();
                    attempts += 1;
                    const f = await attempt(leaderUrl, path, init);
                    lastReason = f.reason;
                    lastSeen = { status: f.response?.status ?? null, body: f.body ?? null };
                    if (f.kind === "return") return done(f.response, leaderUrl, attempts);
                }
            }
            // Pasada completa sin éxito: 1 s y otra, mientras quede presupuesto
            if (now() - start + PASS_PAUSE_MS >= budgetMs) throw fail();
            await sleep(PASS_PAUSE_MS);
        }
    }

    return { request, lastNode: () => list[last] };
}
