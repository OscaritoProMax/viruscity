// Página del juego en vivo (Taller 5).
// El SERVIDOR es la autoridad: este cliente no calcula posiciones ni choques. Solo:
//   - guarda el último mensaje state en window.lastState y lo dibuja sobre el mapa de Virus City,
//   - envía intenciones de movimiento y extras (la apariencia de su personaje).
// Todo el texto dinámico va con textContent (DOM) o fillText (canvas).

import { computeIntent, MOVEMENT_CODES } from "./intent.js";
import { createRenderer } from "./render.js";
import { createLookPanel } from "./look-panel.js";
import { createPlayersPanel } from "./players-panel.js";
import { defaultLook, lookToExtras, parseSavedLook } from "./characters/look.js";
import { areaName } from "./map/zones.js";
import { gameMinutes, formatClock, isNight } from "./map/clock.js";
import { ZOOM_STEP, clampZoom } from "./view.js";

const $ = (id) => document.getElementById(id);

// Mensajes según el código de cierre del coordinator (los mismos del Taller 4)
const CLOSE_MESSAGES = {
    4001: "Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.",
    4002: "Tu sesión se abrió en otra pestaña. Esta sesión fue cerrada.",
};
const DEFAULT_CLOSE_MESSAGE = "Se perdió la conexión con el coordinador. Inicia sesión de nuevo.";

// Vigilancia del token guardado (igual que el lobby): si cambia o desaparece, la sesión se cae
const TOKEN_CHECK_MS = 1000;
const TOKEN_CHANGED_MESSAGE = "El token de tu sesión no es válido. Inicia sesión de nuevo.";
const TOKEN_REMOVED_MESSAGE = "Tu sesión se cerró. Inicia sesión de nuevo.";

const UNSTABLE_AFTER_MS = 3 * 1000; // sin state durante más de 3 s → aviso
const MAX_FRAME_DT = 0.05;
const HUD_EVERY_MS = 250; // zona, hora y lista se refrescan 4 veces por segundo (no en cada cuadro)
const PROVIDER_LABELS = { google: "Google", local: "Local" };

// Preferencias solo de este navegador (try/catch: el almacenamiento puede estar bloqueado)
function readPref(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
function writePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // sin almacenamiento: la preferencia dura solo esta visita
    }
}

// Estado más reciente del servidor (el mensaje state completo). Es la única fuente de verdad.
window.lastState = null;

// Lee el payload del JWT sin verificar la firma (eso lo hace el coordinator). Solo para mostrar datos.
function decodeTokenPayload(token) {
    try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

// Borra la sesión guardada solo si el token sigue siendo el de esta pestaña
// (todas las pestañas comparten localStorage)
function clearSession(token) {
    if (localStorage.getItem("token") !== token) return;
    localStorage.removeItem("token");
    localStorage.removeItem("username");
}

function setConnection(state) {
    const texts = { connecting: "Conectando…", connected: "Conectado", disconnected: "Desconectado" };
    $("connection").dataset.state = state;
    $("connectionText").textContent = texts[state];
}

function startGame(token) {
    const payload = decodeTokenPayload(token);
    let me = { userId: payload?.userId ?? null };
    let world = null;
    let loggingOut = false;
    let lastStateAt = 0;
    let welcomeAt = 0;

    // Cabecera: username y proveedor (solo para mostrar; el servidor manda el suyo en welcome)
    const provider = payload?.provider;
    $("meName").textContent = payload?.username ?? localStorage.getItem("username") ?? "";
    if (PROVIDER_LABELS[provider]) {
        $("meProvider").textContent = PROVIDER_LABELS[provider];
        $("meProvider").dataset.provider = provider;
        $("meProvider").hidden = false;
    }
    setConnection("connecting");

    // ---------- Canvas, minimapa y zoom (solo visuales) ----------
    const canvas = $("gameCanvas");
    const box = $("canvasBox");
    const renderer = createRenderer(canvas, $("minimap"));
    const fitCanvas = () => renderer.resize(box.clientWidth, box.clientHeight);
    new ResizeObserver(fitCanvas).observe(box);
    fitCanvas();

    function setZoom(z) {
        renderer.setZoom(clampZoom(z));
        $("zoomText").textContent = `${renderer.getZoom().toFixed(2).replace(/0$/, "")}×`;
        writePref("playZoom", String(renderer.getZoom()));
    }
    setZoom(Number(readPref("playZoom")) || 1);
    $("zoomIn").addEventListener("click", () => setZoom(renderer.getZoom() + ZOOM_STEP));
    $("zoomOut").addEventListener("click", () => setZoom(renderer.getZoom() - ZOOM_STEP));
    $("zoomReset").addEventListener("click", () => setZoom(1));

    // ---------- WebSocket ----------
    const ws = new WebSocket(`${window.APP_CONFIG.COORDINATOR_WS_URL}/connect?token=${encodeURIComponent(token)}`);
    const sendJson = (msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.onopen = () => setConnection("connected");

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return; // mensaje que no es JSON: se ignora
        }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "welcome") {
            const w = msg.world;
            if (w && [w.width, w.height, w.playerRadius].every(Number.isFinite)) {
                world = { width: w.width, height: w.height, playerRadius: w.playerRadius, tickRate: w.tickRate };
                welcomeAt = performance.now();
            }
            if (msg.you?.userId) me = { userId: String(msg.you.userId) };
            // Apariencia guardada de sesiones anteriores; si no hay, la que le corresponde por su userId
            const saved = parseSavedLook(readPref("playLook"), readPref("playColor"));
            applyLook(saved ?? defaultLook(me.userId), Boolean(saved));
        } else if (msg.type === "state") {
            if (!Array.isArray(msg.players)) return;
            window.lastState = msg;
            lastStateAt = performance.now();
        }
        // players_update se ignora: la lista sale de lastState
    };

    // Cierre inesperado: se guarda el motivo y se vuelve al login (sin reconexión automática).
    // Con 4002 el token guardado ya es de la sesión nueva (otra pestaña): no se borra.
    ws.onclose = (event) => {
        setConnection("disconnected");
        clearInterval(tokenWatch);
        if (loggingOut) return;
        sessionStorage.setItem("sessionMessage", CLOSE_MESSAGES[event.code] || DEFAULT_CLOSE_MESSAGE);
        if (event.code !== 4002) clearSession(token);
        window.location.href = "login.html";
    };

    $("logoutButton").addEventListener("click", () => {
        loggingOut = true;
        clearSession(token);
        ws.close(1000, "logout");
        window.location.href = "login.html";
    });

    // El coordinator solo valida el token al conectar: si el token guardado cambia o desaparece con la
    // sesión abierta, esta sesión ya no es válida (igual que en el lobby)
    function checkStoredToken() {
        const stored = localStorage.getItem("token");
        if (loggingOut || stored === token) return;
        loggingOut = true;
        clearInterval(tokenWatch);
        sessionStorage.setItem("sessionMessage", stored === null ? TOKEN_REMOVED_MESSAGE : TOKEN_CHANGED_MESSAGE);
        ws.close(1000, "invalid token");
        window.location.href = "login.html";
    }
    const tokenWatch = setInterval(checkStoredToken, TOKEN_CHECK_MS);
    window.addEventListener("storage", (event) => {
        if (event.key === "token" || event.key === null) checkStoredToken();
    });

    // ---------- Entrada: solo INTENCIONES (la posición la decide el servidor) ----------
    const keys = new Set();
    let lastIntent = { x: 0, y: 0 };

    // Envía la intención solo si cambió respecto a la última enviada
    function pushIntent() {
        const intent = computeIntent(keys);
        if (intent.x === lastIntent.x && intent.y === lastIntent.y) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        lastIntent = intent;
        sendJson({ type: "intent", intent: { dir: { x: intent.x, y: intent.y } } });
    }

    const inFormControl = (target) => target instanceof Element && target.closest("input, select, textarea, button");

    window.addEventListener("keydown", (event) => {
        // Flechas y espacio no desplazan la página (salvo sobre un control: Espacio debe activar botones)
        if ((MOVEMENT_CODES.has(event.code) || event.code === "Space") && !inFormControl(event.target)) event.preventDefault();
        if (!MOVEMENT_CODES.has(event.code)) return;
        keys.add(event.code);
        pushIntent();
    });
    window.addEventListener("keyup", (event) => {
        if (!keys.delete(event.code)) return;
        pushIntent();
    });

    // Al perder el foco o esconder la pestaña se sueltan todas las teclas (intención {0, 0})
    function releaseAll() {
        keys.clear();
        pushIntent();
    }
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) releaseAll();
    });

    // ---------- Extra: apariencia del personaje ----------
    // Se envía como extras_update (el servidor reemplaza los extras completos y los reenvía a todos).
    // `color` sigue siendo el color principal: es el único campo que valida el servidor.
    const lookPanel = createLookPanel({ onChange: (look) => applyLook(look, true) });

    function applyLook(look, send) {
        const extras = lookToExtras(look);
        lookPanel.setLook(extras);
        if (!send) return;
        writePref("playLook", JSON.stringify(extras));
        sendJson({ type: "extras_update", extras });
    }

    // ---------- Lista de jugadores, zona y hora ----------
    const playersPanel = createPlayersPanel($("playerList"), $("playerCount"));
    const withMap = () => renderer.hasCity();
    let lastHud = 0;
    function updateHud(now) {
        if (now - lastHud < HUD_EVERY_MS) return;
        lastHud = now;
        const state = window.lastState;
        playersPanel.update(state?.players ?? [], me.userId, (p) => (withMap() && Number.isFinite(p.x) ? areaName(p.x, p.y) : null));
        $("hudArea").textContent = renderer.area() ?? "Virus City";
        $("minimap").hidden = !withMap(); // sin mapa (mundo de otro tamaño) no hay minimapa
        if (state && Number.isFinite(state.t)) {
            const minutes = gameMinutes(state.t);
            $("hudClock").textContent = formatClock(minutes);
            $("hudClockIcon").textContent = isNight(minutes) ? "☾" : "☀";
        }
    }

    // ---------- Bucle de dibujo ----------
    let lastFrame = performance.now();
    function frame(now) {
        const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_DT);
        lastFrame = now;
        renderer.draw(window.lastState, world, me, now, dt);
        lookPanel.tick(now);
        updateHud(now);

        // Aviso discreto si dejan de llegar state
        const since = lastStateAt || welcomeAt;
        $("unstableNotice").hidden = !(ws.readyState === WebSocket.OPEN && since && now - since > UNSTABLE_AFTER_MS);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { sendJson, isClosing: () => loggingOut };
}

// Sin token no hay sesión: directo al login
const token = localStorage.getItem("token");
if (!token) {
    window.location.href = "login.html";
} else {
    startGame(token);
}
