// Pruebas de la lógica pura de los minijuegos de la fase M4: válvulas, secuencia del reactor, carga y escáner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createValves, pressures, inZone, allInZone, turnValve, angleDelta, COUPLING, ZONE_WIDTH, VALVE_COUNT } from "../public/js/vc/minigames/valves.js";
import { createReactor, roundSequence, startInput, pressLight, isPurified, showingAt, ROUND_LENGTHS, LIGHTS, SHOW_LEAD_MS, SHOW_ON_MS, SHOW_GAP_MS } from "../public/js/vc/minigames/reactor.js";
import { createLoading, canPlace, placeProblem, place, isLoaded, validSlots, slotIndex, CRATES, COLS, ROWS, OLD_CRATES } from "../public/js/vc/minigames/loading.js";
import { createScanner, sweepResult, registerRead, isInventoried, levelsInWindow, crossingTime, BOXES, SPEED_LEVELS, WINDOW_RATIO } from "../public/js/vc/minigames/scanner.js";
import { MINIGAMES } from "../public/js/vc/minigames/index.js";

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------- Válvulas ----------
test("válvulas: cada medidor suma COUPLING de la válvula de su izquierda (la primera recibe de la última)", () => {
    const p = pressures([1, 0, 0]);
    assert.ok(Math.abs(p[0] - 1 / (1 + COUPLING)) < 1e-9);
    assert.ok(Math.abs(p[1] - COUPLING / (1 + COUPLING)) < 1e-9, "la válvula 1 empuja al medidor 2");
    assert.equal(p[2], 0);
    assert.ok(Math.abs(pressures([0, 0, 1])[0] - COUPLING / (1 + COUPLING)) < 1e-9, "la válvula 3 empuja al medidor 1");
    assert.deepEqual(pressures([1, 1, 1]), [1, 1, 1]);
});

test("válvulas: empiezan cerradas y fuera de zona, y siempre existe una solución", () => {
    for (let seed = 1; seed <= 60; seed++) {
        const s = createValves(seeded(seed));
        assert.deepEqual(s.valves, [0, 0, 0]);
        assert.equal(allInZone(s), false);
        for (const z of s.zones) {
            assert.ok(Math.abs(z[1] - z[0] - ZONE_WIDTH) < 1e-9);
            assert.ok(z[0] > 0 && z[1] < 1);
        }
        // la combinación con la que se armaron las zonas (centro de cada zona) se puede alcanzar: se resuelve
        // el sistema lineal girando cada válvula hacia su centro unas cuantas veces (converge por ser diagonal dominante)
        let v = [0.5, 0.5, 0.5];
        for (let it = 0; it < 60; it++) {
            v = v.map((_, k) => {
                const center = (s.zones[k][0] + s.zones[k][1]) / 2;
                return Math.min(1, Math.max(0, center * (1 + COUPLING) - COUPLING * v[(k + VALVE_COUNT - 1) % VALVE_COUNT]));
            });
        }
        assert.equal(allInZone({ ...s, valves: v }), true, `semilla ${seed}`);
    }
});

test("válvulas: turnValve acota a 0..1, ignora índices o deltas inválidos y no muta; angleDelta cruza ±π sin saltar", () => {
    const s = createValves(seeded(3));
    const t = turnValve(s, 1, 0.3);
    assert.equal(t.valves[1], 0.3);
    assert.equal(s.valves[1], 0, "no muta el estado anterior");
    assert.equal(turnValve(t, 1, 5).valves[1], 1);
    assert.equal(turnValve(t, 1, -5).valves[1], 0);
    assert.equal(turnValve(t, 7, 0.1), t);
    assert.equal(turnValve(t, 0, Number.NaN), t);
    assert.ok(Math.abs(angleDelta(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9);
    assert.ok(Math.abs(angleDelta(-3.0, 3.0) + (2 * Math.PI - 6)) < 1e-9);
    assert.equal(inZone(0.5, [0.4, 0.6]), true);
    assert.equal(inZone(0.61, [0.4, 0.6]), false);
});

// ---------- Reactor ----------
test("reactor: serie de 5 luces válidas, sin tres iguales seguidas; las rondas usan 3, 4 y 5", () => {
    for (let seed = 1; seed <= 80; seed++) {
        const s = createReactor(seeded(seed));
        assert.equal(s.seq.length, 5);
        assert.ok(s.seq.every((k) => k >= 0 && k < LIGHTS.length));
        for (let i = 2; i < s.seq.length; i++) assert.ok(!(s.seq[i] === s.seq[i - 1] && s.seq[i] === s.seq[i - 2]));
        assert.deepEqual(roundSequence(s), s.seq.slice(0, 3));
    }
    assert.deepEqual(ROUND_LENGTHS, [3, 4, 5]);
});

test("reactor: repetir bien pasa de ronda y al final purifica; fallar reinicia la ronda; fuera de turno se ignora", () => {
    let s = createReactor(seeded(9));
    assert.equal(pressLight(s, s.seq[0]).result, "ignored", "mientras muestra la serie no se puede pulsar");
    s = startInput(s);
    const wrong = (s.seq[0] + 1) % LIGHTS.length;
    const fail = pressLight(s, wrong);
    assert.equal(fail.result, "wrong");
    assert.equal(fail.state.phase, "watch");
    assert.equal(fail.state.round, 0);
    const results = [];
    for (let round = 0; round < ROUND_LENGTHS.length; round++) {
        s = startInput(s);
        for (let i = 0; i < ROUND_LENGTHS[round]; i++) {
            const r = pressLight(s, s.seq[i]);
            results.push(r.result);
            s = r.state;
        }
    }
    assert.deepEqual(results, ["ok", "ok", "round", "ok", "ok", "ok", "round", "ok", "ok", "ok", "ok", "done"]);
    assert.equal(isPurified(s), true);
    assert.equal(pressLight(s, 0).result, "ignored");
    assert.equal(pressLight(startInput(createReactor(seeded(1))), 9).result, "ignored", "luz inexistente");
});

test("reactor: showingAt enciende cada luz SHOW_ON_MS, pausa entre luces y avisa el final", () => {
    const seq = [2, 0, 3];
    assert.equal(showingAt(seq, 0), null, "pausa inicial");
    assert.equal(showingAt(seq, SHOW_LEAD_MS + 1), 2);
    assert.equal(showingAt(seq, SHOW_LEAD_MS + SHOW_ON_MS + 1), null, "pausa entre luces");
    assert.equal(showingAt(seq, SHOW_LEAD_MS + SHOW_ON_MS + SHOW_GAP_MS + 1), 0);
    assert.equal(showingAt(seq, SHOW_LEAD_MS + 3 * (SHOW_ON_MS + SHOW_GAP_MS) + 1), -1);
});

// ---------- Carga ----------
test("carga: 3 cajas viejas en el piso con una columna libre; 5 casillas por llenar", () => {
    for (let seed = 1; seed <= 40; seed++) {
        const s = createLoading(seeded(seed));
        assert.equal(s.slots.filter(Boolean).length, OLD_CRATES);
        assert.equal(s.slots.slice(COLS).filter(Boolean).length, 0, "arriba empieza vacío");
        assert.equal(CRATES, COLS * ROWS - OLD_CRATES);
        assert.equal(validSlots(s).length, OLD_CRATES + 1, "el hueco del piso y las 3 de arriba apoyadas");
    }
});

test("carga: arriba solo con una caja debajo; ocupada no; al llenar las 5 está cargado", () => {
    let s = createLoading(seeded(4));
    const emptyCol = [0, 1, 2, 3].find((c) => !s.slots[slotIndex(c, 0)]);
    const above = slotIndex(emptyCol, 1);
    assert.equal(canPlace(s, above), false);
    assert.equal(placeProblem(s, above), "unsupported");
    assert.equal(placeProblem(s, slotIndex((emptyCol + 1) % COLS, 0)), "occupied");
    assert.equal(place(s, above), s, "no se coloca sin apoyo");
    s = place(s, slotIndex(emptyCol, 0));
    assert.equal(canPlace(s, above), true, "con la caja debajo ya se puede");
    let guard = 0;
    while (!isLoaded(s) && guard++ < 20) s = place(s, validSlots(s)[0]);
    assert.equal(isLoaded(s), true);
    assert.equal(s.placed, CRATES);
    assert.deepEqual(validSlots(s), []);
    assert.equal(canPlace(s, 99), false);
});

// ---------- Escáner ----------
test("escáner: cada caja tiene un rango que contiene al menos una velocidad del teclado", () => {
    for (let seed = 1; seed <= 200; seed++) {
        const s = createScanner(seeded(seed));
        assert.equal(s.windows.length, BOXES);
        for (const w of s.windows) {
            assert.ok(Math.abs(w[1] / w[0] - WINDOW_RATIO) < 1e-9);
            assert.ok(levelsInWindow(w).length >= 1, `semilla ${seed}: rango ${w}`);
        }
    }
    assert.ok(SPEED_LEVELS.every((v, i) => i === 0 || v > SPEED_LEVELS[i - 1]));
});

test("escáner: muy rápido, muy lento o leído según la velocidad; tres lecturas completan el inventario", () => {
    const win = [0.3, 0.57];
    assert.equal(sweepResult(132, 132 / 0.4, win), "ok");
    assert.equal(sweepResult(132, 132 / 0.9, win), "fast");
    assert.equal(sweepResult(132, 132 / 0.1, win), "slow");
    assert.equal(sweepResult(132, 0, win), "fast", "una pasada instantánea es demasiado rápida");
    let s = createScanner(seeded(2));
    for (let i = 0; i < BOXES; i++) {
        assert.equal(isInventoried(s), false);
        s = registerRead(s);
    }
    assert.equal(isInventoried(s), true);
    assert.equal(registerRead(s), s);
    assert.equal(crossingTime(100, 90, 1000, 110, 1100), 1050, "cruce interpolado entre dos muestras");
});

test("registro: los 4 minijuegos de M4 están en el modal con su nombre y dibujados en canvas", () => {
    for (const [kind, name] of [["valves", "Válvulas"], ["reactor", "Reactor"], ["loading", "Carga"], ["scanner", "Escáner"]]) {
        assert.equal(MINIGAMES[kind].name, name);
        assert.equal(MINIGAMES[kind].canvas, true);
        assert.equal(typeof MINIGAMES[kind].module.mount, "function");
    }
});
