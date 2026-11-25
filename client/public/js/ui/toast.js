// Avisos breves (toasts) apilados. Solo presentación: el texto siempre va con textContent.
//
// createToaster(container) → { show(text, { kind, ms }) }
//   kind: "info" (cian), "success" (dorado), "danger" (rojo), "infect" (verde)
//   Máximo 3 visibles: si llega un cuarto, el más viejo sale.

import { UI } from "./ui-config.js";

const MAX_VISIBLE = 3;
const KINDS = new Set(["info", "success", "danger", "infect"]);
const LEAVE_FALLBACK_MS = 600; // por si no llega transitionend (p. ej. pestaña oculta)

export function createToaster(container) {
    container.classList.add("toasts");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-relevant", "additions");

    const active = []; // toasts visibles, del más viejo al más nuevo

    function show(text, { kind = "info", ms = UI.TOAST_MS } = {}) {
        const toast = document.createElement("div");
        toast.className = `toast toast--${KINDS.has(kind) ? kind : "info"}`;

        const message = document.createElement("p");
        message.className = "toast__text";
        message.textContent = text;

        const close = document.createElement("button");
        close.type = "button";
        close.className = "toast__close";
        close.setAttribute("aria-label", "Cerrar aviso");
        close.textContent = "✕";

        toast.append(message, close);
        container.append(toast);

        let timer = 0;
        let gone = false;

        function dismiss() {
            if (gone) return;
            gone = true;
            clearTimeout(timer);
            active.splice(active.indexOf(handle), 1);
            toast.classList.remove("is-visible");
            toast.classList.add("is-leaving");
            const remove = () => toast.remove();
            toast.addEventListener("transitionend", remove, { once: true });
            setTimeout(remove, LEAVE_FALLBACK_MS);
        }

        const handle = { dismiss };
        active.push(handle);
        while (active.length > MAX_VISIBLE) active[0].dismiss();

        close.addEventListener("click", dismiss);
        if (ms > 0) timer = setTimeout(dismiss, ms);

        // Un cuadro después para que la transición de entrada se vea
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("is-visible")));
        return handle;
    }

    return { show };
}
