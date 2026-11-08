// Vista previa (solo diseño): datos de ejemplo sin red ni token.
// Se activa con ?preview en la URL mientras UI.PREVIEW_ENABLED sea true.

import { createToaster } from "./toast.js";

const STEP_MS = 1200; // un jugador nuevo cada 1.2 s
const LEAVE_AFTER_MS = 3000; // Bruno sale 3 s después del último ingreso
const RETURN_AFTER_MS = 2000; // y vuelve 2 s después

// Lobby de ejemplo: entran Ana, Bruno, Carla, Diego y Elena; Bruno sale y vuelve; luego se detiene.
export function startLobbyPreview(view) {
    const ME = "Tú";
    const sample = ["Ana", "Bruno", "Carla", "Diego", "Elena"].map((username, i) => ({ userId: `preview-${i + 1}`, username }));
    let players = [{ userId: "preview-0", username: ME }];
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const render = () => view.setPlayers(players, ME);

    view.setStatus("preview", "Vista previa");
    view.setUser(ME);
    view.showNotice("Vista previa del diseño: los datos son de ejemplo, sin conexión ni token.");
    render();

    const toaster = createToaster(document.getElementById("toasts"));
    toaster.show("Bienvenido a la sala de espera (vista previa)", { kind: "info" });

    sample.forEach((player, i) => {
        at(STEP_MS * (i + 1), () => {
            players = [...players, player];
            render();
        });
    });

    const lastJoin = STEP_MS * sample.length;
    const bruno = sample[1];
    at(lastJoin + LEAVE_AFTER_MS, () => {
        players = players.filter((p) => p.userId !== bruno.userId);
        render();
    });
    at(lastJoin + LEAVE_AFTER_MS + RETURN_AFTER_MS, () => {
        players = [...players, bruno];
        render();
    });

    return {
        stop() {
            timers.forEach(clearTimeout);
        },
    };
}
