// Contraste WCAG AA de los tokens de color (lee css/tokens.css; node:test, sin dependencias).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/css/tokens.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));

// Luminancia relativa y razón de contraste según WCAG 2.x
function luminance(hex) {
    const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;
const PAIRS = [
    ["--text", "--bg"],
    ["--text", "--panel"],
    ["--muted", "--panel"],
    ["--accent", "--bg"],
    ["--accent", "--panel"],
    ["--infected", "--bg"],
    ["--danger", "--bg"],
    ["--cure", "--bg"],
    ["--accent-ink", "--accent"],
    ["--accent-ink", "--danger"], // botón de peligro
    ["--accent-ink", "--cure"],
];

test("la fórmula coincide con valores de referencia de WCAG", () => {
    assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
    assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
});

for (const [fg, bg] of PAIRS) {
    test(`${fg} sobre ${bg} cumple AA (>= ${AA_TEXT}:1)`, () => {
        assert.ok(tokens[fg] && tokens[bg], `faltan tokens ${fg} o ${bg} en tokens.css`);
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        assert.ok(ratio >= AA_TEXT, `${fg} ${tokens[fg]} sobre ${bg} ${tokens[bg]}: ${ratio.toFixed(2)}:1`);
    });
}
