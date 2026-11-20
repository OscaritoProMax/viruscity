// Pruebas de la lógica pura de la partida en el cliente (js/vc/view.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseServerMessage, parseCity, parseRules, phaseLabel, nearestAvailableStation, nearestPlayer, infectStatus,
    eventText, eventTone, reasonText, contextHint, roleScreen, endSummary, curePercent, missionStatusLabel,
    EVENT_KINDS, REASONS, DEFAULT_RULES,
} from "../public/js/vc/view.js";
import { createClock } from "../public/js/vc/clock.js";

// ---------- Datos de ejemplo (como los arma buildClientView en el coordinador) ----------

const mission = (id, status, x = 100, y = 100, zoneId = id.split("-")[0]) => ({ id, zoneId, stationId: id, x, y, title: `Misión ${id}`, kind: "hold", status });

function game(phase, extra = {}) {
    const g = { type: "game", serverTime: 1_000_000, phase, minPlayers: 3, connected: 2, cure: 0, missions: [], you: { role: null, infectReadyAt: null, missionId: null, missionStartedAt: null } };
    if (phase === "countdown") g.countdownEndsAt = 1_010_000;
    if (phase === "playing" || phase === "ended") {
        g.startedAt = 990_000;
        g.endsAt = 1_890_000;
        g.you = { ...g.you, role: "healthy" };
        g.missions = [mission("hospital-1", "available"), mission("farmacia-2", "in_progress", 400, 100), mission("almacen-1", "done", 900, 600)];
        g.cure = 33.33;
    }
    if (phase === "ended") {
        g.resultsEndsAt = 1_015_000;
        g.results = { winner: "players", reason: "cure", players: [{ userId: "1", username: "ana", role: "healthy" }, { userId: "2", username: "beto", role: "infected" }] };
    }
    return { ...g, ...extra, you: { ...g.you, ...(extra.you ?? {}) } };
}

const CITY = {
    zones: [{ id: "hospital", name: "Hospital", x: 100, y: 100, w: 210, h: 150 }, { id: "farmacia", name: "Farmacia", x: 870, y: 100, w: 200, h: 150 }],
    stations: [{ id: "hospital-1", zoneId: "hospital", x: 152.5, y: 52 }],
    plaza: { x: 600, y: 400 },
};

// ---------- parseServerMessage ----------

test("parseServerMessage: game válido en las 4 fases (texto JSON u objeto) y copia saneada", () => {
    for (const phase of ["open_world", "countdown", "playing", "ended"]) {
        const g = game(phase);
        const parsed = parseServerMessage(JSON.stringify(g));
        assert.equal(parsed?.kind, "game", phase);
        assert.deepEqual(parsed.msg, g, phase);
        assert.deepEqual(parseServerMessage(g).msg, g);
    }
    // Campos desconocidos y results fuera de lugar se descartan sin rechazar
    const dirty = { ...game("playing"), hack: 1, results: { winner: "players" } };
    dirty.missions = dirty.missions.map((m) => ({ ...m, by: "secreto" }));
    const clean = parseServerMessage(dirty).msg;
    assert.equal("hack" in clean, false);
    assert.equal("results" in clean, false);
    assert.equal("by" in clean.missions[0], false, "nunca quién hace la misión");
});

test("parseServerMessage: game mal formado → null", () => {
    const bad = (mutate, why) => {
        const g = structuredClone(game("playing"));
        mutate(g);
        assert.equal(parseServerMessage(g), null, why);
    };
    bad((g) => (g.phase = "jugando"), "fase fuera del enum");
    bad((g) => (g.cure = 150), "cure > 100");
    bad((g) => (g.cure = -1), "cure < 0");
    bad((g) => (g.cure = "50"), "cure texto");
    bad((g) => (g.serverTime = null), "sin serverTime");
    bad((g) => (g.connected = -1), "connected negativo");
    bad((g) => (g.minPlayers = 2.5), "minPlayers no entero");
    bad((g) => (g.you.role = "zombie"), "role inválido");
    bad((g) => (g.you.role = null), "role null en playing");
    bad((g) => delete g.you, "sin you");
    bad((g) => (g.you.infectReadyAt = "pronto"), "infectReadyAt texto");
    bad((g) => (g.you.missionId = "<b>"), "missionId fuera del patrón");
    bad((g) => (g.missions = "x"), "missions no es lista");
    bad((g) => (g.missions[0].status = "hecha"), "status inválido");
    bad((g) => (g.missions[0].x = "10"), "x no numérica");
    bad((g) => (g.missions[0].id = "Mayúsculas"), "id fuera del patrón");
    bad((g) => (g.missions[0].title = ""), "título vacío");
    bad((g) => (g.missions = Array.from({ length: 13 }, (_, i) => mission(`m-${i}`, "available"))), "más de 12 misiones");
    bad((g) => delete g.endsAt, "playing sin endsAt");
    const countdown = game("countdown");
    delete countdown.countdownEndsAt;
    assert.equal(parseServerMessage(countdown), null, "countdown sin countdownEndsAt");
    assert.equal(parseServerMessage(game("open_world", { you: { role: "healthy" } })), null, "rol fuera de partida");
    const ended = game("ended");
    assert.equal(parseServerMessage({ ...ended, results: undefined }), null, "ended sin results");
    assert.equal(parseServerMessage({ ...ended, results: { ...ended.results, winner: "nadie" } }), null, "winner inválido");
    assert.equal(parseServerMessage({ ...ended, results: { ...ended.results, reason: "magia" } }), null, "reason inválido");
    assert.equal(parseServerMessage({ ...ended, results: { ...ended.results, players: [{ userId: "1", username: "ana", role: "spectator" }] } }), null, "rol de results inválido");
    assert.equal(parseServerMessage({ ...ended, resultsEndsAt: undefined }), null, "ended sin resultsEndsAt");
});

test("parseServerMessage: event válido de cada kind y campos de más descartados", () => {
    const samples = {
        match_started: { role: "infected" },
        you_infected: {},
        infect_result: { ok: false, reason: "cooldown" },
        mission_started: { missionId: "hospital-1" },
        mission_result: { ok: true, missionId: "hospital-1" },
        contagion_alert: { zone: "Farmacia" },
        cure_update: { cure: 50 },
        match_cancelled: { reason: "not_enough_players" },
        match_ended: { winner: "infected" },
    };
    assert.deepEqual(Object.keys(samples).sort(), [...EVENT_KINDS].sort(), "todos los kinds del contrato");
    for (const [kind, fields] of Object.entries(samples)) {
        const parsed = parseServerMessage(JSON.stringify({ type: "event", kind, ...fields, eid: 7, to: "1", extra: "x" }));
        assert.equal(parsed?.kind, "event", kind);
        assert.deepEqual(parsed.msg, { type: "event", kind, ...fields }, kind);
    }
    // mission_result de arbiter_unavailable llega con missionId null
    assert.equal(parseServerMessage({ type: "event", kind: "mission_result", ok: false, missionId: null, reason: "arbiter_unavailable" })?.kind, "event");
});

test("parseServerMessage: event mal formado → null; otros tipos → other; basura → null", () => {
    for (const bad of [
        { type: "event", kind: "baile" },
        { type: "event", kind: "__proto__" },
        { type: "event" },
        { type: "event", kind: "match_started", role: "spectator" },
        { type: "event", kind: "infect_result", ok: "si" },
        { type: "event", kind: "mission_started" },
        { type: "event", kind: "mission_started", missionId: "../x" },
        { type: "event", kind: "cure_update", cure: 101 },
        { type: "event", kind: "match_ended", winner: "nadie" },
        { type: "event", kind: "contagion_alert", zone: 5 },
    ]) assert.equal(parseServerMessage(bad), null, JSON.stringify(bad));
    assert.deepEqual(parseServerMessage('{"type":"state","t":1,"players":[]}'), { kind: "other", msg: { type: "state", t: 1, players: [] } });
    for (const junk of ["no es json", "null", "[1,2]", "42", '{"sin":"type"}', null, undefined, 7]) assert.equal(parseServerMessage(junk), null, String(junk));
});

test("parseCity y parseRules", () => {
    assert.deepEqual(parseCity(CITY), CITY);
    assert.equal(parseCity(null), null);
    assert.equal(parseCity({ ...CITY, plaza: null }), null);
    assert.equal(parseCity({ ...CITY, zones: [{ ...CITY.zones[0], w: -1 }] }), null);
    assert.equal(parseCity({ ...CITY, stations: [{ id: "x", zoneId: "y", x: "1", y: 2 }] }), null);
    assert.deepEqual(parseRules(undefined), DEFAULT_RULES);
    assert.deepEqual(parseRules({ minPlayers: 4, infectRange: "70", missionRange: -1 }), { ...DEFAULT_RULES, minPlayers: 4 });
});

// ---------- Textos ----------

test("phaseLabel, missionStatusLabel y curePercent", () => {
    assert.equal(phaseLabel(game("open_world")), "MUNDO ABIERTO");
    assert.equal(phaseLabel(game("countdown")), "COMIENZA LA PARTIDA");
    assert.equal(phaseLabel(game("playing")), "PARTIDA EN CURSO");
    assert.equal(phaseLabel(game("ended")), "FIN DE LA PARTIDA");
    assert.equal(phaseLabel(null), "MUNDO ABIERTO");
    assert.deepEqual(["available", "in_progress", "done"].map(missionStatusLabel), ["pendiente", "en curso", "hecha"]);
    assert.deepEqual([0, 33.33, 99.6, 100, -3, NaN].map(curePercent), [0, 33, 99, 100, 0, 0]);
});

test("eventText: frase en español para todos los kinds", () => {
    const cases = [
        [{ kind: "match_started", role: "healthy" }, "La partida comenzó: estás sano"],
        [{ kind: "match_started", role: "infected" }, "La partida comenzó: eres el infectado"],
        [{ kind: "you_infected" }, "Has sido infectado"],
        [{ kind: "infect_result", ok: true }, "Contagio exitoso"],
        [{ kind: "infect_result", ok: false, reason: "no_target" }, "No hay nadie a tu alcance"],
        [{ kind: "mission_started", missionId: "hospital-1" }, "Misión iniciada: no te muevas hasta terminarla"],
        [{ kind: "mission_result", ok: true, missionId: "hospital-1" }, "Misión completada: la cura avanza"],
        [{ kind: "mission_result", ok: false, missionId: "hospital-1", reason: "too_far" }, "Estás demasiado lejos de la estación"],
        [{ kind: "contagion_alert", zone: "Laboratorio" }, "Nuevo contagio detectado cerca de Laboratorio"],
        [{ kind: "contagion_alert", zone: null }, "Nuevo contagio detectado"],
        [{ kind: "cure_update", cure: 66.67 }, "Cura al 67 %"],
        [{ kind: "match_cancelled", reason: "not_enough_players" }, "Partida cancelada: no quedan suficientes jugadores"],
        [{ kind: "match_cancelled" }, "Partida cancelada"],
        [{ kind: "match_ended", winner: "players" }, "¡La cura funcionó! Ganan los jugadores"],
        [{ kind: "match_ended", winner: "infected" }, "La ciudad ha caído: ganan los infectados"],
    ];
    for (const [event, text] of cases) assert.equal(eventText(event), text, event.kind);
    for (const kind of EVENT_KINDS) assert.notEqual(eventText({ kind, ok: false, role: "healthy", winner: "players", cure: 0 }), "", kind);
    assert.equal(eventText({ kind: "otro" }), "");
    assert.equal(eventText(null), "");
});

test("eventText: un mensaje propio para cada motivo de fallo del contrato", () => {
    const contract = ["not_playing", "spectator", "not_infected", "cooldown", "no_target", "not_healthy", "busy", "not_available", "too_far", "too_fast", "expired", "infected", "cancelled", "no_active_mission", "arbiter_unavailable"];
    for (const r of contract) assert.ok(REASONS.includes(r), r);
    const texts = contract.map((reason) => eventText({ kind: "mission_result", ok: false, missionId: null, reason }));
    assert.equal(new Set(texts).size, contract.length, "todos distintos");
    for (const t of texts) assert.notEqual(t, reasonText("desconocido"));
    assert.equal(eventText({ kind: "infect_result", ok: false, reason: "cooldown" }), "Tu infección todavía no está lista");
    assert.equal(eventText({ kind: "mission_result", ok: false, reason: "arbiter_unavailable" }), "El árbitro de la partida no está disponible. Inténtalo de nuevo");
    assert.equal(reasonText("desconocido"), "No se pudo completar la acción");
});

test("eventTone: colores por tipo de aviso", () => {
    assert.equal(eventTone({ kind: "you_infected" }), "infected");
    assert.equal(eventTone({ kind: "contagion_alert" }), "infected");
    assert.equal(eventTone({ kind: "cure_update" }), "cure");
    assert.equal(eventTone({ kind: "mission_result", ok: false }), "danger");
    assert.equal(eventTone({ kind: "mission_result", ok: true }), "cure");
    assert.equal(eventTone({ kind: "match_ended", winner: "infected" }), "infected");
    assert.equal(eventTone({ kind: "otro" }), "neutral");
});

// ---------- Cercanía ----------

test("nearestAvailableStation: ignora in_progress y done y respeta el rango (inclusivo)", () => {
    const missions = [mission("a-1", "in_progress", 10, 0), mission("a-2", "done", 5, 0), mission("b-1", "available", 50, 0), mission("b-2", "available", 30, 0)];
    assert.equal(nearestAvailableStation({ x: 0, y: 0 }, missions, 60)?.id, "b-2", "la disponible más cercana");
    assert.equal(nearestAvailableStation({ x: 0, y: 0 }, missions, 30)?.id, "b-2", "justo en el borde del rango");
    assert.equal(nearestAvailableStation({ x: 0, y: 0 }, missions, 29.9), null, "las cercanas no están disponibles");
    assert.equal(nearestAvailableStation({ x: 0, y: 0 }, [], 60), null);
    assert.equal(nearestAvailableStation(null, missions, 60), null);
});

test("nearestPlayer: ignora fantasmas y al propio jugador, respeta el rango", () => {
    const players = [{ userId: "me", x: 0, y: 0 }, { userId: "g", x: 5, y: 0, ghost: true }, { userId: "b", x: 60, y: 0 }, { userId: "c", x: 0, y: 40 }];
    assert.equal(nearestPlayer({ x: 0, y: 0 }, players, 70, "me")?.userId, "c");
    assert.equal(nearestPlayer({ x: 0, y: 0 }, players, 39, "me"), null);
    assert.equal(nearestPlayer({ x: 0, y: 0 }, players, 70, "c")?.userId, "me", "otro selfId");
    assert.equal(nearestPlayer({ x: 0, y: 0 }, [{ userId: "g", x: 1, y: 1, ghost: true }], 70, "me"), null);
});

test("infectStatus: listo, falta N s, no infectado → null", () => {
    const clock = createClock();
    clock.sync(1_000_000, 1_000_000); // sin desfase
    const infected = (readyAt) => game("playing", { you: { role: "infected", infectReadyAt: readyAt } });
    assert.deepEqual(infectStatus(infected(1_000_000), clock, 1_000_000), { ready: true, secondsLeft: null }, "justo ahora");
    assert.deepEqual(infectStatus(infected(990_000), clock, 1_000_000), { ready: true, secondsLeft: null });
    assert.deepEqual(infectStatus(infected(1_060_000), clock, 1_000_000), { ready: false, secondsLeft: 60 });
    assert.deepEqual(infectStatus(infected(1_000_001), clock, 1_000_000), { ready: false, secondsLeft: 1 });
    assert.equal(infectStatus(game("playing"), clock, 1_000_000), null, "sano");
    assert.equal(infectStatus(game("playing", { you: { role: "spectator" } }), clock, 1_000_000), null);
    assert.equal(infectStatus(game("ended", { you: { role: "infected" } }), clock, 1_000_000), null, "fuera de playing");
    assert.equal(infectStatus(null, clock, 1_000_000), null);
});

// ---------- Pista contextual ----------

test("contextHint: mundo abierto, espectador, sano junto a una estación, infectado listo o en enfriamiento", () => {
    const clock = createClock();
    clock.sync(1_000_000, 1_000_000);
    const base = { clock, localNow: 1_000_000, players: [], selfId: "me", city: CITY, rules: DEFAULT_RULES };
    assert.equal(contextHint({ ...base, game: game("open_world") }), "Mundo abierto: falta 1 jugador para empezar");
    assert.equal(contextHint({ ...base, game: game("open_world", { connected: 0 }) }), "Mundo abierto: faltan 3 jugadores para empezar");
    assert.equal(contextHint({ ...base, game: game("open_world", { connected: 5 }) }), null);
    assert.equal(contextHint({ ...base, game: game("countdown") }), null, "en la cuenta manda el banner");
    assert.equal(contextHint({ ...base, game: game("playing", { you: { role: "spectator" } }) }), "Eres espectador hasta la próxima partida");
    // Sano a 40 px de hospital-1 (disponible) → E; lejos → nada; junto a una en curso → nada
    assert.equal(contextHint({ ...base, game: game("playing"), pos: { x: 140, y: 100 } }), "E: iniciar misión en Hospital");
    assert.equal(contextHint({ ...base, game: game("playing"), pos: { x: 600, y: 600 } }), null);
    assert.equal(contextHint({ ...base, game: game("playing"), pos: { x: 400, y: 100 } }), null);
    assert.equal(contextHint({ ...base, game: game("playing", { you: { missionId: "hospital-1" } }), pos: { x: 100, y: 100 } }), "Misión en curso en Hospital");
    // Infectado: en enfriamiento, listo con alguien cerca, listo sin nadie cerca (los fantasmas no cuentan)
    const inf = (readyAt) => game("playing", { you: { role: "infected", infectReadyAt: readyAt } });
    assert.equal(contextHint({ ...base, game: inf(1_065_000), pos: { x: 0, y: 0 } }), "Infección disponible en 1:05");
    const near = [{ userId: "b", x: 50, y: 0 }];
    assert.equal(contextHint({ ...base, game: inf(999_000), pos: { x: 0, y: 0 }, players: near }), "F: infectar");
    assert.equal(contextHint({ ...base, game: inf(999_000), pos: { x: 0, y: 0 }, players: [{ userId: "g", x: 5, y: 0, ghost: true }] }), null);
    assert.equal(contextHint({ ...base, game: game("ended") }), null);
    assert.equal(contextHint({ ...base, game: null }), null);
});

// ---------- Pantallas ----------

test("roleScreen: sano e infectado (el tiempo sale de infectReadyAt − startedAt)", () => {
    assert.deepEqual(roleScreen(game("playing"), "healthy"), { tone: "healthy", title: "ESTÁS SANO", text: "Completa misiones para fabricar la cura y descubre quién está infectado." });
    const g = game("playing", { you: { role: "infected", infectReadyAt: 990_000 + 60_000 } });
    assert.deepEqual(roleScreen(g, "infected"), { tone: "infected", title: "ERES EL INFECTADO", text: "Contagia a los demás sin que te descubran. Podrás infectar en 1:00." });
    const fast = game("playing", { you: { role: "infected", infectReadyAt: 990_000 + 5000 } });
    assert.match(roleScreen(fast, "infected").text, /Podrás infectar en 0:05\.$/);
    assert.equal(roleScreen(game("countdown"), "infected").text, "Contagia a los demás sin que te descubran.", "aún sin el game de la partida");
});

test("endSummary: título, motivo, ganaste/perdiste según rol y winner, tabla con (tú)", () => {
    const s = endSummary(game("ended"), "1");
    assert.deepEqual(s, {
        tone: "cure",
        title: "¡LA CURA FUNCIONÓ!",
        reason: "La cura se completó",
        outcome: "Ganaste",
        rows: [{ username: "ana", role: "Sano", you: true }, { username: "beto", role: "Infectado", you: false }],
    });
    assert.equal(endSummary(game("ended"), "2").outcome, "Perdiste", "infectado y ganan los jugadores");
    const fell = game("ended");
    fell.results = { ...fell.results, winner: "infected", reason: "all_infected" };
    const f = endSummary(fell, "2");
    assert.deepEqual([f.tone, f.title, f.reason, f.outcome], ["infected", "LA CIUDAD HA CAÍDO", "Todos los jugadores están infectados", "Ganaste"]);
    assert.equal(endSummary(fell, "1").outcome, "Perdiste");
    fell.results.reason = "time";
    assert.equal(endSummary(fell, "1").reason, "Se agotó el tiempo");
    fell.results.reason = "no_infected";
    assert.equal(endSummary(fell, "1").reason, "No quedan infectados");
    assert.equal(endSummary(game("ended", { you: { role: "spectator" } }), "9").outcome, "Fuiste espectador en esta partida");
    assert.equal(endSummary(game("playing"), "1"), null);
});
