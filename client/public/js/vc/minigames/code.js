// Minijuego "Código": se muestra un código de 6 caracteres durante 4 s, se oculta y el jugador lo escribe
// de memoria (sin distinguir mayúsculas) y confirma con Enter o con el botón. Un error da otro código.

import { el, button, createTimers, randInt } from "./dom.js";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I (se confunden)
export const CODE_LENGTH = 6;
export const SHOW_MS = 4000;
const RETRY_MS = 1200;

// Para comparar: sin espacios y en mayúsculas
export function normalizeCode(str) {
    return String(str ?? "").replace(/\s+/g, "").toUpperCase();
}

export function isCodeCorrect(expected, given) {
    return typeof expected === "string" && expected.length > 0 && normalizeCode(given) === normalizeCode(expected);
}

export function randomCode(rng = Math.random, length = CODE_LENGTH) {
    let code = "";
    for (let i = 0; i < length; i++) code += CODE_ALPHABET[randInt(rng, CODE_ALPHABET.length)];
    return code;
}

export function mount(container, { onSolved, rng = Math.random }) {
    const timers = createTimers();
    const display = el("p", "vc-code__display", "");
    const form = el("form", "vc-code__form");
    const label = el("label", "vc-code__label", "Escribe el código");
    const input = el("input", "vc-code__input");
    input.id = `vc-code-${Math.floor(rng() * 1e9)}`;
    label.htmlFor = input.id;
    input.type = "text";
    input.maxLength = CODE_LENGTH;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "characters");
    const submit = button("Confirmar", "vc-mg__btn vc-mg__btn--primary");
    submit.type = "submit";
    form.append(label, input, submit);
    const status = el("p", "vc-mg__status", "");
    status.setAttribute("aria-live", "polite");
    container.append(display, form, status);

    let code = "";
    let done = false;

    function show() {
        code = randomCode(rng);
        input.value = "";
        input.disabled = true;
        submit.disabled = true;
        display.textContent = code;
        display.dataset.hidden = "false";
        status.textContent = "Memoriza el código (4 s)";
        timers.timeout(() => {
            display.textContent = "• • • • • •";
            display.dataset.hidden = "true";
            input.disabled = false;
            submit.disabled = false;
            status.textContent = "Escríbelo de memoria y pulsa Enter";
            input.focus();
        }, SHOW_MS);
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (done || input.disabled) return;
        if (isCodeCorrect(code, input.value)) {
            done = true;
            input.disabled = true;
            submit.disabled = true;
            status.textContent = "¡Código correcto!";
            onSolved();
        } else {
            input.disabled = true;
            submit.disabled = true;
            status.textContent = "Código incorrecto: aquí va otro";
            timers.timeout(show, RETRY_MS);
        }
    });

    show();
    return { focusTarget: input, close: () => timers.clear() };
}
