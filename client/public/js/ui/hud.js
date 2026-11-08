// HUD del juego (solo presentación): recibe datos por parámetros, no conoce la red.
//
// createHud(root) → {
//   setMe({ username, status }), setCure(pct), setPlayerCount(n), setTasks([{ id, label, done }]),
//   setHint(text | null), setInfectCooldown(seconds | null), setConnection("ok" | "unstable" | "lost"),
//   showRoleIntro({ status, ms }, onDone), toast(text, opts)
// }
// Todo el texto va con textContent. status es solo el del jugador local.

import { createAvatar } from "./avatar.js";
import { createToaster } from "./toast.js";

const MOBILE_QUERY = "(max-width: 699.98px)";
const ROLE_INTRO_MS = 4000;

const ROLE_TEXT = {
    healthy: {
        title: "ESTÁS SANO",
        lines: ["Completa tareas para fabricar la cura.", "Descubre quién es el infectado."],
    },
    infected: {
        title: "ESTÁS INFECTADO",
        lines: ["Contagia a los demás sin que te descubran.", "Evita que la cura se complete."],
    },
};

// Crea un elemento con clase y, opcionalmente, texto
function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

export function createHud(root) {
    root.classList.add("hud");
    const state = { status: null, cooldown: null };

    // ---------- Arriba: tarjeta propia, barra de cura y contador ----------
    const top = make("div", "hud-top");

    const meBox = make("section", "hud-box hud-me");
    meBox.setAttribute("aria-label", "Tu jugador");
    const meAvatar = make("span", "hud-me__avatar");
    const meInfo = make("div", "hud-me__info");
    const meName = make("span", "hud-me__name");
    const meRow = make("div", "hud-me__row");
    const statusChip = make("span", "chip hud-status");
    const cooldown = make("span", "hud-cooldown");
    cooldown.hidden = true;
    meRow.append(statusChip, cooldown);
    meInfo.append(meName, meRow);
    meBox.append(meAvatar, meInfo);

    const cureBox = make("section", "hud-box hud-cure");
    const cureHead = make("div", "hud-cure__head");
    const cureLabel = make("span", "panel-title", "CURA");
    cureLabel.id = "hudCureLabel";
    const curePct = make("span", "hud-cure__pct", "0 %");
    cureHead.append(cureLabel, curePct);
    const cureBar = make("div", "progress hud-cure__bar");
    cureBar.setAttribute("role", "progressbar");
    cureBar.setAttribute("aria-labelledby", "hudCureLabel");
    cureBar.setAttribute("aria-valuemin", "0");
    cureBar.setAttribute("aria-valuemax", "100");
    cureBar.setAttribute("aria-valuenow", "0");
    const cureFill = make("div", "progress__fill");
    cureBar.append(cureFill);
    cureBox.append(cureHead, cureBar);

    const countBox = make("section", "hud-box hud-count", "Jugadores: 0");
    countBox.setAttribute("aria-live", "polite");

    top.append(meBox, cureBox, countBox);

    // ---------- Banda de conexión ----------
    const connection = make("div", "hud-conn");
    connection.setAttribute("aria-live", "assertive");
    connection.hidden = true;

    // ---------- Abajo: tareas y pista ----------
    const tasksBox = make("section", "hud-box hud-tasks");
    tasksBox.setAttribute("aria-labelledby", "hudTasksTitle");
    const tasksHead = make("div", "hud-tasks__head");
    const tasksTitle = make("h2", "panel-title", "Tareas");
    tasksTitle.id = "hudTasksTitle";
    const tasksProgress = make("span", "hud-tasks__progress", "0/0");
    const tasksToggle = make("button", "hud-tasks__toggle");
    tasksToggle.type = "button";
    tasksToggle.setAttribute("aria-controls", "hudTaskList");
    const taskList = make("ul", "hud-tasks__list");
    taskList.id = "hudTaskList";
    tasksHead.append(tasksTitle, tasksProgress, tasksToggle);
    tasksBox.append(tasksHead, taskList);

    const hint = make("div", "hud-hint");
    hint.setAttribute("aria-live", "polite");
    hint.hidden = true;

    const vignette = make("div", "hud-vignette");
    vignette.setAttribute("aria-hidden", "true");

    // La banda de conexión va justo antes de la barra superior (game.css la baja cuando se ve)
    root.append(vignette, connection, top, tasksBox, hint);

    // Avisos: usa #toasts si la página lo trae; si no, crea su propio contenedor
    let toastBox = document.getElementById("toasts");
    if (!toastBox) {
        toastBox = make("div");
        root.append(toastBox);
    }
    const toaster = createToaster(toastBox);

    // ---------- Panel de tareas plegable (plegado por defecto en pantallas angostas) ----------
    function setTasksOpen(open) {
        tasksToggle.setAttribute("aria-expanded", String(open));
        tasksToggle.setAttribute("aria-label", open ? "Ocultar tareas" : "Mostrar tareas");
        tasksToggle.textContent = open ? "−" : "+";
        taskList.hidden = !open;
        tasksBox.classList.toggle("is-collapsed", !open);
    }
    tasksToggle.addEventListener("click", () => setTasksOpen(tasksToggle.getAttribute("aria-expanded") !== "true"));
    setTasksOpen(!window.matchMedia(MOBILE_QUERY).matches);

    // ---------- API ----------
    function renderCooldown() {
        const show = state.status === "infected" && typeof state.cooldown === "number";
        cooldown.hidden = !show;
        if (!show) return;
        const seconds = Math.max(0, Math.ceil(state.cooldown));
        cooldown.textContent = seconds > 0 ? `⏳ ${seconds} s` : "Infección lista";
        cooldown.setAttribute("aria-label", seconds > 0 ? `Puedes infectar en ${seconds} segundos` : "Infección lista");
        cooldown.classList.toggle("is-ready", seconds === 0);
    }

    function setMe({ username, status }) {
        meName.textContent = username ?? "";
        meAvatar.replaceChildren(createAvatar(username ?? "", username ?? "", 36));
        state.status = status === "infected" ? "infected" : status === "healthy" ? "healthy" : null;
        statusChip.hidden = state.status === null;
        statusChip.textContent = state.status === "infected" ? "INFECTADO" : "SANO";
        statusChip.classList.toggle("hud-status--infected", state.status === "infected");
        statusChip.classList.toggle("hud-status--healthy", state.status === "healthy");
        root.classList.toggle("is-infected", state.status === "infected");
        renderCooldown();
    }

    function setCure(pct) {
        const value = Math.round(Math.min(100, Math.max(0, Number(pct) || 0)));
        cureFill.style.width = `${value}%`; // único estilo dinámico: el ancho de la barra
        curePct.textContent = `${value} %`;
        cureBar.setAttribute("aria-valuenow", String(value));
        cureBar.setAttribute("aria-valuetext", `${value} por ciento`);
    }

    function setPlayerCount(n) {
        countBox.textContent = `Jugadores: ${n}`;
    }

    function setTasks(tasks) {
        const items = tasks.map((task) => {
            const li = make("li", `hud-task${task.done ? " is-done" : ""}`);
            const mark = make("span", "hud-task__mark", task.done ? "✔" : "○");
            mark.setAttribute("aria-hidden", "true");
            const label = make("span", "hud-task__label", task.label);
            const sr = make("span", "sr-only", task.done ? " (hecha)" : " (pendiente)");
            li.append(mark, label, sr);
            return li;
        });
        taskList.replaceChildren(...items);
        tasksProgress.textContent = `${tasks.filter((t) => t.done).length}/${tasks.length}`;
    }

    function setHint(text) {
        hint.textContent = text ?? "";
        hint.hidden = !text;
    }

    function setInfectCooldown(seconds) {
        state.cooldown = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : null;
        renderCooldown();
    }

    function setConnection(kind) {
        connection.classList.remove("hud-conn--unstable", "hud-conn--lost");
        if (kind === "unstable") {
            connection.textContent = "Conexión inestable…";
            connection.classList.add("hud-conn--unstable");
            connection.hidden = false;
        } else if (kind === "lost") {
            connection.textContent = "Conexión perdida";
            connection.classList.add("hud-conn--lost");
            connection.hidden = false;
        } else {
            connection.textContent = "";
            connection.hidden = true;
        }
    }

    // Pantalla de rol: cubre el juego; se cierra sola, con una tecla o con un clic
    let closeRoleIntro = null;
    function showRoleIntro({ status, ms = ROLE_INTRO_MS } = {}, onDone) {
        closeRoleIntro?.();
        const text = ROLE_TEXT[status === "infected" ? "infected" : "healthy"];
        const previousFocus = document.activeElement;

        const overlay = make("div", `role-intro role-intro--${status === "infected" ? "infected" : "healthy"}`);
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "roleIntroTitle");
        overlay.tabIndex = -1;
        const title = make("h2", "role-intro__title", text.title);
        title.id = "roleIntroTitle";
        const body = make("div", "role-intro__text");
        for (const line of text.lines) body.append(make("p", null, line));
        const skip = make("p", "role-intro__skip", "Pulsa cualquier tecla o haz clic para continuar");
        overlay.append(title, body, skip);
        document.body.append(overlay);
        overlay.focus();

        let done = false;
        const timer = setTimeout(finish, ms);
        function onKey(event) {
            event.preventDefault();
            event.stopPropagation(); // la tecla solo cierra la pantalla de rol
            finish();
        }
        function finish() {
            if (done) return;
            done = true;
            clearTimeout(timer);
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
            closeRoleIntro = null;
            if (previousFocus && previousFocus.isConnected) previousFocus.focus();
            onDone?.();
        }
        document.addEventListener("keydown", onKey, true);
        overlay.addEventListener("click", finish);
        closeRoleIntro = finish;
    }

    function toast(text, opts) {
        return toaster.show(text, opts);
    }

    return { setMe, setCure, setPlayerCount, setTasks, setHint, setInfectCooldown, setConnection, showRoleIntro, toast };
}
