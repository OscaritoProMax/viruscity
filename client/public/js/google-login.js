// Inicio de sesión con Google (Google Identity Services, opción A del Taller 5).
//
// 1. Si window.APP_CONFIG.GOOGLE_CLIENT_ID está vacío, #googleSlot queda oculto y no se hace nada.
// 2. Espera a que cargue https://accounts.google.com/gsi/client (máx. 5 s) y dibuja el botón (sin One Tap).
// 3. Con el ID token (credential) llama a POST {AUTH_URL}/auth/google { idToken } y, si hace falta,
//    pide un username y reintenta con { idToken, username }.
// El idToken y el token de sesión nunca se escriben en la consola. Todo el texto va con textContent.

import { interpretGoogleResponse } from "./google-flow.js";

const CONFIG = window.APP_CONFIG ?? {};
const CLIENT_ID = typeof CONFIG.GOOGLE_CLIENT_ID === "string" ? CONFIG.GOOGLE_CLIENT_ID.trim() : "";
const AUTH_URL = CONFIG.AUTH_URL;

const WAIT_MS = 5000;
const POLL_MS = 100;
const BUTTON_MAX_WIDTH = 320;
const HEADERS = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" };

const MESSAGES = {
    loadFailed: "No se pudo cargar el inicio de sesión con Google",
    needUsername: "Primer ingreso con Google: elige tu username para continuar.",
    taken: "Ese username ya está en uso. Elige otro.",
    invalid: "No se pudo verificar tu cuenta de Google. Inténtalo de nuevo.",
    notVerified: "Tu correo de Google no está verificado.",
    network: "No se pudo conectar con el servicio de autenticación",
    empty: "Escribe un username.",
};

let idToken = null; // credencial de Google pendiente (solo en memoria)
let busy = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

// Devuelve #googleSlot; si la página no lo trae, lo crea (oculto) debajo de los formularios
function getSlot() {
    let slot = document.getElementById("googleSlot");
    if (slot) return slot;
    slot = el("div");
    slot.id = "googleSlot";
    slot.hidden = true;
    const forms = document.querySelectorAll("form");
    const last = forms[forms.length - 1];
    const anchor = last?.closest('[role="tabpanel"]') ?? last;
    if (anchor) anchor.after(slot);
    else document.body.append(slot);
    return slot;
}

// Espera a que el script de Google defina google.accounts.id
async function waitForGoogle() {
    const end = Date.now() + WAIT_MS;
    while (Date.now() < end) {
        if (window.google?.accounts?.id) return window.google.accounts.id;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return window.google?.accounts?.id ?? null;
}

function start() {
    const slot = getSlot();
    if (!CLIENT_ID) {
        slot.hidden = true; // sin Client ID no se ofrece Google
        return null;
    }
    slot.classList.add("google-slot");

    // ---------- Contenido del slot ----------
    const separator = el("div", "google-separator");
    separator.append(el("span", null, "o continúa con"));
    const buttonBox = el("div", "google-button");

    const panel = el("form", "google-username");
    panel.noValidate = true;
    panel.hidden = true;
    const field = el("div", "field");
    const label = el("label", null, "Elige tu username");
    label.htmlFor = "googleUsername";
    const input = el("input");
    input.id = "googleUsername";
    input.name = "username";
    input.autocomplete = "username";
    input.setAttribute("autocapitalize", "none");
    input.spellcheck = false;
    input.setAttribute("aria-describedby", "googleUsernameHint");
    const hint = el("p", "field__hint", "3 a 32 caracteres: letras, números o guion bajo");
    hint.id = "googleUsernameHint";
    field.append(label, input, hint);
    const submit = el("button", "btn btn--block", "Continuar con Google");
    submit.type = "submit";
    panel.append(field, submit);

    const status = el("p", "msg google-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    slot.replaceChildren(separator, buttonBox, panel, status);

    // ---------- Ayudantes de interfaz ----------
    function show(text, ok = false) {
        status.textContent = text ?? "";
        status.className = `msg google-status${text ? (ok ? " msg--ok" : " msg--error") : ""}`;
    }
    function setBusy(value) {
        busy = value;
        input.disabled = value;
        submit.disabled = value;
        slot.setAttribute("aria-busy", String(value));
    }
    function showPanel(visible) {
        panel.hidden = !visible;
        if (visible) input.focus();
    }

    // ---------- Petición al auth-service ----------
    async function send(username) {
        if (busy || !idToken) return;
        setBusy(true);
        let result;
        try {
            const body = username === undefined ? { idToken } : { idToken, username };
            const res = await fetch(`${AUTH_URL}/auth/google`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
            const data = await res.json().catch(() => null);
            result = interpretGoogleResponse(res.status, data);
        } catch {
            result = { kind: "network" };
        } finally {
            setBusy(false);
        }

        switch (result.kind) {
            case "success":
                idToken = null;
                localStorage.setItem("token", result.token);
                localStorage.setItem("username", result.username);
                window.location.href = "play.html";
                return;
            case "need_username":
                showPanel(true);
                show(MESSAGES.needUsername, true);
                return;
            case "username_taken":
                showPanel(true);
                show(MESSAGES.taken);
                input.select();
                return;
            case "invalid_token":
                idToken = null; // se descarta: hay que volver a pulsar el botón de Google
                showPanel(false);
                show(MESSAGES.invalid);
                return;
            case "email_not_verified":
                idToken = null;
                showPanel(false);
                show(MESSAGES.notVerified);
                return;
            case "bad_request":
                show(result.message);
                if (!panel.hidden) input.focus();
                return;
            default: // server_error o fallo de red
                show(MESSAGES.network);
        }
    }

    panel.addEventListener("submit", (event) => {
        event.preventDefault();
        const username = input.value.trim();
        if (!username) {
            show(MESSAGES.empty);
            input.focus();
            return;
        }
        if (!idToken) {
            showPanel(false);
            show(MESSAGES.invalid);
            return;
        }
        send(username);
    });

    // Respuesta de Google: { credential } es el ID token (JWT). No se registra en ningún lado.
    function onCredential(response) {
        idToken = typeof response?.credential === "string" ? response.credential : null;
        if (!idToken) {
            show(MESSAGES.invalid);
            return;
        }
        show("");
        send(undefined);
    }

    return { slot, buttonBox, show, onCredential };
}

async function init() {
    const ui = start();
    if (!ui) return;

    const gsi = await waitForGoogle();
    ui.slot.hidden = false;
    if (!gsi) {
        ui.show(MESSAGES.loadFailed);
        return;
    }

    gsi.initialize({
        client_id: CLIENT_ID,
        callback: ui.onCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
    });
    // Ancho del botón: 320 px o lo que permita la tarjeta (en pantallas de 360 px es menos)
    const width = Math.max(200, Math.min(BUTTON_MAX_WIDTH, Math.floor(ui.buttonBox.clientWidth || BUTTON_MAX_WIDTH)));
    gsi.renderButton(ui.buttonBox, {
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        locale: "es",
        width,
    });
    // Sin One Tap: no se llama a google.accounts.id.prompt()
}

init();
