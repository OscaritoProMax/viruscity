// Panel "Tu personaje": elegir personaje, color principal, detalle (pelo o gorra) y tono de piel.
// Solo presentación: avisa los cambios con onChange(look) y play.js los envía como extras_update.
//
// createLookPanel({ onChange }) → { setLook(look), getLook(), tick(nowMs) }
// Todo el texto dinámico va con textContent.

import { CHARACTERS, CHARACTER_IDS, SKIN_TONES, lookToExtras } from "./characters/look.js";
import { drawCharacter } from "./characters/index.js";

const $ = (id) => document.getElementById(id);
const PREVIEW_DIRS = ["DOWN", "LEFT", "UP", "RIGHT"];
const PREVIEW_TURN_MS = 1600; // la vista previa gira cada 1,6 s
const CARD_SIZE = 64; // px CSS del canvas de cada tarjeta

// Dibuja un personaje centrado en un canvas cuadrado (escala relativa al tamaño del canvas)
function paint(canvas, look, dir, moving, walkTime, zoom = 1) {
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const scale = (size / 100) * zoom;
    ctx.setTransform(scale, 0, 0, scale, size / 2, size * 0.66);
    drawCharacter(ctx, look, dir, moving, walkTime);
}

function makeSwatch(color, label, onPick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "play-swatch";
    button.style.setProperty("--swatch", color); // único estilo dinámico: el color de la muestra
    button.dataset.color = color;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => onPick(color));
    return button;
}

export function createLookPanel({ onChange }) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let look = lookToExtras({ character: "explorador" });

    // ---------- Tarjetas de personaje (grupo de radio con flechas) ----------
    const cardsBox = $("characterCards");
    const cards = CHARACTER_IDS.map((id) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "play-card";
        card.setAttribute("role", "radio");
        card.dataset.character = id;
        const canvas = document.createElement("canvas");
        canvas.className = "play-card__canvas";
        canvas.width = CARD_SIZE * dpr;
        canvas.height = CARD_SIZE * dpr;
        canvas.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.textContent = CHARACTERS[id].name;
        card.append(canvas, name);
        card.addEventListener("click", () => pickCharacter(id));
        cardsBox.append(card);
        return { id, card, canvas };
    });

    cardsBox.addEventListener("keydown", (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys)) return;
        // Las flechas cambian de personaje y no mueven al jugador
        event.preventDefault();
        event.stopPropagation();
        const current = CHARACTER_IDS.indexOf(look.character);
        const next = CHARACTER_IDS[(current + keys[event.key] + CHARACTER_IDS.length) % CHARACTER_IDS.length];
        pickCharacter(next);
        cards.find((c) => c.id === next).card.focus();
    });

    // ---------- Muestras ----------
    const colorBox = $("colorSwatches");
    const detailBox = $("detailSwatches");
    const skinBox = $("skinSwatches");
    const colorInput = $("colorInput");

    for (const tone of SKIN_TONES) skinBox.append(makeSwatch(tone.value, `Tono de piel ${tone.label.toLowerCase()}`, (v) => update({ skin: v })));
    colorInput.addEventListener("change", () => update({ color: colorInput.value }));

    // Las paletas de color y detalle dependen del personaje
    function buildPalettes() {
        const def = CHARACTERS[look.character];
        $("colorLegend").textContent = def.colorLabel;
        $("detailLegend").textContent = def.detailLabel;
        colorBox.replaceChildren(...def.colors.map((c, i) => makeSwatch(c, `${def.colorLabel}: opción ${i + 1}`, (v) => update({ color: v }))));
        detailBox.replaceChildren(...def.details.map((c, i) => makeSwatch(c, `${def.detailLabel}: opción ${i + 1}`, (v) => update({ detail: v }))));
    }

    function markPressed(box, value) {
        for (const button of box.children) button.setAttribute("aria-pressed", String(button.dataset.color === value));
    }

    // ---------- Estado ----------
    let builtFor = null;
    function render() {
        if (builtFor !== look.character) {
            buildPalettes();
            builtFor = look.character;
        }
        for (const { id, card } of cards) {
            const selected = id === look.character;
            card.setAttribute("aria-checked", String(selected));
            card.tabIndex = selected ? 0 : -1; // solo la tarjeta elegida entra en el orden de Tab
        }
        markPressed(colorBox, look.color);
        markPressed(detailBox, look.detail);
        markPressed(skinBox, look.skin);
        colorInput.value = look.color;
        $("lookName").textContent = CHARACTERS[look.character].name;
        $("lookDescription").textContent = CHARACTERS[look.character].description;
        drawAll(performance.now(), true);
    }

    function update(changes) {
        look = lookToExtras({ ...look, ...changes });
        render();
        onChange(look);
    }

    // Al cambiar de personaje se conservan color y piel; el detalle pasa al primero de su paleta
    // si el actual no le pertenece (p. ej. de pelo rubio a gorra)
    function pickCharacter(id) {
        if (id === look.character) return;
        const def = CHARACTERS[id];
        update({ character: id, detail: def.details.includes(look.detail) ? look.detail : def.details[0] });
    }

    // ---------- Dibujo ----------
    const preview = $("lookPreview");
    preview.width = 96 * dpr;
    preview.height = 96 * dpr;

    function drawAll(nowMs, force = false) {
        const still = reducedMotion.matches;
        if (still && !force) return;
        const dir = still ? "DOWN" : PREVIEW_DIRS[Math.floor(nowMs / PREVIEW_TURN_MS) % PREVIEW_DIRS.length];
        paint(preview, look, dir, !still, nowMs / 1000, 1.05);
        for (const { id, canvas } of cards) {
            // Cada tarjeta muestra su personaje con los colores elegidos (si están en su paleta)
            const def = CHARACTERS[id];
            const cardLook = lookToExtras({ ...look, character: id, detail: def.details.includes(look.detail) ? look.detail : def.details[0] });
            paint(canvas, cardLook, "DOWN", false, 0, 0.95);
        }
    }

    render();

    return {
        setLook(next) {
            look = lookToExtras(next);
            render();
        },
        getLook: () => look,
        tick: (nowMs) => drawAll(nowMs),
    };
}
