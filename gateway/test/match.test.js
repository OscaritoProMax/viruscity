// Pruebas del enrutamiento puro del gateway (match.js)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_ROUTES, parseRoutes, parseTarget, matchRoute } = require("../match.js");

test("parseRoutes: rutas por defecto (3 auth y 3 coordinadores), ordenadas de la más larga a la más corta", () => {
    const routes = parseRoutes(DEFAULT_ROUTES);
    assert.equal(routes.length, 6);
    assert.deepEqual(routes.find((r) => r.prefix === "/auth-a"), { prefix: "/auth-a", target: "http://localhost:4001" });
    assert.deepEqual(routes.find((r) => r.prefix === "/coord-c"), { prefix: "/coord-c", target: "http://localhost:5003" });
    const sorted = parseRoutes("/a=http://x:1,/a/b/c=http://x:3,/a/b=http://x:2");
    assert.deepEqual(sorted.map((r) => r.prefix), ["/a/b/c", "/a/b", "/a"]);
    assert.deepEqual(parseRoutes(" /x/ = https://host.example.com/ "), [{ prefix: "/x", target: "https://host.example.com" }], "normaliza barras y espacios");
});

test("parseRoutes y parseTarget: rechazos con motivo claro", () => {
    assert.throws(() => parseRoutes(""), /GATEWAY_ROUTES está vacío/);
    assert.throws(() => parseRoutes("/a"), /entrada 1: debe tener la forma/);
    assert.throws(() => parseRoutes("=http://x:1"), /entrada 1/);
    assert.throws(() => parseRoutes("/=http://x:1"), /no puede ser la raíz/);
    assert.throws(() => parseRoutes("a=http://x:1"), /debe empezar por \//);
    assert.throws(() => parseRoutes("/a=ws://x:1"), /http:\/\/ o https:\/\//);
    assert.throws(() => parseRoutes("/a=nada"), /no es una URL válida/);
    assert.throws(() => parseRoutes("/a=http://x:1,/a=http://x:2"), /prefijo repetido "\/a"/);
    assert.throws(() => parseTarget("GATEWAY_DEFAULT", "http://x:1/?q=1"), /query/);
    assert.equal(parseTarget("GATEWAY_DEFAULT", "http://localhost:3000/"), "http://localhost:3000");
});

test("matchRoute: límites de segmento, prefijo quitado y query intacta", () => {
    const routes = parseRoutes(DEFAULT_ROUTES);
    assert.deepEqual(matchRoute("/auth-a", routes), { prefix: "/auth-a", target: "http://localhost:4001", rest: "/" });
    assert.equal(matchRoute("/auth-a/", routes).rest, "/");
    assert.equal(matchRoute("/auth-a/status", routes).rest, "/status");
    assert.equal(matchRoute("/auth-a/auth/google", routes).rest, "/auth/google");
    assert.equal(matchRoute("/auth-ab", routes), null, "no es un límite de segmento");
    assert.equal(matchRoute("/auth-ab/status", routes), null);
    assert.equal(matchRoute("/AUTH-A/status", routes), null, "distingue mayúsculas");
    assert.deepEqual(matchRoute("/coord-b/connect?token=abc.def", routes), { prefix: "/coord-b", target: "http://localhost:5002", rest: "/connect?token=abc.def" });
    assert.equal(matchRoute("/auth-c?x=1", routes).rest, "/?x=1");
    assert.equal(matchRoute("/coord-a/x?next=/auth-b", routes).target, "http://localhost:5001", "la query no cuenta para el prefijo");
});

test("matchRoute: gana la ruta más larga; la raíz y lo demás no coinciden (van al default)", () => {
    const routes = parseRoutes("/api=http://x:1,/api/v2=http://x:2");
    assert.deepEqual(matchRoute("/api/v2/users", routes), { prefix: "/api/v2", target: "http://x:2", rest: "/users" });
    assert.deepEqual(matchRoute("/api/v1/users", routes), { prefix: "/api", target: "http://x:1", rest: "/v1/users" });
    assert.equal(matchRoute("/api/v2x", routes).prefix, "/api", "v2x no es /api/v2");
    for (const path of ["/", "/login.html", "/js/play/play.js", "", null, "sin-barra"]) assert.equal(matchRoute(path, routes), null, String(path));
});
