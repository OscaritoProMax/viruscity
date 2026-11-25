// Ventana modal accesible. Solo presentación.
//
// createModal() → { open({ title, content, onClose, dismissible }), close() }
// - role="dialog", aria-modal y aria-labelledby con el título.
// - Atrapa el foco (Tab y Mayús+Tab ciclan dentro) y lo devuelve al elemento previo al cerrar.
// - Esc, el botón ✕ y el clic en el fondo cierran solo si dismissible.
// - Bloquea el scroll de la página mientras está abierta. Solo puede haber un modal a la vez.

const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

let current = null; // modal abierto en toda la página
let titleCounter = 0;

export function createModal() {
    let backdrop = null;
    let box = null;
    let previousFocus = null;
    let options = null;

    const focusables = () => [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

    function onKeydown(event) {
        if (event.key === "Escape" && options.dismissible) {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== "Tab") return;

        const items = focusables();
        if (items.length === 0) {
            event.preventDefault();
            box.focus();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === box)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function open({ title, content, onClose, dismissible = true }) {
        if (current) current.close(); // un solo modal a la vez
        options = { onClose, dismissible };
        previousFocus = document.activeElement;

        const titleId = `modalTitle${++titleCounter}`;

        backdrop = document.createElement("div");
        backdrop.className = "modal";

        box = document.createElement("div");
        box.className = "modal__box";
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-labelledby", titleId);
        box.tabIndex = -1;

        const header = document.createElement("div");
        header.className = "modal__header";
        const heading = document.createElement("h2");
        heading.className = "modal__title panel-title";
        heading.id = titleId;
        heading.textContent = title;
        header.append(heading);

        if (dismissible) {
            const closeButton = document.createElement("button");
            closeButton.type = "button";
            closeButton.className = "modal__close";
            closeButton.setAttribute("aria-label", "Cerrar");
            closeButton.textContent = "✕";
            closeButton.addEventListener("click", close);
            header.append(closeButton);
            backdrop.addEventListener("click", (event) => {
                if (event.target === backdrop) close();
            });
        }

        const body = document.createElement("div");
        body.className = "modal__body";
        if (content) body.append(content);

        box.append(header, body);
        backdrop.append(box);
        backdrop.addEventListener("keydown", onKeydown);
        document.body.append(backdrop);
        document.documentElement.classList.add("has-modal"); // bloquea el scroll de la página

        current = api;
        // Foco al primer elemento interactivo del contenido (o a la caja si no hay)
        const items = focusables();
        const firstInContent = items.find((el) => !el.classList.contains("modal__close"));
        (firstInContent ?? items[0] ?? box).focus();
    }

    function close() {
        if (!backdrop) return;
        backdrop.remove();
        backdrop = null;
        box = null;
        document.documentElement.classList.remove("has-modal");
        if (current === api) current = null;
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        const { onClose } = options;
        options = null;
        onClose?.();
    }

    const api = { open, close };
    return api;
}
