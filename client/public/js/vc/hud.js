// HUD de la partida de Viruscity (DOM de play.html). Solo muestra lo que dice el último mensaje 'game'
// del servidor; las decisiones (textos, pistas, cercanía) salen de view.js, que es pura y está probada.
// Todo el texto dinámico va con textContent; cada elemento solo se toca cuando su contenido cambia.
//
// createHud() → { update(ctx), toast(text, tone), reset() }
//   ctx = { game, clock, localNow, pos, players, selfId, city, rules }
//
//   arriba-izquierda  chip de fase + temporizador (cuenta regresiva o tiempo restante de la partida)
//   arriba-centro     barra de CURA (playing y ended; visible para todos los roles)
//   arriba-derecha    "Jugadores: connected/minPlayers" (open_world y countdown)
//   abajo-izquierda   panel "Misiones" plegable (playing y ended)
//   abajo-centro      pista contextual y avisos (toasts de 3 s, aria-live)
//   centro            banner "La partida empieza en N s" (countdown)

import { formatMMSS, secondsLeft } from "./clock.js";
import { phaseLabel, contextHint, curePercent, missionStatusLabel, zoneName } from "./view.js";

const TOAST_MS = 3000;
const MAX_TOASTS = 4;

const $ = (id) => document.getElementById(id);

// Escribe solo si cambió (evita tocar el DOM 4 veces por segundo sin necesidad)
function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
}
function setHidden(el, hidden) {
    if (el.hidden !== hidden) el.hidden = hidden;
}
function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function createHud() {
    const el = {
        phase: $("vcPhase"),
        phaseLabel: $("vcPhaseLabel"),
        timer: $("vcTimer"),
        cure: $("vcCure"),
        cureBar: $("vcCureBar"),
        cureFill: $("vcCureFill"),
        cureText: $("vcCureText"),
        players: $("vcPlayers"),
        missions: $("vcMissions"),
        missionsCount: $("vcMissionsCount"),
        missionList: $("vcMissionList"),
        hint: $("vcHint"),
        banner: $("vcBanner"),
        bannerText: $("vcBannerText"),
        toasts: $("vcToasts"),
    };
    let missionsSignature = "";

    // El HUD empieza justo debajo de la barra superior del juego, que en pantallas angostas se envuelve en
    // varias filas: su altura real se publica en la variable CSS --vc-top (vc.css tiene valores de respaldo)
    const topBar = document.querySelector(".play-top");
    if (topBar && typeof ResizeObserver === "function") {
        new ResizeObserver(() => {
            const bottom = Math.round(topBar.getBoundingClientRect().bottom);
            if (bottom > 0) document.body.style.setProperty("--vc-top", `${bottom + 8}px`);
        }).observe(topBar);
    }

    // Lista de misiones: título, zona y estado (nunca quién la hace). Se rehace solo si algo cambió.
    function renderMissions(game, city) {
        const signature = game.missions.map((m) => `${m.id}:${m.status}`).join("|") + `|${game.you.missionId ?? ""}`;
        if (signature === missionsSignature) return;
        missionsSignature = signature;
        const done = game.missions.filter((m) => m.status === "done").length;
        setText(el.missionsCount, `${done}/${game.missions.length}`);
        const items = game.missions.map((m) => {
            const li = document.createElement("li");
            li.className = "vc-mission";
            li.dataset.status = m.status;
            if (m.id === game.you.missionId) li.classList.add("is-mine");
            const title = document.createElement("span");
            title.className = "vc-mission__title";
            title.textContent = m.title;
            const zone = document.createElement("span");
            zone.className = "vc-mission__zone";
            zone.textContent = zoneName(city, m.zoneId);
            const status = document.createElement("span");
            status.className = "vc-mission__status";
            status.textContent = missionStatusLabel(m.status);
            li.append(title, zone, status);
            return li;
        });
        el.missionList.replaceChildren(...items);
    }

    function update(ctx) {
        const { game, clock, localNow } = ctx;
        setHidden(el.phase, !game);
        if (!game) {
            for (const node of [el.cure, el.players, el.missions, el.hint, el.banner]) setHidden(node, true);
            return;
        }
        const { phase } = game;
        const inMatch = phase === "playing" || phase === "ended";

        // Fase y temporizador
        el.phase.dataset.phase = phase;
        setText(el.phaseLabel, phaseLabel(game));
        const target = phase === "countdown" ? game.countdownEndsAt : phase === "playing" ? game.endsAt : null;
        setHidden(el.timer, target === null);
        if (target !== null) setText(el.timer, formatMMSS(clock.remaining(target, localNow)));

        // Cura (pública: la ven todos los roles)
        setHidden(el.cure, !inMatch);
        if (inMatch) {
            const pct = curePercent(game.cure);
            setText(el.cureText, `${pct} %`);
            setAttr(el.cureBar, "aria-valuenow", String(pct));
            setAttr(el.cureBar, "aria-valuetext", `Cura al ${pct} %`);
            const width = `${Math.max(0, Math.min(100, game.cure))}%`;
            if (el.cureFill.style.width !== width) el.cureFill.style.width = width;
        }

        // Jugadores conectados en todo el clúster frente al mínimo para empezar
        setHidden(el.players, inMatch);
        if (!inMatch) setText(el.players, `Jugadores: ${game.connected}/${game.minPlayers}`);

        // Misiones
        setHidden(el.missions, !inMatch);
        if (inMatch) renderMissions(game, ctx.city);
        else missionsSignature = "";

        // Pista contextual
        const hint = contextHint(ctx);
        setHidden(el.hint, !hint);
        if (hint) setText(el.hint, hint);

        // Banner de cuenta regresiva
        setHidden(el.banner, phase !== "countdown");
        if (phase === "countdown") setText(el.bannerText, `La partida empieza en ${secondsLeft(clock.remaining(game.countdownEndsAt, localNow))} s`);
    }

    // Aviso de 3 s (los más viejos se van si hay demasiados)
    function toast(text, tone = "neutral") {
        if (!text) return;
        const node = document.createElement("p");
        node.className = "vc-toast";
        node.dataset.tone = tone;
        node.textContent = text;
        el.toasts.append(node);
        while (el.toasts.children.length > MAX_TOASTS) el.toasts.firstElementChild.remove();
        setTimeout(() => node.remove(), TOAST_MS);
    }

    // Sin conexión: todo el HUD de la partida se oculta
    function reset() {
        missionsSignature = "";
        update({ game: null });
    }

    reset();
    return { update, toast, reset };
}
