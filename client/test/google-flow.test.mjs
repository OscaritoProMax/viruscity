// Pruebas de interpretGoogleResponse (respuestas de POST /auth/google).
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretGoogleResponse as interpret } from "../public/js/google-flow.js";

test("200 con token y username → success", () => {
    assert.deepEqual(interpret(200, { token: "t.k.n", username: "gabi" }), { kind: "success", token: "t.k.n", username: "gabi" });
    // 200 sin token o con tipos raros no es un éxito
    assert.deepEqual(interpret(200, { username: "gabi" }), { kind: "server_error" });
    assert.deepEqual(interpret(200, { token: 5, username: "gabi" }), { kind: "server_error" });
});

test("409 username_required → need_username", () => {
    assert.deepEqual(interpret(409, { error: "username_required", hint: "..." }), { kind: "need_username" });
});

test("409 username_taken → username_taken", () => {
    assert.deepEqual(interpret(409, { error: "username_taken" }), { kind: "username_taken" });
});

test("401 invalid_id_token → invalid_token", () => {
    assert.deepEqual(interpret(401, { error: "invalid_id_token" }), { kind: "invalid_token" });
});

test("401 email_not_verified → email_not_verified", () => {
    assert.deepEqual(interpret(401, { error: "email_not_verified" }), { kind: "email_not_verified" });
});

test("400 → bad_request con el mensaje del servidor", () => {
    assert.deepEqual(interpret(400, { error: "idToken requerido" }), { kind: "bad_request", message: "idToken requerido" });
    assert.equal(interpret(400, null).kind, "bad_request");
    assert.equal(typeof interpret(400, {}).message, "string");
});

test("cualquier otra cosa → server_error", () => {
    for (const [status, body] of [[500, { error: "internal" }], [502, null], [401, { error: "otro" }], [409, {}], [0, undefined]]) {
        assert.deepEqual(interpret(status, body), { kind: "server_error" }, `${status} ${JSON.stringify(body)}`);
    }
});

test("un body que no es objeto se trata como vacío", () => {
    assert.deepEqual(interpret(200, "token"), { kind: "server_error" });
    assert.deepEqual(interpret(409, ["username_required"]), { kind: "server_error" });
    assert.deepEqual(interpret(401, "invalid_id_token"), { kind: "server_error" });
});
