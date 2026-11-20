// Modal de los minijuegos de Viruscity (decisión 11: el cliente resuelve el minijuego y el servidor valida
// el tiempo y la posición). Accesible: role="dialog", aria-modal, foco atrapado, Esc cancela.
//
// openMinigame(kind, container, { title, onSolved, onCancel, rng }) → { close(), setInfo(text), isSolved() }
//   kind: sequence | code | wires | slider | hold (otro valor → hold)
//   onSolved() se llama una sola vez; onCancel() con Esc o con el botón "Cancelar".
// Cada minijuego exporta mount(container, { onSolved, rng }) → { close(), focusTarget?, onKeyDown?, onKeyUp? }.

import { el, button } from "./dom.js";
import * as sequence from "./sequence.js";
import * as code from "./code.js";
import * as wires from "./wires.js";
import * as slider from "./slider.js";
import * as hold from "./hold.js";

export const MINIGAMES = Object.freeze({
    sequence: { name: "Secuencia", module: sequence },
    code: { name: "Código", module: code },
    wires: { name: "Cables", module: wires },
    slider: { name: "Calibración", module: slider },
    hold: { name: "Mantener", module: hold },
});

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
let counter = 0;

export function openMinigame(kind, container, { title = "Misión", onSolved = () => {}, onCancel = () => {}, rng = Math.random } = {}) {
    const game = MINIGAMES[kind] ?? MINIGAMES.hold;
    const previousFocus = document.activeElement;
    const id = `vcMg${++counter}`;

    const overlay = el("div", "vc-mg");
    const card = el("div", "vc-mg__card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", `${id}Title`);
    card.tabIndex = -1;
    card.dataset.kind = kind;
    const kicker = el("p", "vc-mg__kicker", `Misión · ${game.name}`);
    const heading = el("h2", "vc-mg__title", title);
    heading.id = `${id}Title`;
    const info = el("p", "vc-mg__info", "");
    const body = el("div", "vc-mg__body");
    const cancel = button("Cancelar (Esc)", "vc-mg__btn vc-mg__cancel");
    card.append(kicker, heading, info, body, cancel);
    overlay.append(card);
    container.append(overlay);

    let solved = false;
    let closed = false;
    const instance = game.module.mount(body, {
        rng,
        onSolved() {
            if (solved || closed) return;
            solved = true;
            card.dataset.solved = "true";
            onSolved();
        },
    });

    function doCancel() {
        if (closed) return;
        onCancel();
    }
    cancel.addEventListener("click", doCancel);

    // Teclado: Esc cancela, Tab no sale del modal y el resto va al minijuego. Nada sale del modal
    // (stopPropagation): el juego no recibe movimiento ni las teclas E/F/Q mientras está abierto.
    function onKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            doCancel();
        } else if (event.key === "Tab") {
            const items = [...card.querySelectorAll(FOCUSABLE)];
            if (items.length === 0) {
                event.preventDefault();
                card.focus();
            } else {
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        } else if (!solved) {
            instance.onKeyDown?.(event);
        }
        event.stopPropagation();
    }
    function onKeyUp(event) {
        if (!solved) instance.onKeyUp?.(event);
        event.stopPropagation();
    }
    card.addEventListener("keydown", onKeyDown);
    card.addEventListener("keyup", onKeyUp);
    // Un clic fuera de la tarjeta no la cierra: devuelve el foco al modal
    overlay.addEventListener("pointerdown", (event) => {
        if (event.target === overlay) {
            event.preventDefault();
            card.focus();
        }
    });
    // Si el foco se escapa (por ejemplo, al hacer clic en la página), vuelve al modal
    function onFocusIn(event) {
        if (!closed && !card.contains(event.target)) card.focus();
    }
    document.addEventListener("focusin", onFocusIn);

    // Foco inicial: el control del minijuego, o la tarjeta si aún está deshabilitado (la secuencia o el código
    // se están mostrando). Así Esc y el teclado del minijuego funcionan desde el primer momento.
    instance.focusTarget?.focus({ preventScroll: true });
    if (!card.contains(document.activeElement)) card.focus({ preventScroll: true });

    return {
        setInfo(text) {
            if (info.textContent !== text) info.textContent = text;
        },
        isSolved: () => solved,
        close() {
            if (closed) return;
            closed = true;
            instance.close();
            document.removeEventListener("focusin", onFocusIn);
            overlay.remove();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
            else document.activeElement?.blur?.();
        },
    };
}
