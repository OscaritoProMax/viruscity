// Enrutamiento del gateway (Taller 7, decisión 18). Lógica PURA: sin sockets.
//
// DEFAULT_ROUTES: rutas por defecto (3 auth y 3 coordinadores en localhost)
// parseRoutes(text) → [{ prefix, target }] ordenadas de la más larga a la más corta; lanza con un motivo claro
//   text: "/prefijo=http://host:puerto,/otro=http://host:puerto"
// parseTarget(name, value) → URL http(s) normalizada sin barra final (lanza si no es válida)
// matchRoute(path, routes) → { prefix, target, rest } o null
//   La coincidencia es por límite de segmento: "/auth-a" y "/auth-a/x" sí, "/auth-ab" no. Gana la ruta más
//   larga. rest es el path SIN el prefijo ("/" si no queda nada) con la query intacta.

const DEFAULT_ROUTES =
    "/auth-a=http://localhost:4001,/auth-b=http://localhost:4002,/auth-c=http://localhost:4003," +
    "/coord-a=http://localhost:5001,/coord-b=http://localhost:5002,/coord-c=http://localhost:5003";

const PREFIX_REGEX = /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;

function parseTarget(name, value) {
    const raw = String(value ?? "").trim();
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${name}: "${raw}" no es una URL válida`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name}: el destino debe empezar por http:// o https://`);
    if (url.search || url.hash) throw new Error(`${name}: el destino no puede llevar query ni fragmento`);
    return raw.replace(/\/+$/, "");
}

function parseRoutes(text) {
    const raw = String(text ?? "").trim();
    if (!raw) throw new Error("GATEWAY_ROUTES está vacío");
    const routes = raw.split(",").map((part, i) => {
        const entry = part.trim();
        const eq = entry.indexOf("=");
        if (eq <= 0) throw new Error(`GATEWAY_ROUTES, entrada ${i + 1}: debe tener la forma /prefijo=http://host:puerto`);
        const prefix = entry.slice(0, eq).trim().replace(/\/+$/, "");
        if (!PREFIX_REGEX.test(prefix)) throw new Error(`GATEWAY_ROUTES, entrada ${i + 1}: el prefijo "${prefix}" debe empezar por / y no puede ser la raíz`);
        return { prefix, target: parseTarget(`GATEWAY_ROUTES, entrada ${i + 1}`, entry.slice(eq + 1)) };
    });
    const seen = new Set();
    for (const r of routes) {
        if (seen.has(r.prefix)) throw new Error(`GATEWAY_ROUTES tiene el prefijo repetido "${r.prefix}"`);
        seen.add(r.prefix);
    }
    return routes.sort((a, b) => b.prefix.length - a.prefix.length);
}

function matchRoute(path, routes) {
    const raw = typeof path === "string" && path.startsWith("/") ? path : "/";
    const q = raw.indexOf("?");
    const pathname = q === -1 ? raw : raw.slice(0, q);
    const query = q === -1 ? "" : raw.slice(q);
    for (const route of routes) {
        if (pathname === route.prefix || pathname.startsWith(route.prefix + "/")) {
            const rest = pathname.slice(route.prefix.length) || "/";
            return { prefix: route.prefix, target: route.target, rest: rest + query };
        }
    }
    return null;
}

module.exports = { DEFAULT_ROUTES, parseRoutes, parseTarget, matchRoute };
