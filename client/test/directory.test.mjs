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
