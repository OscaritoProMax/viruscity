// window.authFetch(path, init) — llamadas al clúster de auth con failover (Taller 7, decisión 16).
// Script CLÁSICO: se carga después de /config.js y antes de los scripts de cada página (login, juego, clúster).
// La primera vez importa js/auth/failover.js y crea un cliente con window.APP_CONFIG.AUTH_URLS.
//
// Devuelve la Response del nodo que contestó, con la propiedad authInfo = { authId, authRole, retried, nodeUrl },
// y emite en document el evento 'viruscity:auth-node' con ese mismo detalle (lo usa el indicador "Auth: …").
// Si ningún nodo sirve dentro del presupuesto, la promesa se rechaza con un AuthUnavailableError
// (window.isAuthUnavailable(err) lo reconoce).
(function () {
    "use strict";
    let clientPromise = null;

    function getClient() {
        if (!clientPromise) {
            const config = window.APP_CONFIG || {};
            const urls = Array.isArray(config.AUTH_URLS) && config.AUTH_URLS.length > 0 ? config.AUTH_URLS : [config.AUTH_URL];
            // Relativo a este script (js/), no a la página
            clientPromise = import("./auth/failover.js").then((m) => m.createAuthClient({ urls }));
            clientPromise.catch(() => {
                clientPromise = null; // si falló la carga del módulo, se reintenta la próxima vez
            });
        }
        return clientPromise;
    }

    window.authFetch = async function authFetch(path, init) {
        const options = init || {};
        const client = await getClient();
        // Evita la página de aviso de ngrok en vez del JSON
        const headers = Object.assign({}, options.headers || {}, { "ngrok-skip-browser-warning": "true" });
        const result = await client.request(path, Object.assign({}, options, { headers }));
        const info = { authId: result.authId, authRole: result.authRole, retried: result.retried, nodeUrl: result.nodeUrl };
        result.response.authInfo = info;
        document.dispatchEvent(new CustomEvent("viruscity:auth-node", { detail: info }));
        return result.response;
    };

    window.isAuthUnavailable = (err) => Boolean(err && err.name === "AuthUnavailableError");
})();
