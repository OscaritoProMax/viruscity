// Vista previa (solo diseño): datos de ejemplo sin red ni token.
// Se activa con ?preview en la URL mientras UI.PREVIEW_ENABLED sea true.

import { createToaster } from "./toast.js";
import { showEndOverlay } from "./end-overlay.js";

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

// ===========================================================================================
// Vista previa del juego: escena de ejemplo + panel de controles para revisar cada pieza del HUD.
// ?preview=infected abre con el jugador local infectado; ?preview=end abre la pantalla de fin.
// No hay movimiento por teclado: solo un balanceo suave para dar vida (sin él en reduced-motion).
// ===========================================================================================

const WOBBLE_PX = 4;

const SAMPLE_TASKS = [
    { id: "t1", label: "Calibrar muestra en el Laboratorio", done: true },
    { id: "t2", label: "Revisar el inventario del Almacén", done: false },
    { id: "t3", label: "Sincronizar la Central de datos", done: false },
];

const SAMPLE_TOASTS = [
    ["Ana entró a la partida", "info"],
    ["Tarea completada: +10 % de cura", "success"],
    ["No se pudo completar la acción (ejemplo)", "danger"],
    ["Has contagiado a alguien (ejemplo)", "infect"],
];

const END_PLAYERS = [
    { username: "Tú", role: "healthy", isMe: true },
    { username: "Ana", role: "healthy", isMe: false },
    { username: "Bruno", role: "infected", isMe: false },
    { username: "Carla", role: "healthy", isMe: false },
    { username: "Diego", role: "healthy", isMe: false },
];

const END_DATA = {
    healthy: { winner: "healthy", reason: "La cura llegó al 100 % antes de que el virus tomara la ciudad.", youWon: true },
    infected: { winner: "infected", reason: "El infectado contagió a la mayoría de la ciudad.", youWon: false },
};

// Pequeño ayudante para crear nodos con clase y texto
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function button(text, onClick, extra = "") {
    const b = el("button", `btn btn--ghost ${extra}`.trim(), text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

export function startGamePreview({ hud, modal, renderer }) {
    const mode = new URLSearchParams(location.search).get("preview");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // ---------- Escena de ejemplo ----------
    const basePlayers = [
        { userId: "p-me", username: "Tú", x: 1200, y: 820 },
        { userId: "p-ana", username: "Ana", x: 860, y: 700 },
        { userId: "p-bruno", username: "Bruno", x: 1380, y: 640, color: "#ff5500", badge: "😀" }, // color y badge de ejemplo
        { userId: "p-carla", username: "Carla", x: 1040, y: 580 },
        { userId: "p-diego", username: "Diego", x: 1420, y: 930 },
        { userId: "p-elena", username: "Elena", x: 640, y: 900 },
    ];
    const scene = {
        world: { width: 2400, height: 1600 },
        playerRadius: 16,
        me: { userId: "p-me" },
        status: mode === "infected" ? "infected" : "healthy",
        players: basePlayers,
    };

    let raf = 0;
    function frame(now) {
        scene.players = basePlayers.map((p, i) => ({
            ...p,
            x: p.x + WOBBLE_PX * Math.sin(now / 700 + i * 1.3),
            y: p.y + WOBBLE_PX * Math.cos(now / 900 + i * 0.7),
        }));
        renderer.draw(scene, now);
        raf = requestAnimationFrame(frame);
    }
    // Anima solo si no hay movimiento reducido; si lo hay, dibuja cuadros sueltos cuando algo cambia
    function syncMotion() {
        cancelAnimationFrame(raf);
        raf = 0;
        if (reduceMotion.matches) {
            scene.players = basePlayers;
            renderer.draw(scene, performance.now());
        } else {
            raf = requestAnimationFrame(frame);
        }
    }
    const redraw = () => { if (!raf) renderer.draw(scene, performance.now()); };
    reduceMotion.addEventListener("change", syncMotion);

    // ---------- HUD inicial ----------
    let cure = 35;
    let tasks = SAMPLE_TASKS.map((t) => ({ ...t }));
    let toastIndex = 0;
    let hintOn = false;
    let cooldownTimer = 0;

    const applyMe = () => {
        hud.setMe({ username: "Tú", status: scene.status });
        redraw();
    };
    applyMe();
    hud.setCure(cure);
    hud.setPlayerCount(basePlayers.length);
    hud.setTasks(tasks);
    hud.setHint(null);
    hud.setInfectCooldown(null);
    hud.setConnection("ok");
    syncMotion();

    // ---------- Panel de controles ----------
    const panel = el("aside", "preview-panel");
    panel.setAttribute("aria-label", "Vista previa, solo diseño");
    const head = el("div", "preview-panel__head");
    const title = el("h2", "panel-title", "VISTA PREVIA · SOLO DISEÑO");
    const collapse = el("button", "preview-panel__toggle");
    collapse.type = "button";
    collapse.setAttribute("aria-controls", "previewPanelBody");
    head.append(title, collapse);

    const body = el("div", "preview-panel__body");
    body.id = "previewPanelBody";
    body.append(el("p", "preview-panel__hint", "Tecla H: mostrar u ocultar este panel."));

    const row = (labelText, ...controls) => {
        const r = el("div", "preview-panel__row");
        if (labelText) r.append(el("span", "panel-title", labelText));
        r.append(...controls);
        return r;
    };

    // Estado propio
    const statusButton = button("", () => {
        scene.status = scene.status === "infected" ? "healthy" : "infected";
        statusButton.textContent = scene.status === "infected" ? "Cambiar a SANO" : "Cambiar a INFECTADO";
        applyMe();
    });
    statusButton.textContent = scene.status === "infected" ? "Cambiar a SANO" : "Cambiar a INFECTADO";

    // Cura
    const cureId = "previewCure";
    const cureLabel = el("label", null, `Cura: ${cure} %`);
    cureLabel.htmlFor = cureId;
    const cureInput = el("input");
    cureInput.type = "range";
    cureInput.id = cureId;
    cureInput.min = "0";
    cureInput.max = "100";
    cureInput.value = String(cure);
    cureInput.addEventListener("input", () => {
        cure = Number(cureInput.value);
        cureLabel.textContent = `Cura: ${cure} %`;
        hud.setCure(cure);
    });

    // Tareas
    const taskButton = button("Completar siguiente tarea", () => {
        const next = tasks.find((t) => !t.done);
        if (next) next.done = true;
        else tasks = SAMPLE_TASKS.map((t) => ({ ...t, done: false }));
        hud.setTasks(tasks);
        taskButton.textContent = tasks.every((t) => t.done) ? "Reiniciar tareas" : "Completar siguiente tarea";
    });

    // Toast que rota los 4 tipos
    const toastButton = button("Toast", () => {
        const [text, kind] = SAMPLE_TOASTS[toastIndex % SAMPLE_TOASTS.length];
        toastIndex += 1;
        hud.toast(text, { kind });
    });

    // Pista
    const hintButton = button("Pista", () => {
        hintOn = !hintOn;
        hud.setHint(hintOn ? "E: interactuar con Laboratorio" : null);
    });

    // Enfriamiento: 20 s de cuenta atrás (0 = oculto)
    const cooldownButton = button("Enfriamiento 20 s", () => {
        clearInterval(cooldownTimer);
        let left = 20;
        hud.setInfectCooldown(left);
        cooldownTimer = setInterval(() => {
            left -= 1;
            if (left <= 0) {
                clearInterval(cooldownTimer);
                hud.setInfectCooldown(null);
            } else {
                hud.setInfectCooldown(left);
            }
        }, 1000);
    });
    const cooldownOff = button("Enfriamiento 0", () => {
        clearInterval(cooldownTimer);
        hud.setInfectCooldown(null);
    });

    // Modal de ejemplo
    const modalButton = button("Modal", () => {
        const content = el("div", "preview-modal");
        content.append(el("p", null, "Ajusta la muestra hasta que la lectura se estabilice. (Contenido de ejemplo.)"));
        const close = el("button", "btn", "Cerrar");
        close.type = "button";
        close.addEventListener("click", () => modal.close());
        content.append(close);
        modal.open({ title: "Calibrar muestra", content });
    });

    // Pantalla de rol
    const roleButton = button("Pantalla de rol", () => {
        hud.showRoleIntro({ status: scene.status }, () => hud.toast("Pantalla de rol cerrada", { kind: "info" }));
    });

    // Pantallas de fin
    let endOverlay = null;
    const openEnd = (side) => {
        endOverlay?.close();
        endOverlay = showEndOverlay(document.body, { ...END_DATA[side], players: END_PLAYERS }, {
            onBack: () => {
                endOverlay.close();
                endOverlay = null;
                hud.toast("En la partida real, aquí se vuelve al lobby", { kind: "info" });
            },
        });
    };
    const endHealthy = button("Fin: ganan sanos", () => openEnd("healthy"));
    const endVirus = button("Fin: gana el virus", () => openEnd("infected"));

    // Conexión
    const connId = "previewConnection";
    const connLabel = el("label", null, "Conexión");
    connLabel.htmlFor = connId;
    const connSelect = el("select");
    connSelect.id = connId;
    for (const [value, text] of [["ok", "Estable"], ["unstable", "Inestable"], ["lost", "Perdida"]]) {
        const option = el("option", null, text);
        option.value = value;
        connSelect.append(option);
    }
    connSelect.addEventListener("change", () => hud.setConnection(connSelect.value));

    const grid = (...nodes) => {
        const g = el("div", "preview-panel__grid");
        g.append(...nodes);
        return g;
    };

    body.append(
        row("Estado propio", statusButton),
        row(null, cureLabel, cureInput),
        row("Tareas", taskButton),
        row("Avisos", grid(toastButton, hintButton, cooldownButton, cooldownOff)),
        row("Ventanas", grid(modalButton, roleButton, endHealthy, endVirus)),
        row(null, connLabel, connSelect),
    );
    panel.append(head, body);
    document.body.append(panel);

    // Plegar / desplegar el cuerpo del panel
    function setOpen(open) {
        collapse.setAttribute("aria-expanded", String(open));
        collapse.setAttribute("aria-label", open ? "Plegar panel de vista previa" : "Desplegar panel de vista previa");
        collapse.textContent = open ? "−" : "+";
        body.hidden = !open;
        panel.classList.toggle("is-collapsed", !open);
    }
    collapse.addEventListener("click", () => setOpen(collapse.getAttribute("aria-expanded") !== "true"));
    setOpen(!window.matchMedia("(max-width: 699.98px)").matches);

    // Tecla H: mostrar u ocultar el panel completo (no mientras se escribe en un campo)
    document.addEventListener("keydown", (event) => {
        if (event.key !== "h" && event.key !== "H") return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.target.closest?.("input, select, textarea, [contenteditable]")) return;
        panel.hidden = !panel.hidden;
    });

    if (mode === "end") openEnd("healthy");

    return {
        stop() {
            cancelAnimationFrame(raf);
            clearInterval(cooldownTimer);
            panel.remove();
        },
    };
}
