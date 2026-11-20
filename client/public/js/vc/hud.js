// HUD de la partida de Viruscity (DOM de play.html). Solo muestra lo que dice el último mensaje 'game'
// del servidor; las decisiones (textos, pistas, cercanía) salen de view.js, que es pura y está probada.
// Todo el texto dinámico va con textContent; cada elemento solo se toca cuando su contenido cambia.
//
// createHud() → { update(ctx), toast(text, tone), reset(), showRole(role, game), closeRole(), roleOpen() }
//   ctx = { game, clock, localNow, pos, players, selfId, city, rules }
//
//   arriba-izquierda  chip de fase + temporizador (cuenta regresiva o tiempo restante de la partida)
//   arriba-centro     barra de CURA (playing y ended; visible para todos los roles)
//   arriba-derecha    "Jugadores: connected/minPlayers" (open_world y countdown)
//   abajo-izquierda   panel "Misiones" plegable (playing y ended)
//   abajo-centro      pista contextual y avisos (toasts de 3 s, aria-live)
//   centro            banner "La partida empieza en N s" (countdown)
//   pantalla de rol   4 s al empezar la partida (se cierra sola, con cualquier tecla o con un toque)
//   pantalla de fin   mientras la fase es ended: ganador, motivo, ganaste/perdiste y roles revelados

import { formatMMSS, secondsLeft } from "./clock.js";
import { phaseLabel, contextHint, curePercent, missionStatusLabel, zoneName, roleScreen, endSummary, infectStatus } from "./view.js";

const TOAST_MS = 3000;
const MAX_TOASTS = 4;
const ROLE_MS = 4000;
const ROLE_TAGS = { healthy: "SANO", infected: "INFECTADO", spectator: "ESPECTADOR" };

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
        roleTag: $("vcRoleTag"),
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
        role: $("vcRole"),
        roleCard: $("vcRoleCard"),
        roleTitle: $("vcRoleTitle"),
        roleText: $("vcRoleText"),
        end: $("vcEnd"),
        endCard: $("vcEndCard"),
        endTitle: $("vcEndTitle"),
        endReason: $("vcEndReason"),
        endOutcome: $("vcEndOutcome"),
        endRows: $("vcEndRows"),
        endBack: $("vcEndBack"),
    };
    let missionsSignature = "";
    let endSignature = "";
    let shownRole = null; // rol de la pantalla de rol abierta (null = cerrada)
    let roleTimer = null;

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

    // ---------- Pantalla de rol ----------
    function renderRole(game) {
        const screen = roleScreen(game, shownRole);
        el.roleCard.dataset.tone = screen.tone;
        setText(el.roleTitle, screen.title);
        setText(el.roleText, screen.text);
    }

    function showRole(role, game) {
        if (role !== "healthy" && role !== "infected") return;
        shownRole = role;
        renderRole(game);
        el.role.hidden = false;
        el.roleCard.focus({ preventScroll: true });
        clearTimeout(roleTimer);
        roleTimer = setTimeout(closeRole, ROLE_MS);
    }

    function closeRole() {
        clearTimeout(roleTimer);
        if (shownRole === null) return;
        shownRole = null;
        el.role.hidden = true;
        if (document.activeElement === el.roleCard) el.roleCard.blur();
    }
    el.role.addEventListener("pointerdown", closeRole);

    // ---------- Pantalla de fin ----------
    function renderEnd(game, selfId) {
        const summary = endSummary(game, selfId);
        if (!summary) return false;
        const signature = JSON.stringify(summary);
        if (signature === endSignature) return true;
        endSignature = signature;
        el.endCard.dataset.tone = summary.tone;
        setText(el.endTitle, summary.title);
        setText(el.endReason, summary.reason);
        setText(el.endOutcome, summary.outcome);
        el.endOutcome.dataset.result = summary.outcome === "Ganaste" ? "win" : summary.outcome === "Perdiste" ? "lose" : "none";
        const rows = summary.rows.map((r) => {
            const tr = document.createElement("tr");
            if (r.you) tr.className = "is-me";
            const name = document.createElement("td");
            name.textContent = r.username;
            if (r.you) {
                const you = document.createElement("span");
                you.className = "vc-end__you";
                you.textContent = " (tú)";
                name.append(you);
            }
            const role = document.createElement("td");
            role.className = "vc-end__role";
            role.dataset.role = r.role === "Infectado" ? "infected" : "healthy";
            role.textContent = r.role;
            tr.append(name, role);
            return tr;
        });
        el.endRows.replaceChildren(...rows);
        return true;
    }

    function update(ctx) {
        const { game, clock, localNow } = ctx;
        setHidden(el.phase, !game);
        if (!game) {
            for (const node of [el.cure, el.players, el.missions, el.hint, el.banner, el.end]) setHidden(node, true);
            endSignature = "";
            closeRole();
            return;
        }
        const { phase } = game;
        const inMatch = phase === "playing" || phase === "ended";

        // Fase y temporizador
        el.phase.dataset.phase = phase;
        setText(el.phaseLabel, phaseLabel(game));

        // Tu rol (solo el tuyo) junto a la fase; el infectado ve además si F está lista
        const role = game.you.role;
        el.phase.dataset.role = role ?? "none";
        setHidden(el.roleTag, role === null);
        if (role !== null) {
            let tag = ROLE_TAGS[role] ?? "";
            const st = role === "infected" ? infectStatus(game, clock, localNow) : null;
            if (st) tag += st.ready ? " · F lista" : st.secondsLeft === null ? "" : ` · ${formatMMSS(st.secondsLeft * 1000)}`;
            setText(el.roleTag, tag);
        }
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

        // Pantalla de rol: el tiempo del infectado puede llegar en el 'game' posterior al evento (mientras
        // tanto el último 'game' aún puede ser el de la cuenta regresiva)
        if (shownRole !== null) {
            if (phase === "playing" || phase === "countdown") renderRole(game);
            else closeRole();
        }

        // Pantalla de fin (desaparece al volver a open_world)
        const showEnd = phase === "ended" && renderEnd(game, ctx.selfId);
        setHidden(el.end, !showEnd);
        if (showEnd) setText(el.endBack, `Volviendo al mundo abierto en ${secondsLeft(clock.remaining(game.resultsEndsAt, localNow))} s`);
        else endSignature = "";
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
    return { update, toast, reset, showRole, closeRole, roleOpen: () => shownRole !== null };
}
