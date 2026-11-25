// Página del modo espectador (track 2.5 del examen final): spectate.html.
//
// Sin sesión: pide un coordinador al directorio (GET {AUTH}/coordinator, igual que el juego) y abre un WebSocket a
// {publicUrl}/spectate, SIN token. Recibe lo mismo que un jugador sin rol: el state del mundo, la vista pública de la
// partida (fase, cura, misiones; los roles solo al final) y los avisos públicos. No tiene controles: esta página
// nunca manda intenciones ni extras, y aunque se fuercen desde DevTools el coordinador las ignora.
//   window.vcSpectator.send({ type: "intent", intent: { dir: { x: 1, y: 0 } } })  → no pasa nada (demo)
// La cámara sigue a un jugador (◀ ▶, teclas , y .) o es libre (C; WASD o flechas la mueven). Es solo visual.
// Todo el texto dinámico va con textContent (DOM) o fillText (canvas).

import { createRenderer } from "./render.js";
import { setupCollapsible } from "./look-panel.js";
import { createPlayersPanel } from "./players-panel.js";
import { areaName } from "./map/zones.js";
import { gameMinutes, formatClock, isNight } from "./map/clock.js";
import { ZOOM_STEP, clampZoom } from "./view.js";
import { WORLD_SCENE } from "./map/scenes.js";
import { MOVEMENT_CODES, computeIntent } from "./intent.js";
import { parseCoordinatorResponse, buildSpectateUrl, isMixedContent, nextDelay, readGraceMs, graceLeftMs, shouldGiveUp, reconnectNotice, CONNECT_TIMEOUT_MS, SERVICES_DOWN_MESSAGE } from "./directory.js";
import { nextFollow, panCamera, followLabel } from "./spectator.js";
import { parseServerMessage, parseCity, parseRules, eventText, eventTone } from "../vc/view.js";
import { createClock } from "../vc/clock.js";
import { createHud } from "../vc/hud.js";

const $ = (id) => document.getElementById(id);
const NGROK_HEADERS = { "ngrok-skip-browser-warning": "true" };
const UNSTABLE_AFTER_MS = 3 * 1000;
const MAX_FRAME_DT = 0.05;
const HUD_EVERY_MS = 250;
const NARROW_QUERY = "(max-width: 699.98px)";
const CLOSE_TEXT = { 4003: "El coordinador ya tiene el máximo de espectadores." };

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

function setConnection(state) {
    const texts = { connecting: "Conectando…", connected: "Conectado como espectador", disconnected: "Desconectado" };
    $("connection").dataset.state = state;
    $("connectionText").textContent = texts[state];
}

window.lastState = null;
let lastGame = null;

function startSpectator() {
    let world = null;
    let matchCity = null;
    let rules = parseRules(null);
    let lastStateAt = 0;
    let welcomeAt = 0;
    const clock = createClock();
    const hud = createHud();

    // ---------- Canvas, zoom y cámara ----------
    const canvas = $("gameCanvas");
    const box = $("canvasBox");
    const renderer = createRenderer(canvas, $("minimap"));
    const fitCanvas = () => renderer.resize(box.clientWidth, box.clientHeight);
    new ResizeObserver(fitCanvas).observe(box);
    fitCanvas();

    function setZoom(z) {
        renderer.setZoom(clampZoom(z));
        $("zoomText").textContent = `${renderer.getZoom().toFixed(2).replace(/0$/, "")}×`;
        writePref("spectateZoom", String(renderer.getZoom()));
    }
    setZoom(Number(readPref("spectateZoom")) || 0.75);
    $("zoomIn").addEventListener("click", () => setZoom(renderer.getZoom() + ZOOM_STEP));
    $("zoomOut").addEventListener("click", () => setZoom(renderer.getZoom() - ZOOM_STEP));
    $("zoomReset").addEventListener("click", () => setZoom(1));

    // followId: jugador que sigue la cámara (null = cámara libre en freePos)
    let followId = null;
    let freePos = null;
    let userChoseFree = false; // si eligió la cámara libre, no se cambia sola a seguir a alguien
    const players = () => window.lastState?.players ?? [];

    function renderCameraUi() {
        $("specTarget").textContent = followLabel(players(), followId);
        $("specFree").setAttribute("aria-pressed", String(followId === null));
    }
    function follow(step) {
        const next = nextFollow(players(), followId, step);
        if (!next) return;
        followId = next;
        userChoseFree = false;
        renderer.setFreeCamera(null);
        renderCameraUi();
    }
    function goFree() {
        const p = players().find((q) => q.userId === followId);
        freePos = p ? { x: p.x, y: p.y } : (freePos ?? matchCity?.plaza ?? (world ? { x: world.width / 2, y: world.height / 2 } : null));
        followId = null;
        userChoseFree = true;
        renderer.setFreeCamera(freePos);
        renderCameraUi();
    }
    $("specPrev").addEventListener("click", () => follow(-1));
    $("specNext").addEventListener("click", () => follow(1));
    $("specFree").addEventListener("click", goFree);

    // Teclado: solo mueve la cámara (nunca se envía nada al servidor)
    const keys = new Set();
    const inFormControl = (target) => target instanceof Element && target.closest("input, select, textarea, button, a");
    window.addEventListener("keydown", (event) => {
        if (event.code === "Comma") follow(-1);
        if (event.code === "Period") follow(1);
        if (event.code === "KeyC" && !event.repeat) goFree();
        if (!MOVEMENT_CODES.has(event.code)) return;
        if (!inFormControl(event.target)) event.preventDefault();
        if (followId !== null) goFree(); // moverse con la cámara pasa a cámara libre
        keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => keys.delete(event.code));
    window.addEventListener("blur", () => keys.clear());

    setupCollapsible("playersToggle", "playersBody", "spectatePlayersOpen", !window.matchMedia(NARROW_QUERY).matches);
    setupCollapsible("vcMissionsToggle", "vcMissionsBody", "spectateMissionsOpen", !window.matchMedia(NARROW_QUERY).matches);

    // ---------- Directorio y WebSocket ----------
    let ws = null;
    let coordinatorId = null;
    let attempts = 0;
    let retryTimer = null;
    let leaving = false;
    // Tiempo de gracia igual que en el juego: sin coordinador durante RECONNECT_GRACE_MS se vuelve al inicio
    const GRACE_MS = readGraceMs(window.APP_CONFIG?.RECONNECT_GRACE_MS);
    let lostAt = null;
    let lastReason = "";
    const isOpen = () => ws !== null && ws.readyState === WebSocket.OPEN;

    function showClusterNotice(text) {
        $("clusterNotice").textContent = text ?? "";
        $("clusterNotice").hidden = !text;
    }
    function setCoordinatorPill(tickRate, id) {
        $("coordText").textContent = id ? `Tick: ${tickRate} Hz · Coordinador: ${id}` : "Coordinador: —";
    }
    setCoordinatorPill(null, null);
    setConnection("connecting");

    // Al inicio (login) con el aviso de que los servicios cayeron
    function leaveToStart() {
        if (leaving) return;
        leaving = true;
        clearTimeout(retryTimer);
        clearInterval(graceWatch);
        try {
            sessionStorage.setItem("sessionMessage", SERVICES_DOWN_MESSAGE);
        } catch {
            // sin almacenamiento: el login se abre sin aviso
        }
        window.location.href = "login.html";
    }

    function retry(reason) {
        attempts += 1;
        if (lostAt === null) lostAt = Date.now();
        lastReason = reason;
        if (shouldGiveUp(lostAt, Date.now(), GRACE_MS, attempts)) return leaveToStart();
        showClusterNotice(reconnectNotice(reason, graceLeftMs(lostAt, Date.now(), GRACE_MS)));
        clearTimeout(retryTimer);
        retryTimer = setTimeout(conectar, nextDelay(attempts));
    }

    // Cuenta atrás cada segundo; vuelve al inicio aunque un intento siga colgado
    const graceWatch = setInterval(() => {
        if (leaving || lostAt === null) return;
        const left = graceLeftMs(lostAt, Date.now(), GRACE_MS);
        if (left === 0) leaveToStart();
        else showClusterNotice(reconnectNotice(lastReason, left));
    }, 1000);

    async function conectar() {
        if (leaving) return;
        setConnection("connecting");
        let result;
        try {
            const res = await window.authFetch("/coordinator", { headers: NGROK_HEADERS, cache: "no-store" });
            let body = null;
            try {
                body = await res.json();
            } catch {
                body = null;
            }
            result = parseCoordinatorResponse(res.status, body);
        } catch (err) {
            result = err?.status ? parseCoordinatorResponse(err.status, err.body) : { kind: "network" };
        }
        if (result.kind !== "ok") {
            setConnection("disconnected");
            retry(result.kind === "none" ? "Sin coordinadores disponibles." : "No se pudo contactar al servicio de autenticación.");
            return;
        }
        const url = buildSpectateUrl(result.publicUrl);
        if (isMixedContent(window.location.protocol, window.location.hostname, url)) {
            setConnection("disconnected");
            showClusterNotice(`El coordinador ${result.coordinatorId} usa ws:// y esta página es https://: el navegador bloquea esa conexión. Su PUBLIC_URL debe empezar por wss://.`);
            return;
        }
        openSocket(url, result.coordinatorId);
    }

    function openSocket(url, assignedId) {
        const socket = new WebSocket(url);
        ws = socket;
        coordinatorId = assignedId;
        const connectTimer = setTimeout(() => {
            if (ws === socket && socket.readyState === WebSocket.CONNECTING) socket.close();
        }, CONNECT_TIMEOUT_MS);
        socket.onopen = () => {
            clearTimeout(connectTimer);
            if (ws === socket) setConnection("connected");
        };
        socket.onmessage = (event) => {
            if (ws === socket) handleMessage(event);
        };
        socket.onclose = (event) => {
            if (ws !== socket) return;
            setConnection("disconnected");
            ws = null;
            window.lastState = null;
            lastGame = null;
            hud.reset();
            setCoordinatorPill(null, null);
            const previous = coordinatorId ?? "el coordinador";
            retry(`${CLOSE_TEXT[event.code] ?? `Conexión perdida con ${previous}.`} Buscando otro coordinador.`);
        };
    }

    function handleMessage(event) {
        const parsed = parseServerMessage(event.data);
        if (!parsed) return;
        if (parsed.kind === "game") {
            lastGame = parsed.msg;
            clock.sync(parsed.msg.serverTime, Date.now());
            refreshGameHud();
            return;
        }
        if (parsed.kind === "event") {
            // Solo llegan los avisos públicos (sin nombres ni roles)
            hud.toast(eventText(parsed.msg), eventTone(parsed.msg));
            if (parsed.msg.kind === "match_ended" || parsed.msg.kind === "match_cancelled") refreshGameHud();
            return;
        }
        const msg = parsed.msg;
        if (msg.type === "welcome") {
            matchCity = parseCity(msg.city);
            renderer.setCity(matchCity);
            rules = parseRules(msg.game);
            if (typeof msg.coordinatorId === "string" && msg.coordinatorId) coordinatorId = msg.coordinatorId;
            const w = msg.world;
            if (w && [w.width, w.height, w.playerRadius].every(Number.isFinite)) {
                world = { width: w.width, height: w.height, playerRadius: w.playerRadius, tickRate: w.tickRate };
                welcomeAt = performance.now();
            }
            attempts = 0;
            lostAt = null;
            showClusterNotice(null);
            setCoordinatorPill(world?.tickRate ?? "?", coordinatorId);
            if (followId === null && !freePos) goFree();
            userChoseFree = false; // al entrar se sigue al primer jugador que aparezca
        } else if (msg.type === "state") {
            if (!Array.isArray(msg.players)) return;
            window.lastState = msg;
            lastStateAt = performance.now();
            // Si el seguido se fue, o aún no se sigue a nadie, se sigue al siguiente (salvo que eligió cámara libre)
            const gone = followId !== null && !msg.players.some((p) => p.userId === followId);
            if (gone || (followId === null && !userChoseFree && msg.players.length > 0)) {
                followId = nextFollow(msg.players, null, 1);
                renderer.setFreeCamera(followId ? null : freePos);
                renderCameraUi();
            }
        }
    }

    function refreshGameHud() {
        const p = players().find((q) => q.userId === followId);
        const pos = p && Number.isFinite(p.x) ? { x: p.x, y: p.y } : null;
        hud.update({ game: lastGame, clock, localNow: Date.now(), pos, players: players(), selfId: null, city: matchCity, rules });
    }

    // Para la demo desde DevTools: lo que se mande por aquí el coordinador lo IGNORA
    window.vcSpectator = {
        send: (obj) => (isOpen() ? (ws.send(JSON.stringify(obj)), true) : false),
        coordinator: () => coordinatorId,
    };

    // ---------- HUD y bucle de dibujo ----------
    const playersPanel = createPlayersPanel($("playerList"), $("playerCount"));
    let lastHud = 0;
    function updateHud(now) {
        if (now - lastHud < HUD_EVERY_MS) return;
        lastHud = now;
        const state = window.lastState;
        playersPanel.update(state?.players ?? [], null, (p) => (renderer.hasCity() && Number.isFinite(p.x) ? areaName(p.x, p.y) : null));
        $("hudArea").textContent = renderer.area() ?? (freePos && renderer.hasCity() && followId === null ? areaName(freePos.x, freePos.y) : null) ?? "Virus City";
        renderCameraUi();
        refreshGameHud();
        $("minimap").hidden = !renderer.hasCity() || renderer.scene() !== WORLD_SCENE;
        if (state && Number.isFinite(state.t)) {
            const minutes = gameMinutes(state.t);
            $("hudClock").textContent = formatClock(minutes);
            $("hudClockIcon").textContent = isNight(minutes) ? "☾" : "☀";
        }
    }

    let lastFrame = performance.now();
    function frame(now) {
        const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_DT);
        lastFrame = now;
        if (followId === null && world && keys.size > 0) {
            freePos = panCamera(freePos, computeIntent(keys), dt, world, renderer.getZoom());
            renderer.setFreeCamera(freePos);
        }
        renderer.draw(window.lastState, world, { userId: followId }, now, dt, lastGame);
        updateHud(now);
        const since = lastStateAt || welcomeAt;
        $("unstableNotice").hidden = !(isOpen() && since && now - since > UNSTABLE_AFTER_MS);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    conectar();
}

startSpectator();
