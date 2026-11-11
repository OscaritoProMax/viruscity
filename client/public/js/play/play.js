// Página del juego en vivo (Talleres 5 y 6).
// Taller 6: antes de conectar se pide un coordinador al directorio (GET {AUTH_URL}/coordinator) y el
// WebSocket va a su publicUrl. Hay varios coordinadores intercambiables con el mismo estado del juego.
// El SERVIDOR es la autoridad: este cliente no calcula posiciones ni choques. Solo:
//   - guarda el último mensaje state en window.lastState y lo dibuja sobre el mapa de Virus City,
//   - envía intenciones de movimiento y extras (la apariencia de su personaje y su poder).
// Lo local (no viaja por la red): conversaciones con vecinos y carteles, efectos de sonido y la radio,
// que se sincroniza con la hora del servidor para que todos escuchen lo mismo.
// Todo el texto dinámico va con textContent (DOM) o fillText (canvas).

import { computeIntent, MOVEMENT_CODES } from "./intent.js";
import { createRenderer } from "./render.js";
import { createLookPanel, setupCollapsible } from "./look-panel.js";
import { createPlayersPanel } from "./players-panel.js";
import { defaultLook, lookToExtras, parseSavedLook, POWER_MS } from "./characters/look.js";
import { areaName } from "./map/zones.js";
import { gameMinutes, formatClock, isNight } from "./map/clock.js";
import { ZOOM_STEP, clampZoom } from "./view.js";
import { createAudio } from "./audio.js";
import { createRadio, STATION, estimateOffset } from "./radio.js";
import { createDialogue } from "./dialogue.js";
import { sceneAt, WORLD_SCENE } from "./map/scenes.js";
import { parseCoordinatorResponse, buildWsUrl, isMixedContent } from "./directory.js";

const $ = (id) => document.getElementById(id);

// Mensajes según el código de cierre del coordinator (los mismos del Taller 4)
const CLOSE_MESSAGES = {
    4001: "Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.",
    4002: "Tu sesión se abrió en otra pestaña. Esta sesión fue cerrada.",
};
const DEFAULT_CLOSE_MESSAGE = "Se perdió la conexión con el coordinador. Inicia sesión de nuevo.";
const NO_COORDINATOR_MESSAGE = "No hay coordinadores disponibles. Inténtalo más tarde.";
const NGROK_HEADERS = { "ngrok-skip-browser-warning": "true" }; // evita la página de aviso de ngrok

// Vigilancia del token guardado (igual que el lobby): si cambia o desaparece, la sesión se cae
const TOKEN_CHECK_MS = 1000;
const TOKEN_CHANGED_MESSAGE = "El token de tu sesión no es válido. Inicia sesión de nuevo.";
const TOKEN_REMOVED_MESSAGE = "Tu sesión se cerró. Inicia sesión de nuevo.";

const UNSTABLE_AFTER_MS = 3 * 1000; // sin state durante más de 3 s → aviso
const MAX_FRAME_DT = 0.05;
const NARROW_QUERY = "(max-width: 699.98px)"; // en pantallas angostas los paneles empiezan plegados
const HUD_EVERY_MS = 250; // zona, hora y lista se refrescan 4 veces por segundo (no en cada cuadro)
const PROVIDER_LABELS = { google: "Google", local: "Local" };
const OFFSET_SAMPLES = 40; // muestras para estimar la hora del servidor (radio sincronizada)
const HEAR_DISTANCE = 700; // los poderes de otros jugadores se oyen hasta esta distancia

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
    const offsetSamples = [];
    let serverOffset = 0; // hora del servidor ≈ Date.now() + serverOffset

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

    // ---------- Coordinador y WebSocket (Taller 6) ----------
    let ws = null; // conexión VIGENTE (los eventos de una conexión vieja se ignoran)
    let coordinatorId = null; // coordinador actual (el de welcome manda sobre el del directorio)
    const isOpen = () => ws !== null && ws.readyState === WebSocket.OPEN;
    const sendJson = (msg) => {
        if (isOpen()) ws.send(JSON.stringify(msg));
    };

    // Aviso del clúster (contenido mixto, reconexión…)
    function showClusterNotice(text) {
        $("clusterNotice").textContent = text ?? "";
        $("clusterNotice").hidden = !text;
    }
    function leaveToLogin(message, clearToken = true) {
        loggingOut = true;
        clearInterval(tokenWatch);
        sessionStorage.setItem("sessionMessage", message);
        if (clearToken) clearSession(token);
        window.location.href = "login.html";
    }

    // login → GET /coordinator → WebSocket al coordinador asignado
    async function conectar() {
        if (loggingOut) return;
        setConnection("connecting");
        let result;
        try {
            const res = await fetch(`${window.APP_CONFIG.AUTH_URL}/coordinator`, { headers: NGROK_HEADERS, cache: "no-store" });
            let body = null;
            try {
                body = await res.json();
            } catch {
                body = null; // p. ej. una página de aviso en vez de JSON
            }
            result = parseCoordinatorResponse(res.status, body);
        } catch {
            result = { kind: "network" };
        }
        if (loggingOut) return;
        if (result.kind !== "ok") {
            onDirectoryFailure(result.kind);
            return;
        }
        const url = buildWsUrl(result.publicUrl, token);
        if (isMixedContent(window.location.protocol, window.location.hostname, url)) {
            // El navegador bloquearía ws:// desde una página https: se explica y no se intenta
            setConnection("disconnected");
            showClusterNotice(`El coordinador ${result.coordinatorId} usa ws:// y esta página es https://: el navegador bloquea esa conexión (contenido mixto). Su PUBLIC_URL debe empezar por wss://.`);
            return;
        }
        openSocket(url, result.coordinatorId);
    }

    // Sin coordinador del directorio: por ahora se vuelve al login
    function onDirectoryFailure() {
        setConnection("disconnected");
        leaveToLogin(NO_COORDINATOR_MESSAGE);
    }

    function openSocket(url, assignedId) {
        const socket = new WebSocket(url);
        ws = socket;
        coordinatorId = assignedId;
        socket.onopen = () => {
            if (ws === socket) setConnection("connected");
        };
        socket.onmessage = (event) => {
            if (ws === socket) handleMessage(event);
        };
        socket.onclose = (event) => {
            if (ws === socket) handleClose(event);
        };
    }

    function handleMessage(event) {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return; // mensaje que no es JSON: se ignora
        }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "welcome") {
            if (typeof msg.coordinatorId === "string" && msg.coordinatorId) coordinatorId = msg.coordinatorId;
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
            if (Number.isFinite(msg.t)) {
                offsetSamples.push(msg.t - Date.now());
                if (offsetSamples.length > OFFSET_SAMPLES) offsetSamples.shift();
                serverOffset = estimateOffset(offsetSamples);
            }
        }
        // players_update se ignora: la lista sale de lastState
    }

    // Cierre del WebSocket vigente: se guarda el motivo y se vuelve al login.
    // Con 4002 el token guardado ya es de la sesión nueva (otra pestaña): no se borra.
    function handleClose(event) {
        setConnection("disconnected");
        if (loggingOut) return;
        leaveToLogin(CLOSE_MESSAGES[event.code] || DEFAULT_CLOSE_MESSAGE, event.code !== 4002);
    }

    $("logoutButton").addEventListener("click", () => {
        loggingOut = true;
        clearSession(token);
        ws?.close(1000, "logout");
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
        ws?.close(1000, "invalid token");
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
        if (!isOpen()) return;
        lastIntent = intent;
        sendJson({ type: "intent", intent: { dir: { x: intent.x, y: intent.y } } });
    }

    const inFormControl = (target) => target instanceof Element && target.closest("input, select, textarea, button");
    const inTextField = (target) => target instanceof Element && target.closest("input, select, textarea");

    window.addEventListener("keydown", (event) => {
        audio.unlock(); // el navegador solo deja sonar audio después de una interacción
        if (!event.repeat && !inTextField(event.target)) {
            if (event.code === "KeyE") interact(); // hablar con un vecino o mirar un cartel
            if (event.code === "KeyQ" && !dialogue.isOpen()) usePower();
            if (event.code === "Escape" && dialogue.isOpen()) endDialogue();
        }
        // Flechas y espacio no desplazan la página (salvo sobre un control: Espacio debe activar botones)
        if ((MOVEMENT_CODES.has(event.code) || event.code === "Space") && !inFormControl(event.target)) event.preventDefault();
        if (!MOVEMENT_CODES.has(event.code) || dialogue.isOpen()) return;
        keys.add(event.code);
        pushIntent();
    });
    window.addEventListener("pointerdown", () => audio.unlock());
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

    // ---------- Sonido y radio ----------
    const audio = createAudio();
    const radio = createRadio(audio);
    const serverNow = () => Date.now() + serverOffset;

    function renderSoundButtons() {
        const radioOff = audio.isRadioMuted();
        $("radioToggle").setAttribute("aria-pressed", String(radioOff));
        $("radioToggle").setAttribute("aria-label", radioOff ? "Encender la radio" : "Silenciar la radio");
        $("radioIcon").textContent = radioOff ? "✕" : "♪";
        $("radioLabel").textContent = radioOff ? "Radio apagada" : "Radio";
        const sfxOff = audio.isSfxMuted();
        $("sfxToggle").setAttribute("aria-pressed", String(sfxOff));
        $("sfxToggle").setAttribute("aria-label", sfxOff ? "Activar los efectos de sonido" : "Silenciar los efectos de sonido");
        $("sfxIcon").textContent = sfxOff ? "🔇" : "🔊";
        $("sfxLabel").textContent = sfxOff ? "Sin efectos" : "Efectos";
    }
    $("radioToggle").addEventListener("click", () => {
        audio.unlock();
        audio.setRadioMuted(!audio.isRadioMuted());
        renderSoundButtons();
    });
    $("sfxToggle").addEventListener("click", () => {
        audio.unlock();
        audio.setSfxMuted(!audio.isSfxMuted());
        renderSoundButtons();
    });
    renderSoundButtons();
    $("radioStation").textContent = STATION;

    function radioText() {
        if (!audio.ready()) return "Pulsa una tecla para sintonizar";
        if (audio.isRadioMuted()) return "Radio en silencio";
        const p = radio.program(serverNow());
        return p.gap ? `A continuación: ${p.next.title}` : `Sonando: ${p.song.title}`;
    }

    // ---------- Conversaciones (locales) ----------
    const dialogue = createDialogue({ onBlip: () => audio.sfx.blip() });
    function interact() {
        if (dialogue.isOpen()) {
            if (dialogue.advance()) endDialogue();
            return;
        }
        const t = renderer.target();
        if (!t) return;
        // Mientras se conversa, el jugador se queda quieto (intención {0, 0})
        keys.clear();
        pushIntent();
        if (t.npc) {
            renderer.setTalking(t.npc, t);
            dialogue.open(t.npc.speaker || t.npc.name, t.npc.lines);
        } else {
            dialogue.open(t.o.speaker || null, t.o.lines);
            if (t.o.action === "jukebox") {
                audio.sfx.jukebox();
                renderer.jukebox(performance.now(), 3600);
            }
        }
    }
    function endDialogue() {
        dialogue.close();
        renderer.setTalking(null);
    }

    // Sonidos de lo que pasa en este cuadro (pasos, puertas y poderes de quienes están cerca)
    function playEvents() {
        if (renderer.meMoving()) audio.sfx.step(renderer.surface());
        const myScene = renderer.scene();
        const mine = renderer.positionOf(me.userId);
        for (const e of renderer.drainEvents()) {
            if (e.type === "scene") {
                audio.sfx.door();
                if (e.to !== WORLD_SCENE) audio.sfx.chime();
                if (dialogue.isOpen()) endDialogue();
            } else if (e.type === "power") {
                const pos = renderer.positionOf(e.userId);
                if (!pos || sceneAt(pos.x, pos.y) !== myScene) continue;
                const d = e.userId === me.userId || !mine ? 0 : Math.hypot(pos.x - mine.x, pos.y - mine.y);
                audio.sfx.power(e.power, 1 - d / HEAR_DISTANCE);
            }
        }
    }

    // ---------- Extra: apariencia del personaje ----------
    // Se envía como extras_update (el servidor reemplaza los extras completos y los reenvía a todos).
    // `color` sigue siendo el color principal: es el único campo que valida el servidor.
    const lookPanel = createLookPanel({ onChange: (look) => applyLook(look, true), onUsePower: () => usePower() });
    const narrow = window.matchMedia(NARROW_QUERY).matches;
    setupCollapsible("lookToggle", "lookBody", "playLookOpen", !narrow);
    setupCollapsible("playersToggle", "playersBody", "playPlayersOpen", !narrow);

    // Poder: powerOn viaja en los extras durante POWER_MS y luego se apaga. Es solo visual (todos ven
    // el efecto en el state) y no cambia posiciones. Un uso a la vez.
    let powerBusyUntil = 0;
    function usePower() {
        const look = lookPanel.getLook();
        const now = performance.now();
        if (look.power === "none" || now < powerBusyUntil || !isOpen()) return;
        powerBusyUntil = now + POWER_MS + 100;
        sendJson({ type: "extras_update", extras: { ...lookToExtras(look), powerOn: true } });
        setTimeout(() => sendJson({ type: "extras_update", extras: lookToExtras(lookPanel.getLook()) }), POWER_MS);
    }

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
        $("radioTitle").textContent = radioText();
        // Minimapa solo en la ciudad (sin mapa del servidor o dentro de un local se oculta)
        $("minimap").hidden = !withMap() || renderer.scene() !== WORLD_SCENE;
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
        dialogue.tick(dt);
        playEvents();
        radio.update(serverNow());
        updateHud(now);

        // Aviso discreto si dejan de llegar state
        const since = lastStateAt || welcomeAt;
        $("unstableNotice").hidden = !(isOpen() && since && now - since > UNSTABLE_AFTER_MS);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    conectar();

    return { sendJson, isClosing: () => loggingOut };
}

// Sin token no hay sesión: directo al login
const token = localStorage.getItem("token");
if (!token) {
    window.location.href = "login.html";
} else {
    startGame(token);
}
