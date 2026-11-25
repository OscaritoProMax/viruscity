// Pantalla de fin de partida (solo presentación).
//
// showEndOverlay(root, { winner, reason, players, youWon }, { onBack }) → { close() }
//   winner: "healthy" | "infected"; players: [{ username, role: "healthy"|"infected", isMe }]
// Diálogo a pantalla completa; foco inicial en "Volver al lobby"; Esc no cierra.

const TITLES = {
    healthy: "¡LA CURA FUNCIONÓ!",
    infected: "LA CIUDAD HA CAÍDO",
};
const ROLE_LABELS = { healthy: "Sano", infected: "Infectado" };

function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

export function showEndOverlay(root, { winner, reason, players = [], youWon }, { onBack } = {}) {
    const side = winner === "infected" ? "infected" : "healthy";
    const previousFocus = document.activeElement;

    const overlay = make("div", `end-overlay end-overlay--${side}`);
    const box = make("div", "end-overlay__box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "endTitle");
    box.setAttribute("aria-describedby", "endReason");

    const title = make("h2", "end-overlay__title", TITLES[side]);
    title.id = "endTitle";
    const reasonText = make("p", "end-overlay__reason", reason ?? "");
    reasonText.id = "endReason";
    const result = make("p", `end-overlay__result ${youWon ? "is-win" : "is-loss"}`, youWon ? "Ganaste" : "Perdiste");

    // Tabla de jugadores con su rol
    const table = make("table", "end-overlay__table");
    table.append(make("caption", "sr-only", "Jugadores de la partida y su rol"));
    const head = make("thead");
    const headRow = make("tr");
    headRow.append(make("th", null, "Jugador"), make("th", null, "Rol"));
    head.append(headRow);
    const body = make("tbody");
    for (const player of players) {
        const row = make("tr", player.isMe ? "is-me" : null);
        const nameCell = make("td", null, player.isMe ? `${player.username} (tú)` : player.username);
        const roleCell = make("td");
        const role = player.role === "infected" ? "infected" : "healthy";
        roleCell.append(make("span", `chip role-chip role-chip--${role}`, ROLE_LABELS[role]));
        row.append(nameCell, roleCell);
        body.append(row);
    }
    table.append(head, body);

    const back = make("button", "btn btn--block end-overlay__back", "Volver al lobby");
    back.type = "button";
    back.addEventListener("click", () => onBack?.());

    box.append(title, reasonText, result, table, back);
    overlay.append(box);
    root.append(overlay);
    document.documentElement.classList.add("has-modal");

    // El único control es el botón: Tab se queda en él y Esc no hace nada
    function onKey(event) {
        if (event.key === "Tab") {
            event.preventDefault();
            back.focus();
        } else if (event.key === "Escape") {
            event.preventDefault();
        }
    }
    overlay.addEventListener("keydown", onKey);
    back.focus();

    return {
        close() {
            overlay.remove();
            document.documentElement.classList.remove("has-modal");
            if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        },
    };
}
