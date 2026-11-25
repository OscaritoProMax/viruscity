// Lógica PURA de la partida de Viruscity en el cliente (metodología, decisiones 7, 12 y 20).
// No toca el DOM ni el canvas: valida lo que llega del servidor y decide qué textos mostrar.
// El servidor es la autoridad: aquí solo se interpreta su último mensaje 'game'.
//
// parseServerMessage(raw)                          → { kind:'game'|'event'|'other', msg } o null si está mal formado
// parseCity(city) / parseRules(game)               → ciudad y reglas de welcome saneadas (o null)
// phaseLabel(game)                                 → "MUNDO ABIERTO" | "COMIENZA LA PARTIDA" | "PARTIDA EN CURSO" | "FIN DE LA PARTIDA"
// nearestAvailableStation(pos, missions, range)    → misión 'available' más cercana dentro del rango (o null)
// nearestPlayer(pos, players, range, selfId)       → jugador más cercano dentro del rango, sin fantasmas ni el propio
// infectStatus(game, clock, localNow)              → { ready, secondsLeft } o null si no eres un infectado en partida
//                                                    (sin infectReadyAt todavía: { ready:false, secondsLeft:null })
// eventText(event) / eventTone(event)              → frase en español y tono del aviso
// contextHint({...})                               → pista contextual de abajo al centro (o null)
// roleScreen(game, role) / endSummary(game, meId)  → contenido de las pantallas de rol y de fin

import { formatMMSS } from "./clock.js";

export const PHASES = Object.freeze(["open_world", "countdown", "playing", "ended"]);
export const MISSION_STATUSES = Object.freeze(["available", "in_progress", "done"]);
export const WINNERS = Object.freeze(["players", "infected"]);
export const END_REASONS = Object.freeze(["cure", "all_infected", "time", "no_infected", "healthy_left"]);
const ROLES = new Set(["healthy", "infected", "spectator", null]);
const RESULT_ROLES = new Set(["healthy", "infected"]);
const SLUG = /^[a-z0-9-]{1,40}$/;
const MAX_MISSIONS = 12;
const MAX_PLAYERS = 200;
const TEXT_MAX = 120;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isOptNum = (v) => v === null || v === undefined || isNum(v);
const isText = (v, max = TEXT_MAX) => typeof v === "string" && v.length >= 1 && v.length <= max;
const optReason = (v) => v === undefined || v === null || isText(v, 40);

// ---------- Validación de mensajes del servidor ----------

function parseMission(m) {
    if (!isObject(m) || !SLUG.test(m.id ?? "") || !SLUG.test(m.zoneId ?? "") || !SLUG.test(m.stationId ?? "")) return null;
    if (!isNum(m.x) || !isNum(m.y) || !isText(m.title) || !isText(m.kind, 20) || !MISSION_STATUSES.includes(m.status)) return null;
    return { id: m.id, zoneId: m.zoneId, stationId: m.stationId, x: m.x, y: m.y, title: m.title, kind: m.kind, status: m.status };
}

function parseResults(r) {
    if (!isObject(r) || !WINNERS.includes(r.winner) || !END_REASONS.includes(r.reason)) return null;
    if (!Array.isArray(r.players) || r.players.length > MAX_PLAYERS) return null;
    const players = [];
    for (const p of r.players) {
        if (!isObject(p) || !isText(p.userId, 64) || !isText(p.username, 32) || !RESULT_ROLES.has(p.role)) return null;
        players.push({ userId: p.userId, username: p.username, role: p.role });
    }
    return { winner: r.winner, reason: r.reason, players };
}

// Mensaje 'game' (decisión 20). Devuelve una copia saneada o null.
function parseGame(msg) {
    if (!isNum(msg.serverTime) || !PHASES.includes(msg.phase)) return null;
    if (!isCount(msg.minPlayers) || !isCount(msg.connected)) return null;
    if (!isNum(msg.cure) || msg.cure < 0 || msg.cure > 100) return null;
    for (const key of ["countdownEndsAt", "startedAt", "endsAt", "resultsEndsAt"]) if (!isOptNum(msg[key])) return null;
    const { phase } = msg;
    const inMatch = phase === "playing" || phase === "ended";
    if (phase === "countdown" && !isNum(msg.countdownEndsAt)) return null;
    if (inMatch && !(isNum(msg.startedAt) && isNum(msg.endsAt))) return null;
    if (phase === "ended" && !isNum(msg.resultsEndsAt)) return null;

    if (!Array.isArray(msg.missions) || msg.missions.length > MAX_MISSIONS) return null;
    const missions = [];
    for (const m of msg.missions) {
        const clean = parseMission(m);
        if (!clean) return null;
        missions.push(clean);
    }

    const you = msg.you;
    if (!isObject(you) || !ROLES.has(you.role ?? null)) return null;
    const role = you.role ?? null;
    if (inMatch !== (role !== null)) return null; // null solo en open_world y countdown
    if (!isOptNum(you.infectReadyAt) || !isOptNum(you.missionStartedAt)) return null;
    if (!(you.missionId === null || you.missionId === undefined || SLUG.test(you.missionId))) return null;

    let results = null;
    if (phase === "ended") {
        results = parseResults(msg.results);
        if (!results) return null; // ended siempre trae results
    }

    const game = {
        type: "game",
        serverTime: msg.serverTime,
        phase,
        minPlayers: msg.minPlayers,
        connected: msg.connected,
        cure: msg.cure,
        missions,
        you: {
            role,
            infectReadyAt: isNum(you.infectReadyAt) ? you.infectReadyAt : null,
            missionId: typeof you.missionId === "string" ? you.missionId : null,
            missionStartedAt: isNum(you.missionStartedAt) ? you.missionStartedAt : null,
        },
    };
    if (phase === "countdown") game.countdownEndsAt = msg.countdownEndsAt;
    if (inMatch) {
        game.startedAt = msg.startedAt;
        game.endsAt = msg.endsAt;
    }
    if (phase === "ended") {
        game.resultsEndsAt = msg.resultsEndsAt;
        game.results = results;
    }
    return game;
}

// Campos de cada kind de evento: validador por campo (los que no están en la lista se descartan)
const EVENT_FIELDS = {
    match_started: { role: (v) => RESULT_ROLES.has(v) },
    you_infected: {},
    infect_result: { ok: (v) => typeof v === "boolean", reason: optReason },
    mission_started: { missionId: (v) => SLUG.test(v ?? "") },
    mission_result: { ok: (v) => typeof v === "boolean", missionId: (v) => v === null || v === undefined || SLUG.test(v), reason: optReason },
    contagion_alert: { zone: (v) => v === null || v === undefined || isText(v, 60) },
    cure_update: { cure: (v) => isNum(v) && v >= 0 && v <= 100 },
    match_cancelled: { reason: optReason },
    match_ended: { winner: (v) => WINNERS.includes(v), reason: (v) => v === undefined || END_REASONS.includes(v) },
    player_abandoned: {}, // público: alguien no volvió a tiempo (sin nombre ni rol)
};
export const EVENT_KINDS = Object.freeze(Object.keys(EVENT_FIELDS));

function parseEvent(msg) {
    if (typeof msg.kind !== "string" || !Object.hasOwn(EVENT_FIELDS, msg.kind)) return null;
    const event = { type: "event", kind: msg.kind };
    for (const [field, valid] of Object.entries(EVENT_FIELDS[msg.kind])) {
        if (!valid(msg[field])) return null;
        if (msg[field] !== undefined) event[field] = msg[field];
    }
    return event;
}

// raw: texto JSON (event.data del WebSocket) o un objeto ya parseado
export function parseServerMessage(raw) {
    let msg = raw;
    if (typeof raw === "string") {
        try {
            msg = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!isObject(msg) || typeof msg.type !== "string") return null;
    if (msg.type === "game") {
        const game = parseGame(msg);
        return game ? { kind: "game", msg: game } : null;
    }
    if (msg.type === "event") {
        const event = parseEvent(msg);
        return event ? { kind: "event", msg: event } : null;
    }
    return { kind: "other", msg };
}

// welcome.city: { zones:[{id,name,x,y,w,h}], stations:[{id,zoneId,x,y}], plaza:{x,y} } (o null)
export function parseCity(city) {
    if (!isObject(city) || !Array.isArray(city.zones) || !Array.isArray(city.stations) || !isObject(city.plaza)) return null;
    if (city.zones.length > 20 || city.stations.length > 40 || !isNum(city.plaza.x) || !isNum(city.plaza.y)) return null;
    const zones = [];
    for (const z of city.zones) {
        if (!isObject(z) || !SLUG.test(z.id ?? "") || !isText(z.name, 60) || ![z.x, z.y, z.w, z.h].every(isNum) || z.w <= 0 || z.h <= 0) return null;
        zones.push({ id: z.id, name: z.name, x: z.x, y: z.y, w: z.w, h: z.h });
    }
    const stations = [];
    for (const s of city.stations) {
        if (!isObject(s) || !SLUG.test(s.id ?? "") || !SLUG.test(s.zoneId ?? "") || !isNum(s.x) || !isNum(s.y)) return null;
        stations.push({ id: s.id, zoneId: s.zoneId, x: s.x, y: s.y });
    }
    return { zones, stations, plaza: { x: city.plaza.x, y: city.plaza.y } };
}

// welcome.game: reglas que el cliente necesita (rangos y mínimo de jugadores); valores por defecto si faltan
export const DEFAULT_RULES = Object.freeze({ minPlayers: 3, missionMinMs: 8000, missionMaxMs: 45000, infectRange: 70, missionRange: 60 });
export function parseRules(game) {
    const rules = { ...DEFAULT_RULES };
    if (!isObject(game)) return rules;
    for (const key of Object.keys(DEFAULT_RULES)) if (isNum(game[key]) && game[key] >= 0) rules[key] = game[key];
    return rules;
}

// ---------- Textos y decisiones de la interfaz ----------

const PHASE_LABELS = { open_world: "MUNDO ABIERTO", countdown: "COMIENZA LA PARTIDA", playing: "PARTIDA EN CURSO", ended: "FIN DE LA PARTIDA" };
export function phaseLabel(game) {
    return PHASE_LABELS[game?.phase] ?? PHASE_LABELS.open_world;
}

const STATUS_LABELS = { available: "pendiente", in_progress: "en curso", done: "hecha" };
export const missionStatusLabel = (status) => STATUS_LABELS[status] ?? "";

// Nombre de la zona a partir de su id (o el id si la ciudad no la trae)
export function zoneName(city, zoneId) {
    return city?.zones?.find((z) => z.id === zoneId)?.name ?? zoneId ?? "";
}

// Porcentaje entero para mostrar: nunca "100 %" antes de que la cura esté completa
export function curePercent(cure) {
    if (!isNum(cure) || cure <= 0) return 0;
    if (cure >= 100) return 100;
    return Math.min(99, Math.round(cure));
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Misión 'available' más cercana a pos con distancia <= range (las en curso o hechas no cuentan)
export function nearestAvailableStation(pos, missions, range) {
    if (!pos || !isNum(pos.x) || !isNum(pos.y) || !isNum(range)) return null;
    let best = null;
    let bestD = Infinity;
    for (const m of missions ?? []) {
        if (m?.status !== "available" || !isNum(m.x) || !isNum(m.y)) continue;
        const d = distance(pos, m);
        if (d <= range && d < bestD) {
            best = m;
            bestD = d;
        }
    }
    return best;
}

// Jugador más cercano a pos con distancia <= range, sin fantasmas ni el propio jugador
export function nearestPlayer(pos, players, range, selfId = null) {
    if (!pos || !isNum(pos.x) || !isNum(pos.y) || !isNum(range)) return null;
    let best = null;
    let bestD = Infinity;
    for (const p of players ?? []) {
        if (!p || p.ghost === true || (selfId !== null && p.userId === selfId) || !isNum(p.x) || !isNum(p.y)) continue;
        const d = distance(pos, p);
        if (d <= range && d < bestD) {
            best = p;
            bestD = d;
        }
    }
    return best;
}

// Solo para un infectado del roster durante la partida; si no, null
export function infectStatus(game, clock, localNow) {
    if (game?.phase !== "playing" || game.you?.role !== "infected") return null;
    const readyAt = game.you.infectReadyAt;
    // Recién infectado: el bloqueo lo decide el servidor y llega en el próximo 'game'. Mientras, no está listo.
    if (!isNum(readyAt)) return { ready: false, secondsLeft: null };
    const left = clock.remaining(readyAt, localNow);
    return left > 0 ? { ready: false, secondsLeft: Math.ceil(left / 1000) } : { ready: true, secondsLeft: null };
}

// Motivos de fallo (decisión 20) en palabras del jugador
const REASON_TEXTS = {
    not_playing: "No hay una partida en curso",
    spectator: "Eres espectador hasta la próxima partida",
    not_infected: "Solo un infectado puede contagiar",
    cooldown: "Tu infección todavía no está lista",
    no_target: "No hay nadie a tu alcance",
    not_healthy: "Solo un jugador sano puede hacer misiones",
    busy: "La misión está ocupada o ya tienes otra en curso",
    not_available: "Esa misión ya no está disponible",
    too_far: "Estás demasiado lejos de la estación",
    too_fast: "Demasiado rápido: termina la misión con calma",
    expired: "Se acabó el tiempo de la misión",
    infected: "Te infectaron: perdiste tu misión",
    cancelled: "Misión cancelada",
    no_active_mission: "No tienes una misión activa",
    arbiter_unavailable: "El árbitro de la partida no está disponible. Inténtalo de nuevo",
    not_enough_players: "no quedan suficientes jugadores",
};
export const REASONS = Object.freeze(Object.keys(REASON_TEXTS));
export function reasonText(reason) {
    return REASON_TEXTS[reason] ?? "No se pudo completar la acción";
}

export function eventText(event) {
    switch (event?.kind) {
        case "match_started":
            return event.role === "infected" ? "La partida comenzó: eres el infectado" : "La partida comenzó: estás sano";
        case "you_infected":
            return "Has sido infectado";
        case "infect_result":
            return event.ok ? "Contagio exitoso" : reasonText(event.reason);
        case "mission_started":
            return "Misión iniciada: no te muevas hasta terminarla";
        case "mission_result":
            return event.ok ? "Misión completada: la cura avanza" : reasonText(event.reason);
        case "contagion_alert":
            return event.zone ? `Nuevo contagio detectado cerca de ${event.zone}` : "Nuevo contagio detectado";
        case "cure_update":
            return `Cura al ${curePercent(event.cure)} %`;
        case "match_cancelled":
            return event.reason === "not_enough_players" ? "Partida cancelada: no quedan suficientes jugadores" : "Partida cancelada";
        case "match_ended":
            if (event.reason === "no_infected") return "El infectado abandonó la partida: ganan los jugadores";
            if (event.reason === "healthy_left") return "Los sanos abandonaron la partida: ganan los infectados";
            return event.winner === "players" ? "¡La cura funcionó! Ganan los jugadores" : "La ciudad ha caído: ganan los infectados";
        case "player_abandoned":
            return "Un jugador no volvió a tiempo y abandonó la partida";
        default:
            return "";
    }
}

// Tono del aviso (color del borde): danger, infected, cure, accent o neutral
export function eventTone(event) {
    switch (event?.kind) {
        case "you_infected":
        case "contagion_alert":
            return "infected";
        case "cure_update":
            return "cure";
        case "infect_result":
        case "mission_result":
            return event.ok ? "cure" : "danger";
        case "match_cancelled":
        case "player_abandoned":
            return "danger";
        case "match_ended":
            return event.winner === "players" ? "cure" : "infected";
        case "match_started":
        case "mission_started":
            return "accent";
        default:
            return "neutral";
    }
}

// Pista contextual de abajo al centro (o null). pos: posición del jugador según el servidor.
export function contextHint({ game, clock, localNow, pos, players, selfId, city, rules }) {
    if (!game) return null;
    const r = rules ?? DEFAULT_RULES;
    if (game.phase === "open_world") {
        const need = Math.max(0, game.minPlayers - game.connected);
        if (need === 0) return null;
        return need === 1 ? "Mundo abierto: falta 1 jugador para empezar" : `Mundo abierto: faltan ${need} jugadores para empezar`;
    }
    if (game.phase !== "playing") return null;
    const role = game.you.role;
    if (role === "spectator") return "Eres espectador hasta la próxima partida";
    if (role === "healthy") {
        if (game.you.missionId) {
            const m = game.missions.find((x) => x.id === game.you.missionId);
            return m ? `Misión en curso en ${zoneName(city, m.zoneId)}` : "Misión en curso";
        }
        const station = nearestAvailableStation(pos, game.missions, r.missionRange);
        return station ? `E: iniciar misión en ${zoneName(city, station.zoneId)}` : null;
    }
    if (role === "infected") {
        const st = infectStatus(game, clock, localNow);
        if (st && !st.ready) return st.secondsLeft === null ? null : `Infección disponible en ${formatMMSS(st.secondsLeft * 1000)}`;
        return nearestPlayer(pos, players, r.infectRange, selfId) ? "F: infectar" : null;
    }
    return null;
}

// Pantalla de rol al empezar la partida. El tiempo del infectado sale de infectReadyAt − startedAt
// (INITIAL_LOCK_MS del servidor); si aún no llegó el game de la partida, no se muestra la cifra.
export function roleScreen(game, role) {
    if (role === "infected") {
        const lock = game?.phase === "playing" && isNum(game.you?.infectReadyAt) && isNum(game.startedAt) ? game.you.infectReadyAt - game.startedAt : null;
        const when = lock === null ? "" : ` Podrás infectar en ${formatMMSS(lock)}.`;
        return { tone: "infected", title: "ERES EL INFECTADO", text: `Contagia a los demás sin que te descubran.${when}` };
    }
    return { tone: "healthy", title: "ESTÁS SANO", text: "Completa misiones para fabricar la cura y descubre quién está infectado." };
}

const END_REASON_TEXTS = {
    cure: "La cura se completó",
    all_infected: "Todos los jugadores están infectados",
    time: "Se agotó el tiempo",
    no_infected: "El infectado abandonó la partida",
    healthy_left: "Los sanos abandonaron la partida",
};
export const endReasonText = (reason) => END_REASON_TEXTS[reason] ?? "";

// Pantalla de fin: título, motivo, ganaste/perdiste y tabla de roles (null si no hay results)
export function endSummary(game, selfId) {
    const results = game?.phase === "ended" ? game.results : null;
    if (!results) return null;
    const players = results.winner === "players";
    const mine = results.players.find((p) => p.userId === selfId)?.role ?? game.you?.role ?? null;
    let outcome = "Fuiste espectador en esta partida"; // fuera del roster: ni ganó ni perdió
    if (mine === "healthy" || mine === "infected") outcome = (mine === "healthy") === players ? "Ganaste" : "Perdiste";
    return {
        tone: players ? "cure" : "infected",
        title: players ? "¡LA CURA FUNCIONÓ!" : "LA CIUDAD HA CAÍDO",
        reason: endReasonText(results.reason),
        outcome,
        rows: results.players.map((p) => ({ username: p.username, role: p.role === "infected" ? "Infectado" : "Sano", you: p.userId === selfId })),
    };
}
