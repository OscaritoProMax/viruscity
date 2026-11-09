// Caja de diálogo con vecinos y carteles (de la referencia virus_city_map.html).
// Es LOCAL: cada jugador conversa en su pantalla; no viaja por la red ni cambia el juego.
//
// createDialogue({ onBlip }) → { open(speaker, lines), advance() → true si se cerró, close(), isOpen(), tick(dt) }
// Todo el texto va con textContent.

const $ = (id) => document.getElementById(id);
const CHARS_PER_SECOND = 55;

export function createDialogue({ onBlip } = {}) {
    const box = $("dialogue");
    const speakerEl = $("dlgSpeaker");
    const textEl = $("dlgText");
    const hintEl = $("dlgHint");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let state = null; // { lines, idx, shown }

    function render() {
        if (!state) return;
        const full = state.lines[state.idx];
        textEl.textContent = full.slice(0, Math.floor(state.shown));
        const done = state.shown >= full.length;
        hintEl.textContent = done ? (state.idx < state.lines.length - 1 ? "E ▸ siguiente" : "E ▸ cerrar") : "";
    }

    function open(speaker, lines) {
        const list = (Array.isArray(lines) ? lines : [lines]).map(String).filter(Boolean);
        if (list.length === 0) return;
        state = { lines: list, idx: 0, shown: reducedMotion.matches ? list[0].length : 0 };
        speakerEl.textContent = speaker || "Virus City";
        box.hidden = false;
        render();
        onBlip?.();
    }

    function close() {
        state = null;
        box.hidden = true;
    }

    // Completa la línea, pasa a la siguiente o cierra. Devuelve true si se cerró.
    function advance() {
        if (!state) return true;
        const full = state.lines[state.idx];
        if (state.shown < full.length) {
            state.shown = full.length;
            render();
            return false;
        }
        if (state.idx < state.lines.length - 1) {
            state.idx++;
            state.shown = reducedMotion.matches ? state.lines[state.idx].length : 0;
            render();
            onBlip?.();
            return false;
        }
        close();
        return true;
    }

    // Efecto de máquina de escribir
    function tick(dt) {
        if (!state) return;
        const full = state.lines[state.idx];
        if (state.shown >= full.length) return;
        state.shown = Math.min(full.length, state.shown + dt * CHARS_PER_SECOND);
        render();
    }

    return { open, advance, close, isOpen: () => state !== null, tick };
}
