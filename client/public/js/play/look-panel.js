// Panel compacto "Tu personaje" superpuesto al mapa: pestañas Personaje / Colores / Poder.
// Solo presentación: avisa los cambios con onChange(look) y el uso del poder con onUsePower();
// play.js los envía como extras_update.
//
// createLookPanel({ onChange, onUsePower }) → { setLook(look), getLook(), tick(nowMs) }
// Todo el texto dinámico va con textContent.

import { CHARACTERS, CHARACTER_IDS, SKIN_TONES, lookToExtras } from "./characters/look.js";
import { drawCharacter } from "./characters/index.js";

const $ = (id) => document.getElementById(id);
const PREVIEW_DIRS = ["DOWN", "LEFT", "UP", "RIGHT"];
const PREVIEW_TURN_MS = 1600; // la vista previa gira cada 1,6 s
const CARD_SIZE = 52; // px CSS del canvas de cada tarjeta
const PREVIEW_SIZE = 40;

// Dibuja un personaje centrado en un canvas cuadrado (escala relativa al tamaño del canvas)
function paint(canvas, look, dir, moving, walkTime, zoom = 1, anchor = 0.66) {
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const scale = (size / 100) * zoom;
    ctx.setTransform(scale, 0, 0, scale, size / 2, size * anchor);
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

// Grupo de radio con flechas (tarjetas de personaje y poderes). Las flechas no mueven al jugador.
function radioKeys(box, ids, current, pick, find) {
    box.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        const list = ids();
        const next = list[(list.indexOf(current()) + step + list.length) % list.length];
        pick(next);
        find(next)?.focus();
    });
}

// Botón que pliega o despliega un panel (aria-expanded). Se recuerda por navegador.
export function setupCollapsible(toggleId, bodyId, storageKey, openByDefault) {
    const toggle = $(toggleId);
    const body = $(bodyId);
    let saved = null;
    try {
        saved = localStorage.getItem(storageKey);
    } catch {
        saved = null;
    }
    const apply = (open) => {
        toggle.setAttribute("aria-expanded", String(open));
        body.hidden = !open;
    };
    apply(saved === null ? openByDefault : saved === "1");
    toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        apply(open);
        try {
            localStorage.setItem(storageKey, open ? "1" : "0");
        } catch {
            // sin almacenamiento: dura solo esta visita
        }
    });
}

export function createLookPanel({ onChange, onUsePower }) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let look = lookToExtras({ character: "explorador" });

    // ---------- Pestañas ----------
    const tabs = [...document.querySelectorAll(".play-tab")];
    function selectTab(tab) {
        for (const t of tabs) {
            const on = t === tab;
            t.setAttribute("aria-selected", String(on));
            t.tabIndex = on ? 0 : -1;
            $(t.getAttribute("aria-controls")).hidden = !on;
        }
    }
    for (const t of tabs) t.addEventListener("click", () => selectTab(t));
    tabs[0].parentElement.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation(); // las flechas no mueven al jugador
        const next = tabs[(tabs.findIndex((t) => t.getAttribute("aria-selected") === "true") + step + tabs.length) % tabs.length];
        selectTab(next);
        next.focus();
    });

    // ---------- Tarjetas de personaje ----------
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
    radioKeys(cardsBox, () => CHARACTER_IDS, () => look.character, pickCharacter, (id) => cards.find((c) => c.id === id)?.card);

    // ---------- Muestras ----------
    const colorBox = $("colorSwatches");
    const detailBox = $("detailSwatches");
    const skinBox = $("skinSwatches");
    const colorInput = $("colorInput");
    for (const tone of SKIN_TONES) skinBox.append(makeSwatch(tone.value, `Tono de piel ${tone.label.toLowerCase()}`, (v) => update({ skin: v })));
    colorInput.addEventListener("change", () => update({ color: colorInput.value }));

    // ---------- Poderes ----------
    const powerBox = $("powerOptions");
    radioKeys(powerBox, () => CHARACTERS[look.character].powers.map((p) => p.id), () => look.power, (id) => update({ power: id }), (id) => powerBox.querySelector(`[data-power="${id}"]`));
    $("powerButton").addEventListener("click", () => onUsePower());

    // Paletas y poderes dependen del personaje
    function buildForCharacter() {
        const def = CHARACTERS[look.character];
        $("colorLegend").textContent = def.colorLabel;
        $("detailLegend").textContent = def.detailLabel;
        colorBox.replaceChildren(...def.colors.map((c, i) => makeSwatch(c, `${def.colorLabel}: opción ${i + 1}`, (v) => update({ color: v }))));
        detailBox.replaceChildren(...def.details.map((c, i) => makeSwatch(c, `${def.detailLabel}: opción ${i + 1}`, (v) => update({ detail: v }))));
        powerBox.replaceChildren(
            ...def.powers.map((p) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "play-power";
                button.setAttribute("role", "radio");
                button.dataset.power = p.id;
                button.textContent = p.label;
                button.addEventListener("click", () => update({ power: p.id }));
                return button;
            })
        );
    }

    const markPressed = (box, value) => {
        for (const button of box.children) button.setAttribute("aria-pressed", String(button.dataset.color === value));
    };

    // ---------- Estado ----------
    let builtFor = null;
    function render() {
        if (builtFor !== look.character) {
            buildForCharacter();
            builtFor = look.character;
        }
        for (const { id, card } of cards) {
            const selected = id === look.character;
            card.setAttribute("aria-checked", String(selected));
            card.tabIndex = selected ? 0 : -1; // solo la opción elegida entra en el orden de Tab
        }
        for (const button of powerBox.children) {
            const selected = button.dataset.power === look.power;
            button.setAttribute("aria-checked", String(selected));
            button.tabIndex = selected ? 0 : -1;
        }
        markPressed(colorBox, look.color);
        markPressed(detailBox, look.detail);
        markPressed(skinBox, look.skin);
        colorInput.value = look.color;
        $("lookName").textContent = CHARACTERS[look.character].name;
        $("lookDescription").textContent = CHARACTERS[look.character].description;
        $("powerButton").disabled = look.power === "none";
        drawAll(performance.now(), true);
    }

    function update(changes) {
        look = lookToExtras({ ...look, ...changes });
        render();
        onChange(look);
    }

    // Al cambiar de personaje se conservan color y piel; el detalle y el poder pasan al primero de su
    // lista si el actual no le pertenece (p. ej. de pelo rubio a gorra)
    function pickCharacter(id) {
        if (id === look.character) return;
        const def = CHARACTERS[id];
        update({ character: id, detail: def.details.includes(look.detail) ? look.detail : def.details[0], power: def.powers[0].id });
    }

    // ---------- Dibujo ----------
    const preview = $("lookPreview");
    preview.width = PREVIEW_SIZE * dpr;
    preview.height = PREVIEW_SIZE * dpr;

    function drawAll(nowMs, force = false) {
        const still = reducedMotion.matches;
        if (still && !force) return;
        const dir = still ? "DOWN" : PREVIEW_DIRS[Math.floor(nowMs / PREVIEW_TURN_MS) % PREVIEW_DIRS.length];
        // Miniatura de la cabecera: primer plano de la cabeza
        paint(preview, look, dir, false, 0, 1.3, 0.95);
        for (const { id, canvas } of cards) {
            if (!canvas.isConnected || canvas.offsetParent === null) continue; // pestaña oculta o panel plegado
            const def = CHARACTERS[id];
            const cardLook = lookToExtras({
                ...look,
                character: id,
                detail: def.details.includes(look.detail) ? look.detail : def.details[0],
                power: id === look.character ? look.power : def.powers[0].id,
            });
            paint(canvas, cardLook, id === look.character && !still ? dir : "DOWN", id === look.character && !still, nowMs / 1000, 0.95);
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
