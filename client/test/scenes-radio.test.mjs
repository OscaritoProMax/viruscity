// Pruebas de escenarios (interiores y puertas), conversaciones y radio sincronizada (funciones puras).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMapData } from "../public/js/play/map/map-data.js";
import { buildScenes } from "../public/js/play/map/interiors.js";
import { sceneAt, sceneRect, WORLD_SCENE } from "../public/js/play/map/scenes.js";
import { areaName } from "../public/js/play/map/zones.js";
import { doors, worldInteractables, buildWorld } from "../public/js/play/map/layout.js";
import { PLAYLIST, programAt, estimateOffset, songMs, GAP_MS, STATION } from "../public/js/play/radio.js";

const data = buildMapData(); // construye ciudad e interiores
const scenes = buildScenes();
const T = data.tile;
const solidAt = (x, y) => data.solid[Math.floor(y / T)][Math.floor(x / T)] === "1";

test("dos locales con puerta: Burger Neón y Supermercado", () => {
    assert.deepEqual(doors.map((d) => d.to).sort(), ["burger", "market"]);
    assert.equal(sceneRect("burger").name, "Burger Neón");
    assert.equal(sceneRect("market").name, "Supermercado");
    assert.equal(sceneRect(WORLD_SCENE).height, 2880);
});

test("portales: entrar lleva al local y salir devuelve a la ciudad, siempre a una casilla libre", () => {
    assert.equal(data.portals.length, 4);
    for (const p of data.portals) {
        assert.equal(solidAt(p.x, p.y), false, `destino libre (${p.x}, ${p.y})`);
        const from = sceneAt((p.c0 + 0.5) * T, (p.r0 + 0.5) * T);
        const to = sceneAt(p.x, p.y);
        assert.notEqual(from, to, "un portal cambia de escenario");
        // La casilla del portal no es sólida (se puede pisar)
        assert.equal(data.solid[p.r0][p.c0], "0");
    }
    const tos = data.portals.map((p) => sceneAt(p.x, p.y)).sort();
    assert.deepEqual(tos, ["burger", "market", "world", "world"]);
});

test("sceneAt: ciudad, interiores y zona de pared", () => {
    assert.equal(sceneAt(100, 100), WORLD_SCENE);
    const b = scenes.burger;
    assert.equal(sceneAt(b.ox + 100, b.oy + 100), "burger");
    const m = scenes.market;
    assert.equal(sceneAt(m.ox + 100, m.oy + 100), "market");
    assert.equal(sceneAt(NaN, 5), WORLD_SCENE);
    assert.equal(areaName(b.ox + 100, b.oy + 100), "Burger Neón");
});

test("conversaciones: vecinos y carteles tienen líneas en español", () => {
    buildWorld; // el mundo ya se construyó en buildMapData
    assert.ok(worldInteractables.length >= 15, `${worldInteractables.length} carteles en la ciudad`);
    for (const sc of Object.values(scenes)) {
        assert.ok(sc.npcs.length >= 5, sc.id);
        for (const n of sc.npcs) assert.ok(Array.isArray(n.lines) && n.lines.length > 0 && n.speaker, n.name);
        assert.ok(sc.interactables.every((o) => o.lines.length > 0));
    }
    assert.ok(scenes.burger.interactables.some((o) => o.action === "jukebox"), "la rocola del Burger Neón");
});

test("radio: tres canciones, programa por hora del servidor y pausa entre canciones", () => {
    assert.equal(STATION, "Radio Virus 86.6 FM");
    assert.equal(PLAYLIST.length, 3);
    const first = programAt(0);
    assert.equal(first.index, 0);
    assert.equal(first.offsetMs, 0);
    const len0 = songMs(PLAYLIST[0]);
    assert.equal(programAt(len0 - 1).index, 0);
    assert.equal(programAt(len0 + 10).gap, true);
    assert.equal(programAt(len0 + GAP_MS + 1).index, 1);
    // El mismo instante del servidor da lo mismo en cualquier cliente (y es cíclico)
    const cycle = PLAYLIST.reduce((s, x) => s + songMs(x) + GAP_MS, 0);
    assert.deepEqual(programAt(123456789), programAt(123456789));
    assert.equal(programAt(5000 + cycle * 7).offsetMs, programAt(5000).offsetMs);
    // Cada canción dura entre 40 s y 2 min
    for (const s of PLAYLIST) assert.ok(songMs(s) > 40000 && songMs(s) < 120000, s.title);
});

test("estimateOffset: se queda con la muestra de menor latencia", () => {
    // reloj del servidor 1000 ms adelantado; latencias de 30, 80 y 10 ms
    assert.equal(estimateOffset([1000 - 30, 1000 - 80, 1000 - 10]), 990);
    assert.equal(estimateOffset([]), 0);
});

test("radio: el programador nunca se congela en los cambios de canción y no repite ni salta notas", async () => {
    const { createRadio } = await import("../public/js/play/radio.js");
    // Audio simulado: cuenta las notas (osciladores) y los golpes de ruido programados
    const run = (frameMs) => {
        let notes = 0;
        const node = () => new Proxy(function () {}, { get: (_, k) => (k === "frequency" || k === "gain" ? node() : () => node()), apply: () => node() });
        const ctx = { currentTime: 0, createOscillator: () => (notes++, node()), createGain: node, createBiquadFilter: node };
        const audio = { context: () => ctx, radioBus: node, ready: () => true, isRadioMuted: () => false, noise: () => notes++ };
        const radio = createRadio(audio);
        const cycle = PLAYLIST.reduce((s, x) => s + songMs(x) + GAP_MS, 0);
        // Un ciclo completo con la hora real (≈1,8·10^12 ms, donde aparecía el error de redondeo)
        const start = Math.floor(Date.now() / cycle) * cycle;
        for (let t = start; t < start + cycle; t += frameMs) radio.update(t);
        return notes;
    };
    const at60 = run(1000 / 60);
    const at30 = run(1000 / 30);
    assert.ok(at60 > 1000, `${at60} notas en un ciclo`);
    assert.equal(at30, at60, "la cantidad de notas no depende de los cuadros por segundo");
});
