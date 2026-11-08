// Comportamiento visual de la pantalla de login (solo presentación).
// La lógica de autenticación sigue en login.js (script clásico): fetch, localStorage,
// mensajes de respuesta y aviso de sesión. Este módulo solo agrega:
//   1) pestañas accesibles (clic, ←/→, Inicio/Fin, hash #registro)
//   2) mostrar/ocultar contraseña
//   3) partículas del hero cuando el canvas es visible
//   4) tras un registro exitoso (evento "viruscity:registered"), pasa a "Iniciar sesión"
//   5) el aviso de sessionStorage "sessionMessage" ya lo muestra y borra login.js en #sessionBanner,
//      así que aquí no se lee ni se toca (solo tiene estilo en login.css).
//   6) el virus animado del hero (rebota y salta con clic, toque, Enter o Espacio)

import { UI } from "./ui/ui-config.js";
import { startParticles } from "./ui/particles.js";
import { startBouncingVirus } from "./ui/bouncing-virus.js";

const $ = (id) => document.getElementById(id);

const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
const panelOf = (tab) => $(tab.getAttribute("aria-controls"));
const REGISTER_HASH = "#registro";

// ---------- Textos de ayuda (desde la configuración visual) ----------
$("registerUsernameHint").textContent =
    `${UI.USERNAME_MIN} a ${UI.USERNAME_MAX} caracteres: letras, números o guion bajo`;
$("registerPasswordHint").textContent = `${UI.PASSWORD_MIN} a ${UI.PASSWORD_MAX} caracteres`;

// ---------- Mostrar / ocultar contraseña ----------
const toggles = [...document.querySelectorAll(".field__toggle")];

function setPasswordVisible(button, visible) {
    const input = $(button.getAttribute("aria-controls"));
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
}

for (const button of toggles) {
    button.addEventListener("click", () => {
        setPasswordVisible(button, button.getAttribute("aria-pressed") !== "true");
    });
}

// ---------- Pestañas ----------

// Vacía los mensajes de ambos formularios (mismos elementos que usa login.js)
function clearMessages() {
    for (const message of document.querySelectorAll(".auth .msg")) {
        message.textContent = "";
        message.className = "msg";
    }
}

// Activa una pestaña. focus: "field" (primer campo del panel), "tab" (la pestaña) o "none".
function selectTab(tab, { focus = "field" } = {}) {
    const changed = tab.getAttribute("aria-selected") !== "true";

    for (const t of tabs) {
        const active = t === tab;
        t.setAttribute("aria-selected", String(active));
        t.tabIndex = active ? 0 : -1; // roving tabindex: solo la pestaña activa entra en el orden de Tab
        panelOf(t).hidden = !active;
    }

    if (changed) {
        clearMessages();
        for (const button of toggles) setPasswordVisible(button, false); // nunca dejar contraseñas a la vista
        const hash = tab.id === "tabRegister" ? REGISTER_HASH : "";
        history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    }

    if (focus === "field") panelOf(tab).querySelector("input")?.focus();
    else if (focus === "tab") tab.focus();
}

for (const tab of tabs) {
    // Clic, Enter o Espacio: activa y lleva el foco al primer campo
    tab.addEventListener("click", () => selectTab(tab, { focus: "field" }));

    // Flechas, Inicio y Fin: mueven la selección entre pestañas (el foco queda en la pestaña)
    tab.addEventListener("keydown", (event) => {
        const index = tabs.indexOf(tab);
        const targets = {
            ArrowRight: tabs[(index + 1) % tabs.length],
            ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
            Home: tabs[0],
            End: tabs[tabs.length - 1],
        };
        const target = targets[event.key];
        if (!target) return;
        event.preventDefault();
        selectTab(target, { focus: "tab" });
    });
}

// Pestaña inicial según el hash (#registro abre "Crear cuenta")
const tabFromHash = () => (location.hash === REGISTER_HASH ? $("tabRegister") : $("tabLogin"));
selectTab(tabFromHash(), { focus: "none" });
window.addEventListener("hashchange", () => selectTab(tabFromHash(), { focus: "none" }));

// ---------- Después de un registro exitoso ----------
// login.js emite este evento tras el 201; se pasa a "Iniciar sesión" con el usuario ya escrito.
document.addEventListener("viruscity:registered", (event) => {
    const form = $("loginForm");
    selectTab($("tabLogin"), { focus: "none" });
    form.elements.username.value = event.detail?.username ?? "";
    form.elements.password.value = "";
    form.elements.password.focus();

    const message = $("loginMessage");
    message.textContent = "Cuenta creada. Escribe tu contraseña para entrar.";
    message.className = "msg msg--ok";
});

// ---------- Partículas del hero ----------
// Solo corren mientras el canvas se ve (en pantallas angostas el CSS lo oculta).
const canvas = $("heroParticles");
let particles = null;

function syncParticles() {
    const visible = canvas.getClientRects().length > 0;
    if (visible && !particles) particles = startParticles(canvas, { count: 40 });
    else if (!visible && particles) {
        particles.stop();
        particles = null;
    }
}

syncParticles();
window.addEventListener("resize", syncParticles);

// ---------- Virus animado del hero ----------
// Rebota solo; con clic, toque, Enter o Espacio da un salto. Con movimiento reducido queda quieto
// y deja de ser interactivo (vuelve a ser una imagen con su nombre accesible).
const virusStage = $("heroVirus");
const virusHint = $("heroVirusHint");

function setVirusInteractive(interactive) {
    virusStage.classList.toggle("is-interactive", interactive);
    virusHint.hidden = !interactive;
    if (interactive) {
        virusStage.setAttribute("role", "button");
        virusStage.tabIndex = 0;
        virusStage.setAttribute("aria-label", "Logo de Viruscity: pulsa para hacer saltar al virus");
    } else {
        virusStage.setAttribute("role", "img");
        virusStage.removeAttribute("tabindex");
        virusStage.setAttribute("aria-label", "Logo de Viruscity");
    }
}

startBouncingVirus(virusStage, $("heroVirusCanvas"), { onInteractiveChange: setVirusInteractive });
virusStage.classList.add("is-live"); // oculta el logo estático de respaldo
