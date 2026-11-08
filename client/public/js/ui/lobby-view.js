// Vista del lobby: solo pinta lo que recibe; no conoce el WebSocket ni el token.
//
// createLobbyView(root) → {
//   setUser(name),
//   setStatus(kind, text)      kind: "connecting" | "connected" | "disconnected" | "preview"
//   setPlayers(players, meUsername)   players: [{ userId, username }]
//   showNotice(text | null)
// }
// Todo el texto se inserta con textContent y los nodos se crean con la API del DOM.

import { UI } from "./ui-config.js";
import { createAvatar } from "./avatar.js";

const STATUS_KINDS = new Set(["connecting", "connected", "disconnected", "preview"]);

export function createLobbyView(root) {
    const el = (id) => root.querySelector(`#${id}`);
    const nodes = {
        greeting: el("greeting"),
        userAvatar: el("userAvatar"),
        connection: el("connection"),
        status: el("status"),
        notice: el("notice"),
        playerCount: el("playerCount"),
        playerList: el("playerList"),
        playersEmpty: el("playersEmpty"),
        waitingProgress: el("waitingProgress"),
        waitingCount: el("waitingCount"),
        waitingMin: el("waitingMin"),
        progressBar: el("progressBar"),
        progressText: el("progressText"),
    };

    const minPlayers = UI.MIN_PLAYERS_TO_START;
    let previousIds = new Set();

    // Barra segmentada: un segmento por jugador necesario para iniciar
    const segments = Array.from({ length: minPlayers }, () => {
        const seg = document.createElement("span");
        seg.className = "progress__seg";
        return seg;
    });
    nodes.progressBar.replaceChildren(...segments);
    nodes.progressBar.setAttribute("aria-valuemax", String(minPlayers));
    nodes.waitingMin.textContent = String(minPlayers);
    nodes.waitingProgress.hidden = !UI.SHOW_MIN_PLAYERS_HINT;

    function setUser(name) {
        nodes.greeting.textContent = name;
        nodes.userAvatar.replaceChildren(createAvatar(name, name, 28));
    }

    function setStatus(kind, text) {
        nodes.connection.dataset.state = STATUS_KINDS.has(kind) ? kind : "disconnected";
        nodes.status.textContent = text;
    }

    function updateProgress(count) {
        const lit = Math.min(count, minPlayers);
        segments.forEach((seg, i) => seg.classList.toggle("is-on", i < lit));
        nodes.progressBar.setAttribute("aria-valuenow", String(lit));
        nodes.waitingCount.textContent = String(count);

        const missing = minPlayers - count;
        nodes.progressText.textContent =
            missing <= 0 ? "Sala lista" : `${missing === 1 ? "Falta 1 jugador" : `Faltan ${missing} jugadores`} para iniciar`;
        nodes.progressText.classList.toggle("is-ready", missing <= 0);
    }

    // Reconstruye la lista; solo los ids que no estaban antes reciben la animación de entrada
    function setPlayers(players, meUsername) {
        const rows = players.map((player) => {
            const isMe = meUsername != null && player.username === meUsername;

            const li = document.createElement("li");
            li.className = "player";
            if (isMe) li.classList.add("me");
            if (!previousIds.has(player.userId)) li.classList.add("enter");

            const name = document.createElement("span");
            name.className = "player__name";
            name.textContent = player.username;

            li.append(createAvatar(player.username, player.username, 36), name);

            if (isMe) {
                const chip = document.createElement("span");
                chip.className = "chip chip--accent player__me";
                chip.textContent = "tú";
                li.append(chip);
            }
            return li;
        });

        nodes.playerList.replaceChildren(...rows);
        nodes.playersEmpty.hidden = players.length > 0;
        nodes.playerCount.textContent = String(players.length);
        updateProgress(players.length);
        previousIds = new Set(players.map((p) => p.userId));
    }

    function showNotice(text) {
        nodes.notice.textContent = text ?? "";
        nodes.notice.hidden = !text;
    }

    setPlayers([], null); // estado inicial: lista vacía y progreso en 0
    return { setUser, setStatus, setPlayers, showNotice };
}
