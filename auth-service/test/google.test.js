// G8: makeGoogleVerifier con un cliente falso (sin red).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeGoogleVerifier } = require("../google.js");

const CLIENT_ID = "123456789012-pruebas.apps.googleusercontent.com";
const JWT_LIKE = "aaaa.bbbb.cccc";

function fakeClient(payload) {
    const calls = [];
    return {
        calls,
        async verifyIdToken(options) {
            calls.push(options);
            return { getPayload: () => payload };
        },
    };
}

test("G8 llama a verifyIdToken con { idToken, audience: clientId } y devuelve el payload", async () => {
    const payload = { sub: "s1", aud: CLIENT_ID, email: "x@example.com", email_verified: true };
    const client = fakeClient(payload);
    const verify = makeGoogleVerifier(client, CLIENT_ID);
    assert.deepEqual(await verify(JWT_LIKE), payload);
    assert.deepEqual(client.calls, [{ idToken: JWT_LIKE, audience: CLIENT_ID }]);
});

test("G8 lanza si payload.aud no es el clientId (defensa en profundidad)", async () => {
    const client = fakeClient({ sub: "s1", aud: "otro-cliente.apps.googleusercontent.com", email_verified: true });
    const verify = makeGoogleVerifier(client, CLIENT_ID);
    await assert.rejects(verify(JWT_LIKE));
    const empty = makeGoogleVerifier(fakeClient(null), CLIENT_ID);
    await assert.rejects(empty(JWT_LIKE));
});

test("G8 un token sin forma de JWT se rechaza sin llamar a Google", async () => {
    const client = fakeClient({ aud: CLIENT_ID });
    const verify = makeGoogleVerifier(client, CLIENT_ID);
    for (const bad of ["abc", "", "a.b", "a.b.c.d", "a.b.c d", 123, null]) {
        await assert.rejects(verify(bad));
    }
    assert.equal(client.calls.length, 0);
});

test("G8 propaga el error de la librería cuando verifyIdToken falla", async () => {
    const verify = makeGoogleVerifier({ verifyIdToken: async () => { throw new Error("firma inválida"); } }, CLIENT_ID);
    await assert.rejects(verify(JWT_LIKE), /firma inválida/);
});
