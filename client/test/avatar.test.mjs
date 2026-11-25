// Pruebas de las funciones puras de avatar.js (node:test, sin dependencias).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashString, colorFromId, initials } from "../public/js/ui/avatar.js";

test("hashString es determinista y devuelve un entero positivo", () => {
    for (const value of ["", "a", "alice", "Ana Pérez", "1", "🦠"]) {
        const h = hashString(value);
        assert.equal(h, hashString(value));
        assert.ok(Number.isInteger(h) && h >= 0, `hash de "${value}" = ${h}`);
    }
    assert.notEqual(hashString("alice"), hashString("bob"));
});

test("colorFromId: mismo id, mismo color; ids distintos comunes, colores distintos", () => {
    assert.equal(colorFromId("42"), colorFromId("42"));
    assert.match(colorFromId("42"), /^hsl\(\d{1,3} 70% 55%\)$/);

    const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "alice", "bob", "carla"];
    const colors = new Set(ids.map(colorFromId));
    assert.equal(colors.size, ids.length, "algún par de ids comunes comparte color");
});

test("initials", () => {
    assert.equal(initials("Ana Pérez"), "AP");
    assert.equal(initials("alice"), "AL");
    assert.equal(initials(""), "?");
    assert.equal(initials("  x "), "X");
});
