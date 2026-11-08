// Lobby: se conecta al coordinator por WebSocket con el token guardado en el login
// y muestra en vivo la lista de jugadores conectados.
// Si la conexión se cierra sin que el usuario cierre sesión, vuelve al login con un mensaje.
// Se carga como módulo: la parte visual la pinta ui/lobby-view.js (siempre con textContent).

import { UI } from "./ui/ui-config.js";
import { createLobbyView } from "./ui/lobby-view.js";
import { startLobbyPreview } from "./ui/preview.js";

const $ = (id) => document.getElementById(id); // atajo tomado de dashboard/common.js del código base

const view = createLobbyView(document.body);

// Mensajes según el código de cierre del coordinator
const CLOSE_MESSAGES = {
    4001: "Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.",
    4002: "Tu sesión se abrió en otra pestaña. Esta sesión fue cerrada.",
};
const DEFAULT_CLOSE_MESSAGE = "Se perdió la conexión con el coordinador. Inicia sesión de nuevo.";

// Lee el payload del JWT sin verificar la firma (la verificación la hace el coordinator).
// Solo se usa para saber quién soy en la lista. Devuelve null si no se puede leer.
function decodeTokenPayload(token) {
    try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

// Indicador de conexión (adaptado de setWsStatus() del dashboard del código base)
function setStatus(state) {
    const texts = {
        connecting: "Conectando…",
        connected: "Conectado",
        disconnected: "Desconectado",
    };
    view.setStatus(state, texts[state]);
}

// Borra la sesión guardada en el navegador
function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
}

function startLobby(token) {
    const username = localStorage.getItem("username") || "";
    const myUsername = decodeTokenPayload(token)?.username ?? null;
    let loggingOut = false;

    view.setUser(username);
    setStatus("connecting");

    const ws = new WebSocket(`${window.APP_CONFIG.COORDINATOR_WS_URL}/connect?token=${encodeURIComponent(token)}`);

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return; // mensaje que no es JSON: se ignora
        }
        if (msg && msg.type === "players_update" && Array.isArray(msg.players)) view.setPlayers(msg.players, myUsername);
    };

    // Cierre inesperado: se guarda el motivo, se borra la sesión y se vuelve al login (sin reconexión)
    ws.onclose = (event) => {
        setStatus("disconnected");
        if (loggingOut) return;
        sessionStorage.setItem("sessionMessage", CLOSE_MESSAGES[event.code] || DEFAULT_CLOSE_MESSAGE);
        clearSession();
        window.location.href = "login.html";
    };

    $("logoutButton").addEventListener("click", () => {
        loggingOut = true;
        clearSession();
        ws.close(1000, "logout");
        window.location.href = "login.html";
    });
}

// Vista previa de diseño (?preview): datos de ejemplo, sin token ni WebSocket
const isPreview = UI.PREVIEW_ENABLED && new URLSearchParams(location.search).has("preview");

if (isPreview) {
    startLobbyPreview(view);
} else {
    // Sin token no hay sesión: directo al login
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "login.html";
    } else {
        startLobby(token);
    }
}
