// Minijuego "Cables": 4 cables de colores a la izquierda y sus 4 conectores mezclados a la derecha.
// Clic en un cable y luego en su conector; un par incorrecto se deshace con un destello rojo.

import { el, button, createTimers, randInt } from "./dom.js";

export const WIRES = Object.freeze([
    { id: "rojo", name: "rojo" },
    { id: "amarillo", name: "amarillo" },
    { id: "cian", name: "cian" },
    { id: "verde", name: "verde" },
]);
const FLASH_MS = 450;

export const isCorrectPair = (wireId, connectorId) => typeof wireId === "string" && wireId === connectorId;

// connections: lista de [wireId, connectorId]. Completo cuando están todos los cables, cada uno con su conector.
export function isWiresComplete(connections, total = WIRES.length) {
    if (!Array.isArray(connections) || connections.length !== total) return false;
    const wires = new Set();
    for (const pair of connections) {
        if (!Array.isArray(pair) || !isCorrectPair(pair[0], pair[1]) || wires.has(pair[0])) return false;
        wires.add(pair[0]);
    }
    return true;
}

// Orden de los conectores: mezclado y nunca idéntico al de los cables
export function shuffledConnectors(rng = Math.random) {
    const ids = WIRES.map((w) => w.id);
    for (let attempt = 0; attempt < 10; attempt++) {
        const order = [...ids];
        for (let i = order.length - 1; i > 0; i--) {
            const j = randInt(rng, i + 1);
            [order[i], order[j]] = [order[j], order[i]];
        }
        if (order.some((id, i) => id !== ids[i])) return order;
    }
    return [...ids.slice(1), ids[0]];
}

export function mount(container, { onSolved, rng = Math.random }) {
    const timers = createTimers();
    const board = el("div", "vc-wires");
    const left = el("div", "vc-wires__col");
    const right = el("div", "vc-wires__col");
    const status = el("p", "vc-mg__status", "Elige un cable y luego su conector");
    status.setAttribute("aria-live", "polite");
    board.append(left, right);
    container.append(board, status);

    const connections = [];
    let selected = null;
    let done = false;

    const wireButtons = new Map();
    for (const w of WIRES) {
        const b = button("", "vc-wires__wire", `Cable ${w.name}`);
        b.dataset.color = w.id;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => selectWire(w.id));
        wireButtons.set(w.id, b);
        left.append(b);
    }
    const connectorButtons = new Map();
    for (const id of shuffledConnectors(rng)) {
        const w = WIRES.find((x) => x.id === id);
        const b = button("", "vc-wires__plug", `Conector ${w.name}`);
        b.dataset.color = id;
        b.addEventListener("click", () => connect(id));
        connectorButtons.set(id, b);
        right.append(b);
    }

    function selectWire(id) {
        if (done || connections.some(([w]) => w === id)) return;
        selected = id;
        for (const [wid, b] of wireButtons) b.setAttribute("aria-pressed", String(wid === id));
        status.textContent = `Cable ${id}: ahora su conector`;
    }

    function connect(connectorId) {
        if (done || selected === null || connections.some(([, c]) => c === connectorId)) return;
        const wire = selected;
        selected = null;
        wireButtons.get(wire).setAttribute("aria-pressed", "false");
        if (!isCorrectPair(wire, connectorId)) {
            const plug = connectorButtons.get(connectorId);
            const cable = wireButtons.get(wire);
            plug.dataset.wrong = "true";
            cable.dataset.wrong = "true";
            status.textContent = "Ese no es su conector";
            timers.timeout(() => {
                delete plug.dataset.wrong;
                delete cable.dataset.wrong;
            }, FLASH_MS);
            return;
        }
        connections.push([wire, connectorId]);
        for (const b of [wireButtons.get(wire), connectorButtons.get(connectorId)]) {
            b.dataset.done = "true";
            b.disabled = true;
        }
        if (isWiresComplete(connections)) {
            done = true;
            status.textContent = "¡Todos los cables conectados!";
            onSolved();
        } else {
            status.textContent = `Conectados ${connections.length}/${WIRES.length}`;
        }
    }

    return { focusTarget: wireButtons.get(WIRES[0].id), close: () => timers.clear() };
}
