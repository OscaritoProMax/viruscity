// Partida de Viruscity: reducer PURO (metodología VIRUSCITY, decisiones 1-15 y 20).
// No conoce sockets, temporizadores ni el mesh: recibe el estado y un contexto con el reloj (ctx.now), los
// jugadores conectados con su posición (ctx.players), la configuración (ctx.cfg), la ciudad (ctx.city) y el
// generador aleatorio (ctx.rng), y devuelve un estado NUEVO. Nunca modifica el estado de entrada.
//
// createMatchState()                        → estado inicial (open_world)
// advance(state, ctx)                       → { state, events, changed }   paso del tiempo y de las conexiones
// applyAction(state, userId, action, ctx)   → { state, events, changed }   infect / mission_start / _complete / _cancel
// buildClientView(state, userId, ctx)       → mensaje 'game' personalizado (sin información oculta)
// frozenUserIds(state)                      → Set de userId con una misión en curso (el servidor no los mueve)
// isGhost(state, userId)                    → true si se juega y el usuario no está en el roster (espectador)
// plazaSpawns(state, city)                  → { [userId]: { x, y } } en círculo alrededor de la plaza
//
// Si nada cambió, advance/applyAction devuelven el MISMO objeto con changed:false. Si algo cambió, el estado
// nuevo tiene rev + 1. Cada evento lleva eid creciente (state.eid, que no se reinicia entre partidas) y, si es
// personal, to (userId). Un intento fallido no cambia el juego (roster, misiones, cura) salvo la liberación de
// misión indicada, pero sí avanza eid y rev, porque su evento de resultado tiene que viajar por el clúster.
"use strict";

const { buildCity, zoneNear } = require("./city.js");
const { pickMissions, KINDS } = require("./missions.js");

const ACTION_KINDS = new Set(["infect", "mission_start", "mission_complete", "mission_cancel"]);
const PLAZA_RADIUS = 80; // radio del círculo de aparición al empezar la partida (decisión 3)
const MIN_ROSTER = 2; // con menos personas en el roster la partida se cancela (decisión 14)
const MAX_MISSIONS = 12;
const CURE_FULL = 100;

// ---------- Estado ----------

function createMatchState() {
    return {
        phase: "open_world",
        matchId: 0,
        rev: 0,
        eid: 0,
        countdownEndsAt: null,
        startedAt: null,
        endsAt: null,
        resultsEndsAt: null,
        roster: {}, // userId -> { username, role:'healthy'|'infected', infectReadyAt, connected, disconnectedAt }
        missions: [], // [{ id, zoneId, stationId, x, y, title, kind, status, by, startedAt }]
        cure: 0,
        results: null,
    };
}

// Vuelve al mundo abierto sin roles, misiones ni cura. matchId, eid y rev se conservan.
function resetToOpenWorld(s) {
    s.phase = "open_world";
    s.countdownEndsAt = null;
    s.startedAt = null;
    s.endsAt = null;
    s.resultsEndsAt = null;
    s.roster = {};
    s.missions = [];
    s.cure = 0;
    s.results = null;
}

// ---------- Utilidades ----------

// El roster usa userId como clave: se lee solo con propiedades propias y se escribe con defineProperty,
// así un userId como "__proto__" no puede alterar el prototipo del objeto.
const member = (roster, userId) => (Object.hasOwn(roster, userId) ? roster[userId] : undefined);
function setMember(roster, userId, value) {
    Object.defineProperty(roster, userId, { value, enumerable: true, writable: true, configurable: true });
}

const byUserId = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // orden determinista (de strings)
const sortedIds = (roster) => Object.keys(roster).sort(byUserId);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round2 = (v) => Math.round(v * 100) / 100;

// Jugadores conectados ahora: userId (string) -> { userId, username, x, y }
function onlineMap(ctx) {
    const map = new Map();
    for (const p of ctx.players ?? []) {
        if (p && p.userId !== undefined && p.userId !== null) map.set(String(p.userId), p);
    }
    return map;
}

const cityOf = (ctx) => ctx.city ?? buildCity({ width: ctx.cfg.WORLD_WIDTH, height: ctx.cfg.WORLD_HEIGHT });
const missionReach = (cfg) => cfg.MISSION_RANGE + cfg.RANGE_TOLERANCE;
const infectReach = (cfg) => cfg.INFECT_RANGE + cfg.RANGE_TOLERANCE;

// Misión en curso de un jugador (o null)
const activeMission = (state, userId) => state.missions.find((m) => m.status === "in_progress" && m.by === userId) ?? null;

// ---------- Borrador: copia de trabajo + eventos ----------
// Se trabaja sobre una copia profunda; el original nunca se toca. dirty indica si algo cambió.

function draft(state) {
    return { s: structuredClone(state), events: [], dirty: false };
}

function touch(d) {
    d.dirty = true;
}

function emit(d, kind, fields = {}, to) {
    d.s.eid += 1;
    const event = { eid: d.s.eid, kind, ...fields };
    if (to !== undefined) event.to = to;
    d.events.push(event);
    touch(d);
}

function finish(state, d) {
    if (!d.dirty) return { state, events: [], changed: false };
    d.s.rev = state.rev + 1;
    return { state: d.s, events: d.events, changed: true };
}

function release(d, mission) {
    mission.status = "available";
    mission.by = null;
    mission.startedAt = null;
    touch(d);
}

// ---------- Inicio y fin de la partida ----------

function startMatch(d, ctx, online) {
    const { now, cfg } = ctx;
    const rng = ctx.rng ?? Math.random;
    const s = d.s;
    const ids = [...online.keys()].sort(byUserId);
    const infectedIndex = Math.min(ids.length - 1, Math.floor(rng() * ids.length));

    s.roster = {};
    ids.forEach((userId, i) => {
        const infected = i === infectedIndex;
        setMember(s.roster, userId, {
            username: String(online.get(userId).username ?? ""),
            role: infected ? "infected" : "healthy",
            infectReadyAt: infected ? now + cfg.INITIAL_LOCK_MS : null,
            connected: true,
            disconnectedAt: null,
        });
    });

    // M = min(12, 3 × (roster − 1)) misiones compartidas, cada una en su estación de la ciudad
    const stations = new Map(cityOf(ctx).stations.map((st) => [st.id, st]));
    const count = Math.min(MAX_MISSIONS, 3 * (ids.length - 1));
    s.missions = pickMissions(count, rng).map((def) => {
        const st = stations.get(def.stationId);
        return { id: def.id, zoneId: def.zoneId, stationId: def.stationId, x: st ? st.x : 0, y: st ? st.y : 0, title: def.title, kind: def.kind, status: "available", by: null, startedAt: null };
    });

    s.phase = "playing";
    s.matchId += 1;
    s.countdownEndsAt = null;
    s.startedAt = now;
    s.endsAt = now + cfg.MATCH_DURATION_MS;
    s.resultsEndsAt = null;
    s.cure = 0;
    s.results = null;
    touch(d);
    for (const userId of ids) emit(d, "match_started", { role: member(s.roster, userId).role }, userId);
}

function endMatch(d, winner, reason, now, cfg) {
    const s = d.s;
    for (const m of s.missions) if (m.status === "in_progress") release(d, m); // nadie queda inmóvil
    s.phase = "ended";
    s.results = {
        winner,
        reason,
        players: sortedIds(s.roster).map((userId) => ({ userId, username: s.roster[userId].username, role: s.roster[userId].role })),
        endedAt: now,
    };
    s.resultsEndsAt = now + cfg.RESULTS_MS;
    touch(d);
    emit(d, "match_ended", { winner });
}

// Condiciones de victoria en orden: cura, sin sanos, sin infectados, tiempo. true si la partida terminó.
function evaluateVictory(d, now, cfg) {
    const s = d.s;
    if (s.phase !== "playing") return false;
    const roles = Object.values(s.roster).map((m) => m.role);
    if (s.cure >= CURE_FULL) endMatch(d, "players", "cure", now, cfg);
    else if (!roles.includes("healthy")) endMatch(d, "infected", "all_infected", now, cfg);
    else if (!roles.includes("infected")) endMatch(d, "players", "no_infected", now, cfg);
    else if (now >= s.endsAt) endMatch(d, "infected", "time", now, cfg);
    else return false;
    return true;
}

// ---------- advance: paso del tiempo y de las conexiones ----------

// (1) Conectado / desconectado según ctx.players. Quien se desconecta pierde su misión de inmediato.
function syncRoster(d, online, now) {
    const s = d.s;
    for (const userId of Object.keys(s.roster)) {
        const m = s.roster[userId];
        const isOnline = online.has(userId);
        if (isOnline && !m.connected) {
            m.connected = true;
            m.disconnectedAt = null;
            touch(d);
        } else if (!isOnline && m.connected) {
            m.connected = false;
            m.disconnectedAt = now;
            touch(d);
            const mission = activeMission(s, userId);
            if (mission) release(d, mission);
        }
    }
}

function tickPlaying(d, ctx, online) {
    const { now, cfg } = ctx;
    const s = d.s;

    // Bajas: desconectados por más de RECONNECT_GRACE_MS salen del roster
    for (const userId of Object.keys(s.roster)) {
        const m = s.roster[userId];
        if (!m.connected && now - m.disconnectedAt > cfg.RECONNECT_GRACE_MS) {
            delete s.roster[userId];
            touch(d);
        }
    }

    // Misiones en curso: expiran a los MISSION_MAX_MS o se liberan si el jugador se aleja
    for (const mission of s.missions) {
        if (mission.status !== "in_progress") continue;
        const userId = mission.by;
        if (now - mission.startedAt > cfg.MISSION_MAX_MS) {
            release(d, mission);
            emit(d, "mission_result", { ok: false, missionId: mission.id, reason: "expired" }, userId);
            continue;
        }
        const p = online.get(userId);
        if (!p || dist(p, mission) > missionReach(cfg)) {
            release(d, mission);
            emit(d, "mission_result", { ok: false, missionId: mission.id, reason: "too_far" }, userId);
        }
    }

    // Con menos de 2 personas en el roster (conectadas o en gracia) la partida se cancela
    if (Object.keys(s.roster).length < MIN_ROSTER) {
        resetToOpenWorld(s);
        touch(d);
        emit(d, "match_cancelled", { reason: "not_enough_players" });
        return;
    }

    evaluateVictory(d, now, cfg);
}

function advance(state, ctx) {
    const { now, cfg } = ctx;
    const d = draft(state);
    const s = d.s;
    const online = onlineMap(ctx);

    if (s.phase === "playing") syncRoster(d, online, now);

    switch (s.phase) {
        case "open_world":
            if (online.size >= cfg.MIN_PLAYERS_TO_START) {
                s.phase = "countdown";
                s.countdownEndsAt = now + cfg.MATCH_COUNTDOWN_MS;
                touch(d);
            }
            break;
        case "countdown":
            if (online.size < cfg.MIN_PLAYERS_TO_START) {
                resetToOpenWorld(s);
                touch(d);
            } else if (now >= s.countdownEndsAt) {
                startMatch(d, ctx, online);
            }
            break;
        case "playing":
            tickPlaying(d, ctx, online);
            break;
        case "ended":
            if (now >= s.resultsEndsAt) {
                resetToOpenWorld(s);
                touch(d);
            }
            break;
        default:
            break;
    }
    return finish(state, d);
}

// ---------- applyAction: acciones de un jugador ----------

function doInfect(d, userId, me, ctx, online) {
    const { now, cfg } = ctx;
    const s = d.s;
    const fail = (reason) => emit(d, "infect_result", { ok: false, reason }, userId);

    if (me.role !== "infected") return fail("not_infected");
    if (me.infectReadyAt !== null && me.infectReadyAt > now) return fail("cooldown");
    const pos = online.get(userId);
    if (!pos) return fail("no_target");

    // El SANO del roster más cercano dentro del alcance (empate: menor userId)
    let victimId = null;
    let best = Infinity;
    for (const id of sortedIds(s.roster)) {
        if (id === userId || s.roster[id].role !== "healthy") continue;
        const p = online.get(id);
        if (!p) continue;
        const dd = dist(pos, p);
        if (dd <= infectReach(cfg) && dd < best) {
            best = dd;
            victimId = id;
        }
    }
    if (victimId === null) return fail("no_target"); // no consume el enfriamiento

    const victim = s.roster[victimId];
    victim.role = "infected";
    victim.infectReadyAt = now + cfg.NEW_INFECTED_LOCK_MS;
    const lost = activeMission(s, victimId);
    if (lost) {
        release(d, lost);
        emit(d, "mission_result", { ok: false, missionId: lost.id, reason: "infected" }, victimId);
    }
    me.infectReadyAt = now + cfg.INFECT_COOLDOWN_MS;
    touch(d);

    emit(d, "you_infected", {}, victimId);
    emit(d, "infect_result", { ok: true }, userId);
    const vp = online.get(victimId);
    emit(d, "contagion_alert", { zone: zoneNear(cityOf(ctx), vp.x, vp.y) }); // pública: solo la zona
    evaluateVictory(d, now, cfg);
}

function doMissionStart(d, userId, me, missionId, ctx, online) {
    const { now, cfg } = ctx;
    const s = d.s;
    const fail = (reason) => emit(d, "mission_result", { ok: false, missionId, reason }, userId);

    if (me.role !== "healthy") return fail("not_healthy");
    const mission = s.missions.find((m) => m.id === missionId);
    if (!mission || mission.status === "done") return fail("not_available");
    if (mission.status === "in_progress") return fail("busy");
    if (activeMission(s, userId)) return fail("busy"); // ya tiene otra misión
    const pos = online.get(userId);
    if (!pos || dist(pos, mission) > missionReach(cfg)) return fail("too_far");

    mission.status = "in_progress";
    mission.by = userId;
    mission.startedAt = now;
    touch(d);
    emit(d, "mission_started", { missionId: mission.id }, userId);
}

function doMissionComplete(d, userId, me, missionId, ctx, online) {
    const { now, cfg } = ctx;
    const s = d.s;
    const mission = activeMission(s, userId);
    const fail = (reason, id = mission ? mission.id : missionId) => emit(d, "mission_result", { ok: false, missionId: id, reason }, userId);

    if (!mission || (missionId !== null && missionId !== mission.id)) return fail("no_active_mission", missionId);
    if (me.role !== "healthy") return fail("not_healthy");
    const elapsed = now - mission.startedAt;
    if (elapsed < cfg.MISSION_MIN_MS) return fail("too_fast"); // sigue en curso
    if (elapsed > cfg.MISSION_MAX_MS) {
        release(d, mission);
        return fail("expired");
    }
    const pos = online.get(userId);
    if (!pos || dist(pos, mission) > missionReach(cfg)) {
        release(d, mission);
        return fail("too_far");
    }

    mission.status = "done";
    mission.by = null;
    mission.startedAt = null;
    // La cura se calcula con el número de misiones hechas: la última deja exactamente 100
    const done = s.missions.filter((m) => m.status === "done").length;
    s.cure = done >= s.missions.length ? CURE_FULL : (done * CURE_FULL) / s.missions.length;
    touch(d);
    emit(d, "mission_result", { ok: true, missionId: mission.id }, userId);
    emit(d, "cure_update", { cure: s.cure });
    evaluateVictory(d, now, cfg);
}

function doMissionCancel(d, userId, missionId) {
    const s = d.s;
    const mission = activeMission(s, userId);
    if (!mission || (missionId !== null && missionId !== mission.id)) {
        return emit(d, "mission_result", { ok: false, missionId, reason: "no_active_mission" }, userId);
    }
    release(d, mission);
    emit(d, "mission_result", { ok: false, missionId: mission.id, reason: "cancelled" }, userId);
}

function applyAction(state, userId, action, ctx) {
    const kind = action?.kind;
    if (!ACTION_KINDS.has(kind)) return { state, events: [], changed: false }; // ya validado afuera: se ignora
    const id = String(userId);
    const missionId = typeof action.missionId === "string" ? action.missionId : null;
    const d = draft(state);
    const s = d.s;
    const online = onlineMap(ctx);

    const resultKind = kind === "infect" ? "infect_result" : "mission_result";
    const fail = (reason) => emit(d, resultKind, kind === "infect" ? { ok: false, reason } : { ok: false, missionId, reason }, id);

    const me = member(s.roster, id);
    if (s.phase !== "playing") fail("not_playing");
    else if (!me) fail("spectator");
    else if (kind === "infect") doInfect(d, id, me, ctx, online);
    else if (kind === "mission_start") doMissionStart(d, id, me, missionId, ctx, online);
    else if (kind === "mission_complete") doMissionComplete(d, id, me, missionId, ctx, online);
    else doMissionCancel(d, id, missionId);

    return finish(state, d);
}

// ---------- Consultas para la simulación ----------

// Jugadores con una misión en curso: quedan inmóviles (el servidor ignora su movimiento)
function frozenUserIds(state) {
    const set = new Set();
    if (state.phase !== "playing") return set;
    for (const m of state.missions) if (m.status === "in_progress" && m.by !== null) set.add(m.by);
    return set;
}

// Espectador ("fantasma"): se está jugando y no está en el roster
function isGhost(state, userId) {
    return state.phase === "playing" && !Object.hasOwn(state.roster, String(userId));
}

// Puntos de aparición en círculo de radio 80 alrededor de la plaza, ordenados por userId (determinista)
function plazaSpawns(state, city) {
    const ids = sortedIds(state.roster);
    const out = {};
    ids.forEach((userId, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / ids.length;
        setMember(out, userId, { x: round2(city.plaza.x + PLAZA_RADIUS * Math.cos(angle)), y: round2(city.plaza.y + PLAZA_RADIUS * Math.sin(angle)) });
    });
    return out;
}

// ---------- Vistas personalizadas (decisiones 7 y 20) ----------
// Información oculta: la vista de un jugador solo lleva SU rol. No incluye el roster, ni quién hace cada
// misión (sin 'by'), ni roles ajenos; los roles de todos aparecen solo en results, durante 'ended'.

// Lista pública de misiones: zona, título, tipo, posición y estado; NUNCA quién la hace
const publicMission = (m) => ({ id: m.id, zoneId: m.zoneId, stationId: m.stationId, x: m.x, y: m.y, title: m.title, kind: m.kind, status: m.status });

// ctx = { now, connected (jugadores conectados en todo el clúster), cfg }
function buildClientView(state, userId, ctx) {
    const id = String(userId);
    const { phase } = state;
    const inMatch = phase === "playing" || phase === "ended";
    const me = inMatch ? member(state.roster, id) : undefined;
    const mission = phase === "playing" ? activeMission(state, id) : null;

    const view = {
        type: "game",
        serverTime: ctx.now,
        phase,
        minPlayers: ctx.cfg.MIN_PLAYERS_TO_START,
        connected: Number.isFinite(ctx.connected) ? ctx.connected : 0,
    };
    if (phase === "countdown") view.countdownEndsAt = state.countdownEndsAt;
    if (inMatch) {
        view.startedAt = state.startedAt;
        view.endsAt = state.endsAt;
    }
    if (phase === "ended") view.resultsEndsAt = state.resultsEndsAt;
    view.cure = state.cure;
    view.missions = state.missions.map(publicMission);
    view.you = {
        role: !inMatch ? null : me ? me.role : "spectator", // null en open_world y countdown
        infectReadyAt: phase === "playing" && me?.role === "infected" ? me.infectReadyAt : null,
        missionId: mission ? mission.id : null,
        missionStartedAt: mission ? mission.startedAt : null,
    };
    if (phase === "ended" && state.results) {
        view.results = {
            winner: state.results.winner,
            reason: state.results.reason,
            players: state.results.players.map((p) => ({ userId: p.userId, username: p.username, role: p.role })),
        };
    }
    return view;
}

// ---------- Validación del estado replicado (V3) ----------
// validateMatchState(obj) → { ok:true, match } con una COPIA saneada (solo campos conocidos, objetos nuevos)
// | { ok:false, reason }. Lo usa el mesh antes de adoptar un game_state de otro coordinador.

const PHASES = new Set(["open_world", "countdown", "playing", "ended"]);
const ROLES = new Set(["healthy", "infected"]);
const MISSION_STATUSES = new Set(["available", "in_progress", "done"]);
const WINNERS = new Set(["players", "infected"]);
const REASONS = new Set(["cure", "all_infected", "time", "no_infected"]);
const MAX_ROSTER = 200;
const USER_ID_MAX = 64;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const SLUG_REGEX = /^[a-z0-9-]{1,40}$/; // ids de misión, estación y zona
const TITLE_MAX = 120;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isTime = (v) => typeof v === "number" && Number.isFinite(v);
const isOptTime = (v) => v === null || isTime(v);
const isUserId = (v) => typeof v === "string" && v.length >= 1 && v.length <= USER_ID_MAX;
const isUsername = (v) => typeof v === "string" && USERNAME_REGEX.test(v);

function validateMatchState(obj) {
    const fail = (reason) => ({ ok: false, reason });
    if (!isPlainObject(obj)) return fail("match debe ser un objeto");
    if (!PHASES.has(obj.phase)) return fail("phase inválida");
    for (const key of ["matchId", "rev", "eid"]) if (!isCount(obj[key])) return fail(`${key} debe ser un entero >= 0`);
    for (const key of ["countdownEndsAt", "startedAt", "endsAt", "resultsEndsAt"]) if (!isOptTime(obj[key])) return fail(`${key} inválido`);
    if (obj.phase === "countdown" && !isTime(obj.countdownEndsAt)) return fail("countdown sin countdownEndsAt");
    if ((obj.phase === "playing" || obj.phase === "ended") && !(isTime(obj.startedAt) && isTime(obj.endsAt))) return fail("partida sin startedAt/endsAt");
    if (obj.phase === "ended" && !isTime(obj.resultsEndsAt)) return fail("ended sin resultsEndsAt");

    // Roster: objeto userId → miembro, como mucho MAX_ROSTER
    if (!isPlainObject(obj.roster)) return fail("roster debe ser un objeto");
    const ids = Object.keys(obj.roster);
    if (ids.length > MAX_ROSTER) return fail(`roster de más de ${MAX_ROSTER} jugadores`);
    const roster = {};
    for (const userId of ids) {
        const m = obj.roster[userId];
        if (!isUserId(userId) || !isPlainObject(m)) return fail("miembro del roster inválido");
        if (!isUsername(m.username) || !ROLES.has(m.role) || !isOptTime(m.infectReadyAt) || typeof m.connected !== "boolean" || !isOptTime(m.disconnectedAt)) {
            return fail("miembro del roster inválido");
        }
        setMember(roster, userId, { username: m.username, role: m.role, infectReadyAt: m.infectReadyAt, connected: m.connected, disconnectedAt: m.disconnectedAt });
    }

    // Misiones: como mucho 12, ids únicos, posición finita y estado coherente con quién la hace
    if (!Array.isArray(obj.missions) || obj.missions.length > MAX_MISSIONS) return fail(`missions debe ser una lista de hasta ${MAX_MISSIONS}`);
    const seen = new Set();
    const missions = [];
    for (const m of obj.missions) {
        if (!isPlainObject(m) || !SLUG_REGEX.test(m.id ?? "") || seen.has(m.id)) return fail("misión inválida o repetida");
        seen.add(m.id);
        if (!SLUG_REGEX.test(m.zoneId ?? "") || !SLUG_REGEX.test(m.stationId ?? "") || !isTime(m.x) || !isTime(m.y)) return fail("misión con zona, estación o posición inválida");
        if (typeof m.title !== "string" || m.title.length > TITLE_MAX || !KINDS.includes(m.kind) || !MISSION_STATUSES.has(m.status)) return fail("misión con título, tipo o estado inválido");
        const busy = m.status === "in_progress";
        if (busy ? !(isUserId(m.by) && isTime(m.startedAt)) : !(m.by === null && m.startedAt === null)) return fail("misión con by/startedAt incoherente");
        missions.push({ id: m.id, zoneId: m.zoneId, stationId: m.stationId, x: m.x, y: m.y, title: m.title, kind: m.kind, status: m.status, by: m.by, startedAt: m.startedAt });
    }

    if (!isTime(obj.cure) || obj.cure < 0 || obj.cure > CURE_FULL) return fail("cure debe estar entre 0 y 100");

    // Resultados: solo en 'ended' (y siempre en 'ended')
    let results = null;
    if (obj.results !== null) {
        const r = obj.results;
        if (!isPlainObject(r) || !WINNERS.has(r.winner) || !REASONS.has(r.reason) || !isTime(r.endedAt)) return fail("results inválido");
        if (!Array.isArray(r.players) || r.players.length > MAX_ROSTER) return fail("results.players inválido");
        const players = [];
        for (const p of r.players) {
            if (!isPlainObject(p) || !isUserId(p.userId) || !isUsername(p.username) || !ROLES.has(p.role)) return fail("results.players inválido");
            players.push({ userId: p.userId, username: p.username, role: p.role });
        }
        results = { winner: r.winner, reason: r.reason, players, endedAt: r.endedAt };
    }
    if ((obj.phase === "ended") !== (results !== null)) return fail("results solo (y siempre) en ended");

    return {
        ok: true,
        match: {
            phase: obj.phase,
            matchId: obj.matchId,
            rev: obj.rev,
            eid: obj.eid,
            countdownEndsAt: obj.countdownEndsAt,
            startedAt: obj.startedAt,
            endsAt: obj.endsAt,
            resultsEndsAt: obj.resultsEndsAt,
            roster,
            missions,
            cure: obj.cure,
            results,
        },
    };
}

module.exports = {
    PLAZA_RADIUS,
    validateMatchState,
    createMatchState,
    advance,
    applyAction,
    frozenUserIds,
    isGhost,
    plazaSpawns,
    buildClientView,
};
