// Pruebas de la lógica pura del directorio y la reconexión (js/play/directory.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoordinatorResponse, buildWsUrl, isMixedContent, nextDelay, classifyClose, MAX_ATTEMPTS } from "../public/js/play/directory.js";

test("parseCoordinatorResponse: ok, sin coordinadores y errores", () => {
    assert.deepEqual(parseCoordinatorResponse(200, { coordinatorId: "coord-a", publicUrl: "ws://localhost:5001" }), {
        kind: "ok",
        coordinatorId: "coord-a",
        publicUrl: "ws://localhost:5001",
    });
    assert.equal(parseCoordinatorResponse(200, { coordinatorId: "coord-b", publicUrl: "wss://b.ngrok-free.app" }).kind, "ok");
    assert.deepEqual(parseCoordinatorResponse(503, { error: "no_coordinators_available" }), { kind: "none" });
    for (const [status, body] of [
        [200, { coordinatorId: "", publicUrl: "ws://x" }],
        [200, { coordinatorId: "coord-a" }],
        [200, { coordinatorId: "coord-a", publicUrl: "http://localhost:5001" }],
        [200, { coordinatorId: 5, publicUrl: "ws://x" }],
        [200, null],
        [200, "texto"],
        [503, { error: "otra cosa" }],
        [503, null],
        [500, { error: "x" }],
        [0, undefined],
    ]) {
        assert.deepEqual(parseCoordinatorResponse(status, body), { kind: "error" }, `${status} ${JSON.stringify(body)}`);
    }
});

test("buildWsUrl: quita barras finales y codifica el token", () => {
    assert.equal(buildWsUrl("ws://localhost:5001", "abc"), "ws://localhost:5001/connect?token=abc");
    assert.equal(buildWsUrl("wss://x.ngrok-free.app//", "a+b/c=d"), "wss://x.ngrok-free.app/connect?token=a%2Bb%2Fc%3Dd");
});

test("isMixedContent: https + ws:// remoto sí; localhost, wss o http no", () => {
    assert.equal(isMixedContent("https:", "x.ngrok-free.app", "ws://otro.ngrok-free.app/connect"), true);
    assert.equal(isMixedContent("https:", "x.ngrok-free.app", "ws://192.168.1.5:5001"), true);
    assert.equal(isMixedContent("https:", "x.ngrok-free.app", "wss://otro.ngrok-free.app"), false);
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) assert.equal(isMixedContent("https:", "x", `ws://${host}:5001`), false, host);
    assert.equal(isMixedContent("http:", "localhost", "ws://otro.com"), false);
    assert.equal(isMixedContent("https:", "x", "no es url"), false);
});

test("nextDelay: 1, 2, 3 s y luego 3 s fijos", () => {
    assert.deepEqual([1, 2, 3, 4, 10, 20].map(nextDelay), [1000, 2000, 3000, 3000, 3000, 3000]);
    assert.equal(nextDelay(0), 1000, "nunca menos de 1 s");
    assert.equal(MAX_ATTEMPTS, 20);
});

test("classifyClose: logout, 4001, 4002 y cualquier otro cierre", () => {
    assert.equal(classifyClose(4001, true), "none");
    assert.equal(classifyClose(1006, true), "none");
    assert.equal(classifyClose(4001, false), "login-invalid");
    assert.equal(classifyClose(4002, false), "login-replaced");
    for (const code of [1000, 1001, 1006, 1011, 4010, undefined]) assert.equal(classifyClose(code, false), "reconnect", String(code));
});

test("gracia de reconexión: por tiempo desde que se perdió el coordinador, con cuenta atrás", async () => {
    const { readGraceMs, graceLeftMs, shouldGiveUp, reconnectNotice, DEFAULT_RECONNECT_GRACE_MS, MIN_RECONNECT_GRACE_MS, MAX_ATTEMPTS: MAX } = await import("../public/js/play/directory.js");
    // configuración: entero >= mínimo, si no el valor por defecto
    assert.equal(readGraceMs(30000), 30000);
    assert.equal(readGraceMs(undefined), DEFAULT_RECONNECT_GRACE_MS);
    assert.equal(readGraceMs(MIN_RECONNECT_GRACE_MS - 1), DEFAULT_RECONNECT_GRACE_MS);
    assert.equal(readGraceMs("abc"), DEFAULT_RECONNECT_GRACE_MS);
    assert.equal(readGraceMs(1.5e4 + 0.5), DEFAULT_RECONNECT_GRACE_MS);
    // conectado: toda la gracia; perdido: baja con el tiempo y nunca es negativa
    assert.equal(graceLeftMs(null, 99999, 45000), 45000);
    assert.equal(graceLeftMs(1000, 11000, 45000), 35000);
    assert.equal(graceLeftMs(1000, 999999, 45000), 0);
    // se rinde al acabarse la gracia, aunque haya hecho pocos intentos (p. ej. un auth caído tarda 12 s por intento)
    assert.equal(shouldGiveUp(1000, 1000 + 44999, 45000, 3), false);
    assert.equal(shouldGiveUp(1000, 1000 + 45000, 45000, 3), true);
    assert.equal(shouldGiveUp(null, 1e9, 45000, 0), false, "conectado nunca se rinde");
    assert.equal(shouldGiveUp(1000, 2000, 45000, MAX), true, "el límite de intentos sigue como respaldo");
    assert.equal(reconnectNotice("Sin coordinadores disponibles.", 12001), "Sin coordinadores disponibles. Reintentando… si no vuelve en 13 s, se vuelve al inicio.");
});

test("fallos recientes: si cae a y b no responde, el pedido al directorio excluye a ambos y caducan solos", async () => {
    const { rememberFailure, forgetFailure, recentFailures, coordinatorPath, FAILED_TTL_MS } = await import("../public/js/play/directory.js");
    let failed = {};
    failed = rememberFailure(failed, "coord-a", 1000);
    failed = rememberFailure(failed, "coord-b", 2000);
    assert.deepEqual(recentFailures(failed, 2500), ["coord-b", "coord-a"], "los más recientes primero");
    assert.equal(coordinatorPath(recentFailures(failed, 2500)), "/coordinator?exclude=coord-b,coord-a");
    // conectar a b lo saca de la lista; a sigue excluido hasta que caduque
    assert.deepEqual(recentFailures(forgetFailure(failed, "coord-b"), 2500), ["coord-a"]);
    assert.deepEqual(recentFailures(failed, 1000 + FAILED_TTL_MS), ["coord-b"], "a caducó");
    assert.deepEqual(Object.keys(rememberFailure(failed, "coord-c", 2000 + FAILED_TTL_MS)), ["coord-c"], "al recordar uno nuevo se limpian los vencidos");
    assert.equal(coordinatorPath([]), "/coordinator");
    assert.equal(coordinatorPath(undefined), "/coordinator");
    assert.deepEqual(rememberFailure(failed, null, 2500), failed, "sin id no agrega nada");
    assert.equal(coordinatorPath(["a b"]), "/coordinator?exclude=a%20b", "los ids van codificados");
});
