// Minijuego "Mantener": mantener pulsada la tecla E (o el botón "Mantener") 10 s seguidos, con una barra de
// progreso. Al soltar se reinicia. Una pulsación que venía de antes de abrirse (repetición) no cuenta.

import { el, button, createTimers } from "./dom.js";

export const HOLD_MS = 10000;

// Progreso 0..1 de una pulsación que empezó en pressedSinceMs (null = no está pulsado)
export function holdProgress(pressedSinceMs, nowMs, requiredMs = HOLD_MS) {
    if (pressedSinceMs === null || pressedSinceMs === undefined || !Number.isFinite(pressedSinceMs) || !Number.isFinite(nowMs) || !(requiredMs > 0)) return 0;
    return Math.min(1, Math.max(0, (nowMs - pressedSinceMs) / requiredMs));
}

export function mount(container, { onSolved }) {
    const timers = createTimers();
    const bar = el("div", "vc-hold__bar");
    const fill = el("div", "vc-hold__fill");
    bar.append(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Progreso");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    const hold = button("Mantener (E)", "vc-mg__btn vc-mg__btn--primary vc-hold__btn");
    const status = el("p", "vc-mg__status", "Mantén pulsado 10 s sin soltar");
    status.setAttribute("aria-live", "polite");
    container.append(bar, hold, status);

    let since = null;
    let done = false;
    let lastPct = -1;

    function render(progress) {
        const pct = Math.round(progress * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        fill.style.width = `${pct}%`;
        bar.setAttribute("aria-valuenow", String(pct));
    }

    function tick(now) {
        if (since === null || done) return;
        const progress = holdProgress(since, now);
        render(progress);
        if (progress >= 1) {
            done = true;
            since = null;
            hold.disabled = true;
            status.textContent = "¡Completado!";
            onSolved();
            return;
        }
        timers.frame(tick);
    }

    function press() {
        if (done || since !== null) return;
        since = performance.now();
        hold.dataset.active = "true";
        status.textContent = "Sigue pulsando…";
        timers.frame(tick);
    }

    function release() {
        if (done || since === null) return;
        since = null;
        delete hold.dataset.active;
        render(0);
        status.textContent = "Se soltó: vuelve a empezar";
    }

    hold.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        hold.setPointerCapture?.(event.pointerId);
        press();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) hold.addEventListener(type, release);
    window.addEventListener("blur", release);

    return {
        focusTarget: hold,
        onKeyDown(event) {
            if (event.code !== "KeyE" && event.code !== "Space" && event.code !== "Enter") return false;
            event.preventDefault();
            if (!event.repeat) press();
            return true;
        },
        onKeyUp(event) {
            if (event.code !== "KeyE" && event.code !== "Space" && event.code !== "Enter") return false;
            release();
            return true;
        },
        close() {
            timers.clear();
            window.removeEventListener("blur", release);
        },
    };
}
