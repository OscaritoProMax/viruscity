// Pruebas de las decisiones puras de las acciones de la partida (js/vc/actions.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideMissionKey, canInfect, completeDelayMs, missionTimeLeftMs, COMPLETE_MARGIN_MS } from "../public/js/vc/actions.js";
import { createClock } from "../public/js/vc/clock.js";
import { DEFAULT_RULES } from "../public/js/vc/view.js";

const mission = (id, status, x, y) => ({ id, zoneId: id.split("-")[0], stationId: id, x, y, title: id, kind: "hold", status });
const MISSIONS = [mission("hospital-1", "available", 100, 100), mission("farmacia-1", "in_progress", 400, 100), mission("almacen-1", "done", 700, 100)];
const game = (role, extra = {}) => ({ phase: "playing", missions: MISSIONS, you: { role, infectReadyAt: null, missionId: null, missionStartedAt: null }, ...extra });
const near = { x: 130, y: 100 }; // a 30 px de hospital-1
const rules = DEFAULT_RULES; // missionRange 60

test("decideMissionKey: un sano junto a una estación disponible pide esa misión", () => {
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: near, rules }), { action: "start", missionId: "hospital-1" });
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: { x: 160, y: 100 }, rules }), { action: "start", missionId: "hospital-1" }, "justo a 60 px");
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: { x: 161, y: 100 }, rules }), { action: "none" }, "fuera del rango");
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: { x: 400, y: 100 }, rules }), { action: "none" }, "la de al lado está en curso");
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: { x: 700, y: 100 }, rules }), { action: "none" }, "ya hecha");
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: { x: 160, y: 100 }, rules: { ...rules, missionRange: 40 } }), { action: "none" }, "usa missionRange de welcome.game");
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: null, rules }), { action: "none" }, "sin posición");
});

test("decideMissionKey: misión ya activa, bloqueado, fuera de partida o espectador → nada", () => {
    assert.deepEqual(decideMissionKey({ game: game("healthy", { you: { role: "healthy", missionId: "hospital-1", missionStartedAt: 1 } }), pos: near, rules }), { action: "none" });
    assert.deepEqual(decideMissionKey({ game: game("healthy"), pos: near, rules, blocked: true }), { action: "none" }, "pantalla de rol o modal abiertos");
    for (const phase of ["open_world", "countdown", "ended"]) {
        assert.deepEqual(decideMissionKey({ game: game("healthy", { phase }), pos: near, rules }), { action: "none" }, phase);
    }
    assert.deepEqual(decideMissionKey({ game: game("spectator"), pos: near, rules }), { action: "none" });
    assert.deepEqual(decideMissionKey({ game: null, pos: near, rules }), { action: "none" });
});

test("decideMissionKey: un infectado junto a una estación recibe el aviso de que no puede hacer misiones", () => {
    assert.deepEqual(decideMissionKey({ game: game("infected"), pos: near, rules }), { action: "toast", reason: "not_healthy" });
    assert.deepEqual(decideMissionKey({ game: game("infected"), pos: { x: 900, y: 600 }, rules }), { action: "none" }, "lejos: E vuelve a ser hablar o mirar");
    assert.deepEqual(decideMissionKey({ game: game("infected"), pos: near, rules, blocked: true }), { action: "none" });
});

test("completeDelayMs: espera hasta missionStartedAt + missionMinMs + 300 ms (hora del servidor)", () => {
    assert.equal(COMPLETE_MARGIN_MS, 300);
    const clock = createClock();
    clock.sync(10_000, 4_000); // el servidor va 6000 ms adelantado
    // La misión empezó (servidor) en 9000 con mínimo 3000: lista en 12300 (servidor) = 6300 local
    assert.equal(completeDelayMs({ missionStartedAt: 9000, missionMinMs: 3000, clock, localNow: 4_000 }), 2300);
    assert.equal(completeDelayMs({ missionStartedAt: 9000, missionMinMs: 3000, clock, localNow: 6_300 }), 0, "justo a tiempo");
    assert.equal(completeDelayMs({ missionStartedAt: 9000, missionMinMs: 3000, clock, localNow: 9_000 }), 0, "nunca negativo");
    // Sin missionStartedAt (el 'game' aún no llegó): desde que se abrió el minijuego
    assert.equal(completeDelayMs({ missionStartedAt: null, missionMinMs: 3000, clock, localNow: 5_000, openedAtLocal: 4_000 }), 2300);
    assert.equal(completeDelayMs({ missionStartedAt: null, missionMinMs: 3000, clock, localNow: 9_000, openedAtLocal: 4_000 }), 0);
});

test("missionTimeLeftMs: hasta missionStartedAt + missionMaxMs, nunca negativo", () => {
    const clock = createClock();
    clock.sync(10_000, 10_000);
    assert.equal(missionTimeLeftMs({ missionStartedAt: 10_000, missionMaxMs: 45_000, clock, localNow: 10_000 }), 45_000);
    assert.equal(missionTimeLeftMs({ missionStartedAt: 10_000, missionMaxMs: 45_000, clock, localNow: 50_000 }), 5_000);
    assert.equal(missionTimeLeftMs({ missionStartedAt: 10_000, missionMaxMs: 45_000, clock, localNow: 99_000 }), 0);
    assert.equal(missionTimeLeftMs({ missionStartedAt: null, missionMaxMs: 45_000, clock, localNow: 12_000, openedAtLocal: 10_000 }), 43_000);
});

test("canInfect: solo un infectado en partida y sin pantallas ni modales; sin enfriamiento local", () => {
    assert.equal(canInfect({ game: game("infected") }), true);
    assert.equal(canInfect({ game: game("infected", { you: { role: "infected", infectReadyAt: 9e15 } }) }), true, "aunque falte enfriamiento: decide el servidor");
    assert.equal(canInfect({ game: game("infected"), blocked: true }), false, "pantalla de rol o minijuego abiertos");
    for (const role of ["healthy", "spectator", null]) assert.equal(canInfect({ game: game(role) }), false, String(role));
    for (const phase of ["open_world", "countdown", "ended"]) assert.equal(canInfect({ game: game("infected", { phase }) }), false, phase);
    assert.equal(canInfect({ game: null }), false);
});
