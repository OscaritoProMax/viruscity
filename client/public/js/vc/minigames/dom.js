// Utilidades de DOM compartidas por los minijuegos (todo el texto con textContent) y un juego de
// temporizadores que se limpia de una vez al cerrar.

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

export function button(text, className = "vc-mg__btn", ariaLabel) {
    const b = el("button", className, text);
    b.type = "button";
    if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
    return b;
}

// setTimeout / setInterval / requestAnimationFrame registrados para cancelarlos todos en clear()
export function createTimers() {
    const timeouts = new Set();
    const intervals = new Set();
    const frames = new Set();
    return {
        timeout(fn, ms) {
            const id = setTimeout(() => {
                timeouts.delete(id);
                fn();
            }, ms);
            timeouts.add(id);
            return id;
        },
        interval(fn, ms) {
            const id = setInterval(fn, ms);
            intervals.add(id);
            return id;
        },
        frame(fn) {
            const id = requestAnimationFrame((t) => {
                frames.delete(id);
                fn(t);
            });
            frames.add(id);
            return id;
        },
        clear() {
            for (const id of timeouts) clearTimeout(id);
            for (const id of intervals) clearInterval(id);
            for (const id of frames) cancelAnimationFrame(id);
            timeouts.clear();
            intervals.clear();
            frames.clear();
        },
    };
}

// Entero aleatorio en [0, n) con el generador dado
export const randInt = (rng, n) => Math.floor(rng() * n);
