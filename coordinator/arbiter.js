// Partida de Viruscity en el coordinador: funciones PURAS de entrada y salida (metodología, decisiones 19 y 20).
// No conocen sockets: index.js las usa para validar acciones de los clientes y repartir los eventos.
//
// sanitizeGameAction(msg)                               → { kind, missionId? } o null si el mensaje no vale
// selectEventsToDeliver(events, lastDeliveredEid, eid)  → { deliver, newLast }  (sin duplicados, con reinicio)
// routeEvents(events, localUserIds)                     → [{ userId|null, msg }]  (null = a todos los locales)
//
// En V3 aquí también vivirá la elección del árbitro.
"use strict";

const GAME_ACTIONS = new Set(["infect", "mission_start", "mission_complete", "mission_cancel"]);
const MISSION_ID_REGEX = /^[a-z0-9-]{1,40}$/;
const GAME_ACTIONS_PER_SEC = 5; // máximo de game_action por socket (el exceso se descarta en silencio)

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// { type:'game_action', action:'infect'|'mission_start'|'mission_complete'|'mission_cancel', missionId? }
// missionId es opcional, pero si viene debe cumplir el patrón (si no, se ignora todo el mensaje)
function sanitizeGameAction(msg) {
    if (!isObject(msg) || msg.type !== "game_action") return null;
    if (typeof msg.action !== "string" || !GAME_ACTIONS.has(msg.action)) return null;
    if (msg.missionId === undefined || msg.missionId === null) return { kind: msg.action };
    if (typeof msg.missionId !== "string" || !MISSION_ID_REGEX.test(msg.missionId)) return null;
    return { kind: msg.action, missionId: msg.missionId };
}

// Decisión 19: se entregan solo los eventos con eid mayor al último entregado. Si el eid de la partida
// retrocede respecto al último entregado (otro árbitro empezó de cero), el contador se reinicia.
// Nunca se entrega un eid mayor que el de la partida, ni dos veces el mismo eid.
function selectEventsToDeliver(events, lastDeliveredEid, matchEid) {
    const eid = Number.isFinite(matchEid) ? matchEid : 0;
    const base = Number.isFinite(lastDeliveredEid) && eid >= lastDeliveredEid ? lastDeliveredEid : 0;
    const seen = new Set();
    const deliver = (Array.isArray(events) ? events : [])
        .filter((e) => isObject(e) && Number.isFinite(e.eid) && e.eid > base && e.eid <= eid)
        .sort((a, b) => a.eid - b.eid)
        .filter((e) => (seen.has(e.eid) ? false : seen.add(e.eid)));
    return { deliver, newLast: Math.max(base, eid) };
}

// Mensaje para el cliente: { type:'event', kind, ...datos } SIN eid ni to
function toClientEvent(event) {
    const { eid, to, kind, ...data } = event; // eslint-disable-line no-unused-vars
    return { type: "event", kind, ...data };
}

// Los eventos personales (con to) solo se envían si ese jugador es local; los públicos, a todos los locales
function routeEvents(events, localUserIds) {
    const locals = localUserIds instanceof Set ? localUserIds : new Set(localUserIds ?? []);
    const out = [];
    for (const event of events ?? []) {
        if (!isObject(event) || typeof event.kind !== "string") continue;
        if (event.to !== undefined && event.to !== null) {
            if (locals.has(event.to)) out.push({ userId: event.to, msg: toClientEvent(event) });
        } else {
            out.push({ userId: null, msg: toClientEvent(event) });
        }
    }
    return out;
}

module.exports = { GAME_ACTIONS, GAME_ACTIONS_PER_SEC, MISSION_ID_REGEX, sanitizeGameAction, selectEventsToDeliver, routeEvents };
