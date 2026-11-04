// Lobby: se conecta al coordinator por WebSocket con el token guardado en el login
// y muestra en vivo la lista de jugadores conectados.
// Si la conexión se cierra sin que el usuario cierre sesión, vuelve al login con un mensaje.
// Todo el texto dinámico se inserta con textContent (nunca innerHTML).

const $ = (id) => document.getElementById(id); // atajo tomado de dashboard/common.js del código base

// Mensajes según el código de cierre del coordinator
const CLOSE_MESSAGES = {
    4001: "Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.",
    4002: "Tu sesión se abrió en otra pestaña. Esta sesión fue cerrada.",
};
const DEFAULT_CLOSE_MESSAGE = "Se perdió la conexión con el coordinador. Inicia sesión de nuevo.";

// Lee el payload del JWT sin verificar la firma (la verificación la hace el coordinator).
// Solo se usa para saber cuál es "mi" userId en la lista. Devuelve null si no se puede leer.
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
    const states = {
        connecting: ["Conectando…", "muted"],
        connected: ["Conectado", "ok"],
        disconnected: ["Desconectado", "bad"],
    };
    const [text, cls] = states[state];
    $("status").textContent = text;
    $("status").className = `pill ${cls}`;
}

// Borra la sesión guardada en el navegador
function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
}

function startLobby(token) {
    const username = localStorage.getItem("username") || "";
    const myUserId = decodeTokenPayload(token)?.userId ?? null;
    let loggingOut = false;

    $("greeting").textContent = `Hola, ${username}`;
    setStatus("connecting");

    // Vacía la lista y la vuelve a construir con <li> creados a mano
    function renderPlayers(players) {
        const list = $("playerList");
        list.replaceChildren();
        for (const player of players) {
            const li = document.createElement("li");
            li.textContent = player.userId === myUserId ? `${player.username} (tú)` : player.username;
            if (player.userId === myUserId) li.classList.add("me");
            list.append(li);
        }
        $("playerCount").textContent = String(players.length);
    }

    const ws = new WebSocket(`${window.APP_CONFIG.COORDINATOR_WS_URL}/connect?token=${encodeURIComponent(token)}`);

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return; // mensaje que no es JSON: se ignora
        }
        if (msg && msg.type === "players_update" && Array.isArray(msg.players)) renderPlayers(msg.players);
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

// Sin token no hay sesión: directo al login
const token = localStorage.getItem("token");
if (!token) {
    window.location.href = "login.html";
} else {
    startLobby(token);
}
