// Minijuego "Secuencia": se iluminan 5 símbolos de a uno (cada 600 ms) y el jugador los repite con 4 botones
// grandes (o las teclas 1-4). Un error muestra "Secuencia incorrecta" y empieza otra secuencia nueva.

import { el, button, createTimers, randInt } from "./dom.js";

export const SYMBOLS = Object.freeze([
    { char: "▲", name: "Triángulo" },
    { char: "●", name: "Círculo" },
    { char: "■", name: "Cuadrado" },
    { char: "◆", name: "Rombo" },
]);
export const SEQUENCE_LENGTH = 5;
export const STEP_MS = 600;
const LIT_MS = 450; // dentro de cada paso: encendido y una pausa breve para distinguir repeticiones
const RETRY_MS = 1000;

// expected y given: listas de índices. "complete" si son iguales, "progress" si given es un prefijo
// correcto (incluida la lista vacía) y "error" en cualquier otro caso.
export function checkSequence(expected, given) {
    if (!Array.isArray(expected) || !Array.isArray(given) || expected.length === 0) return "error";
    if (given.length > expected.length) return "error";
    for (let i = 0; i < given.length; i++) if (given[i] !== expected[i]) return "error";
    return given.length === expected.length ? "complete" : "progress";
}

export function randomSequence(rng = Math.random, length = SEQUENCE_LENGTH) {
    return Array.from({ length }, () => randInt(rng, SYMBOLS.length));
}

export function mount(container, { onSolved, rng = Math.random }) {
    const timers = createTimers();
    const status = el("p", "vc-mg__status", "");
    status.setAttribute("aria-live", "polite");
    const display = el("div", "vc-seq__display", "");
    display.setAttribute("aria-hidden", "true");
    const pad = el("div", "vc-seq__pad");
    const buttons = SYMBOLS.map((s, i) => {
        const b = button(s.char, "vc-seq__btn", `${s.name} (tecla ${i + 1})`);
        b.addEventListener("click", () => press(i));
        pad.append(b);
        return b;
    });
    container.append(display, pad, status);

    let expected = [];
    let given = [];
    let accepting = false;
    let done = false;

    const setButtons = (enabled) => buttons.forEach((b) => (b.disabled = !enabled));

    function round() {
        expected = randomSequence(rng);
        given = [];
        accepting = false;
        setButtons(false);
        status.textContent = "Observa la secuencia…";
        expected.forEach((symbol, step) => {
            timers.timeout(() => {
                display.textContent = SYMBOLS[symbol].char;
                buttons[symbol].dataset.lit = "true";
            }, step * STEP_MS);
            timers.timeout(() => {
                display.textContent = "";
                delete buttons[symbol].dataset.lit;
            }, step * STEP_MS + LIT_MS);
        });
        timers.timeout(() => {
            accepting = true;
            setButtons(true);
            status.textContent = `Repite la secuencia (0/${SEQUENCE_LENGTH})`;
            buttons[0].focus();
        }, expected.length * STEP_MS);
    }

    function press(i) {
        if (!accepting || done) return;
        given.push(i);
        const result = checkSequence(expected, given);
        if (result === "error") {
            accepting = false;
            setButtons(false);
            status.textContent = "Secuencia incorrecta";
            timers.timeout(round, RETRY_MS);
        } else if (result === "complete") {
            done = true;
            setButtons(false);
            status.textContent = "¡Secuencia correcta!";
            onSolved();
        } else {
            status.textContent = `Repite la secuencia (${given.length}/${SEQUENCE_LENGTH})`;
        }
    }

    round();
    return {
        focusTarget: buttons[0],
        onKeyDown(event) {
            const n = Number(event.key);
            if (event.repeat || !Number.isInteger(n) || n < 1 || n > SYMBOLS.length) return false;
            press(n - 1);
            return true;
        },
        close: () => timers.clear(),
    };
}
