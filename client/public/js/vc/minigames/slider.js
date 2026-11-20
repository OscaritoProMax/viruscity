// Minijuego "Calibración": un marcador va y viene (≈ 1 s por pasada) sobre una barra con una zona verde
// del 20 % en un lugar al azar. Espacio o "Fijar" lo detienen: hay que acertar 3 veces seguidas
// (un fallo reinicia el conteo).

import { el, button, createTimers } from "./dom.js";

export const PASS_MS = 1000;
export const GREEN_WIDTH = 0.2;
export const HITS_NEEDED = 3;

// ¿pos (0..1) cae dentro de [start, start + width]? (bordes incluidos)
export function isInGreenZone(pos, start, width) {
    if (![pos, start, width].every(Number.isFinite) || width <= 0) return false;
    return pos >= start && pos <= start + width;
}

// Posición del marcador (0..1) tras elapsedMs: va de 0 a 1 en passMs y vuelve en otros passMs
export function markerPosition(elapsedMs, passMs = PASS_MS) {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !(passMs > 0)) return 0;
    const phase = (elapsedMs % (2 * passMs)) / passMs; // 0..2
    return phase <= 1 ? phase : 2 - phase;
}

export const randomGreenStart = (rng = Math.random) => Math.round(rng() * (1 - GREEN_WIDTH) * 1000) / 1000;

export function mount(container, { onSolved, rng = Math.random }) {
    const timers = createTimers();
    const track = el("div", "vc-slider__track");
    const zone = el("div", "vc-slider__zone");
    const marker = el("div", "vc-slider__marker");
    track.append(zone, marker);
    track.setAttribute("aria-hidden", "true");
    const fix = button("Fijar (Espacio)", "vc-mg__btn vc-mg__btn--primary");
    const status = el("p", "vc-mg__status", `Detén el marcador en la zona verde (0/${HITS_NEEDED})`);
    status.setAttribute("aria-live", "polite");
    container.append(track, fix, status);

    let start = randomGreenStart(rng);
    let hits = 0;
    let t0 = performance.now();
    let pos = 0;
    let paused = false;
    let done = false;

    const placeZone = () => {
        zone.style.left = `${start * 100}%`;
        zone.style.width = `${GREEN_WIDTH * 100}%`;
    };
    placeZone();

    function animate(now) {
        if (!paused && !done) {
            pos = markerPosition(now - t0);
            marker.style.left = `${pos * 100}%`;
        }
        if (!done) timers.frame(animate);
    }
    timers.frame(animate);

    function stop() {
        if (paused || done) return;
        paused = true;
        const hit = isInGreenZone(pos, start, GREEN_WIDTH);
        marker.dataset.result = hit ? "hit" : "miss";
        if (hit) {
            hits += 1;
            if (hits >= HITS_NEEDED) {
                done = true;
                status.textContent = "¡Calibrado!";
                fix.disabled = true;
                onSolved();
                return;
            }
            status.textContent = `¡Bien! Aciertos ${hits}/${HITS_NEEDED}`;
        } else {
            hits = 0;
            status.textContent = `Fuera de la zona: vuelve a empezar (0/${HITS_NEEDED})`;
        }
        // Breve pausa para ver el resultado; luego zona nueva y el marcador sigue
        timers.timeout(() => {
            delete marker.dataset.result;
            start = randomGreenStart(rng);
            placeZone();
            t0 = performance.now();
            paused = false;
        }, 500);
    }
    fix.addEventListener("click", stop);

    return {
        focusTarget: fix,
        onKeyDown(event) {
            if (event.code !== "Space") return false;
            event.preventDefault(); // Espacio sobre el botón no debe "hacer clic" además
            if (!event.repeat) stop();
            return true;
        },
        close: () => timers.clear(),
    };
}
