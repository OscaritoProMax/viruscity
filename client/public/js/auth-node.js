// Indicador "Auth: <authId> (líder|réplica)" (Taller 7, decisión 17). Script CLÁSICO que se carga después de
// js/auth-fetch.js en login.html y play.html. Escucha el evento 'viruscity:auth-node' que emite window.authFetch
// con los headers X-Auth-Id y X-Auth-Role de la última respuesta y actualiza #authNode con textContent.
// Antes de la primera respuesta queda "Auth: —" (lo trae el HTML).
(function () {
    "use strict";
    let label = null;
    let last = null;

    function render() {
        const el = document.getElementById("authNode");
        if (!el || !label || !last) return;
        el.textContent = label(last);
        el.title = last.nodeUrl || "";
    }

    // El texto sale de la función pura (y probada) del módulo de failover
    import("./auth/failover.js")
        .then((m) => {
            label = m.authNodeLabel;
            render();
        })
        .catch(() => {
            label = (info) => (info && info.authId ? `Auth: ${info.authId}` : "Auth: —");
            render();
        });

    document.addEventListener("viruscity:auth-node", (event) => {
        last = event.detail || null;
        render();
    });
})();
