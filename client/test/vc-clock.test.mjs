// Pruebas del reloj de la partida (js/vc/clock.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClock, formatMMSS, secondsLeft } from "../public/js/vc/clock.js";

test("formatMMSS: bordes (0, negativos, redondeo hacia arriba, minutos sin cero a la izquierda)", () => {
    assert.equal(formatMMSS(0), "0:00");
    assert.equal(formatMMSS(-5000), "0:00");
    assert.equal(formatMMSS(NaN), "0:00");
    assert.equal(formatMMSS(undefined), "0:00");
    assert.equal(formatMMSS(1), "0:01", "1 ms aún muestra un segundo");
    assert.equal(formatMMSS(999), "0:01");
    assert.equal(formatMMSS(1000), "0:01");
    assert.equal(formatMMSS(1001), "0:02");
    assert.equal(formatMMSS(5000), "0:05");
    assert.equal(formatMMSS(59999), "1:00");
    assert.equal(formatMMSS(60000), "1:00");
    assert.equal(formatMMSS(61000), "1:01");
    assert.equal(formatMMSS(600000), "10:00");
    assert.equal(formatMMSS(900000), "15:00");
});

test("secondsLeft: entero hacia arriba y nunca negativo", () => {
    assert.equal(secondsLeft(0), 0);
    assert.equal(secondsLeft(-1), 0);
    assert.equal(secondsLeft(1), 1);
    assert.equal(secondsLeft(2999), 3);
    assert.equal(secondsLeft(3000), 3);
    assert.equal(secondsLeft(Infinity), 0);
});

test("createClock: sin sincronizar usa la hora local; con muestras usa la de menor retraso", () => {
    const clock = createClock();
    assert.equal(clock.synced(), false);
    assert.equal(clock.now(1000), 1000);
    assert.equal(clock.remaining(5000, 1000), 4000);

    // El servidor va 10 000 ms adelantado; la primera muestra llegó con 80 ms de retraso, la segunda con 20
    clock.sync(50000, 40080);
    clock.sync(51000, 41020);
    assert.equal(clock.synced(), true);
    assert.equal(clock.now(42000), 51980, "offset = 9980 (la muestra con menos retraso)");
    assert.equal(clock.remaining(55000, 42000), 3020);
});

test("createClock.remaining: nunca negativo y 0 con datos que no sirven", () => {
    const clock = createClock();
    clock.sync(1000, 1000);
    assert.equal(clock.remaining(500, 2000), 0, "ya pasó");
    assert.equal(clock.remaining(3000, 3000), 0, "justo ahora");
    assert.equal(clock.remaining(null, 1000), 0);
    assert.equal(clock.remaining(5000, NaN), 0);
    // Muestras inválidas no cambian el reloj
    clock.sync("x", 1);
    clock.sync(1, Infinity);
    assert.equal(clock.now(10), 10);
});

test("createClock: guarda solo las últimas muestras (un ajuste de hora del servidor se termina notando)", () => {
    const clock = createClock();
    clock.sync(100000, 0); // muestra vieja con offset grande
    for (let i = 1; i <= 20; i++) clock.sync(i * 1000 + 50, i * 1000); // offset 50
    assert.equal(clock.now(0), 50);
});
