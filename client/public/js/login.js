// Pantalla de login y registro.
// Las URLs vienen de window.APP_CONFIG, que genera el servidor del cliente en /config.js desde .env.
// Taller 7: las peticiones van por window.authFetch (js/auth-fetch.js), con failover entre los auth-services.
// Todo el texto dinámico se inserta con textContent: nunca se interpreta texto como HTML.

const $ = (id) => document.getElementById(id); // atajo tomado de dashboard/common.js del código base

// 'ngrok-skip-browser-warning' evita que ngrok responda con su página de aviso en vez del JSON
const HEADERS = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" };
const NETWORK_ERROR = "No se pudo conectar con el servicio de autenticación";
const AUTH_UNAVAILABLE = "No hay servidores de autenticación disponibles. Inténtalo de nuevo en unos segundos.";
const RETRIED_CONFLICT = "El usuario ya existe. Si acabas de registrarte, inicia sesión.";
const failureMessage = (err) => (window.isAuthUnavailable(err) ? AUTH_UNAVAILABLE : NETWORK_ERROR);

// Muestra un mensaje verde (ok) o rojo (error) en el <p> indicado
function showMessage(el, text, ok) {
    el.textContent = text;
    el.className = `msg ${ok ? "ok" : "bad"}`;
}

// Envía { username, password } al auth-service. Devuelve { status, data, retried } o lanza si no hay red.
async function postCredentials(route, form) {
    const body = {
        username: form.elements.username.value.trim(), // el login no recorta espacios en el servidor
        password: form.elements.password.value,
    };
    const res = await window.authFetch(route, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({})); // por si la respuesta no es JSON
    return { status: res.status, data, retried: res.authInfo?.retried === true };
}

// Ejecuta la petición con el botón deshabilitado mientras está en curso
async function withButtonDisabled(form, task) {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
        await task();
    } finally {
        button.disabled = false;
    }
}

// ---------- Aviso de sesión ----------
// El lobby guarda aquí el motivo por el que se cerró la sesión; se muestra una sola vez
const sessionMessage = sessionStorage.getItem("sessionMessage");
if (sessionMessage) {
    $("sessionBanner").textContent = sessionMessage;
    $("sessionBanner").hidden = false;
    sessionStorage.removeItem("sessionMessage");
}

// ---------- Registro ----------
$("registerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("registerMessage");

    withButtonDisabled(form, async () => {
        try {
            const { status, data, retried } = await postCredentials("/register", form);
            if (status === 201) {
                // No se inicia sesión automáticamente: el usuario debe hacer login
                showMessage(message, "Registro exitoso. Ahora inicia sesión.", true);
                form.reset();
                document.dispatchEvent(new CustomEvent("viruscity:registered", { detail: { username: data.username } }));
            } else if (status === 409 && retried) {
                // Con reintentos, el primer intento pudo haber registrado al usuario (resultado ambiguo)
                showMessage(message, RETRIED_CONFLICT, false);
            } else {
                showMessage(message, data.error || `Error inesperado del servidor (${status})`, false);
            }
        } catch (err) {
            showMessage(message, failureMessage(err), false);
        }
    });
});

// ---------- Login ----------
$("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("loginMessage");

    withButtonDisabled(form, async () => {
        try {
            const { status, data } = await postCredentials("/login", form);
            if (status === 200 && data.token) {
                localStorage.setItem("token", data.token);
                localStorage.setItem("username", data.username);
                window.location.href = "play.html";
            } else {
                showMessage(message, data.error || `Error inesperado del servidor (${status})`, false);
            }
        } catch (err) {
            showMessage(message, failureMessage(err), false);
        }
    });
});
