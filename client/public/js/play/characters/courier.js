// Personaje "Mensajero": diseño original de Viruscity con proporciones Funko (cabeza grande),
// gorra, sudadera, bolso cruzado, jeans y zapatillas. Toma la idea de construcción de las referencias
// (cuerpo por capas, piernas y brazos que se balancean, perfil reflejado para la derecha).
// drawCourier(ctx, dir, isMoving, walkTime, config) dibuja centrado en (0, 0) con los pies en y ≈ +22.
// config = { topColor, capColor, skinColor }

const PANTS = "#1e3a8a";
const SHOES = "#f8fafc";
const SOLE = "#94a3b8";
const BAG = "#78350f";
const BAG_STRAP = "#451a03";
const HAIR = "#1f1b16";
const EYE = "#111827";
const MOUTH = "#7c2d12";

function rr(ctx, x, y, w, h, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
}

function dot(ctx, x, y, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

// Aclara (amt > 0) u oscurece (amt < 0) un color #rrggbb
function tint(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const ch = (v) => Math.round((f - v) * p + v);
    const r = ch((n >> 16) & 255);
    const g = ch((n >> 8) & 255);
    const b = ch(n & 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function drawEyes(ctx, headY) {
    for (const x of [-11, 11]) {
        dot(ctx, x, headY + 3, 6.5, EYE);
        dot(ctx, x + 2, headY + 1, 2.2, "#ffffff");
    }
}

function drawCapFront(ctx, headY, cap) {
    // Copa de la gorra y visera hacia delante
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.roundRect(-24, headY - 21, 48, 15, [14, 14, 3, 3]);
    ctx.fill();
    rr(ctx, -18, headY - 9, 36, 6, 3, tint(cap, -0.25));
    dot(ctx, 0, headY - 20, 2.5, tint(cap, 0.3)); // botón
}

export function drawCourier(ctx, dir, isMoving, walkTime, config) {
    const top = config.topColor;
    const cap = config.capColor;
    const skin = config.skinColor;

    ctx.save();
    const bob = isMoving ? Math.abs(Math.sin(walkTime * 12)) * 3.5 : Math.sin(Date.now() * 0.004) * 1.4;
    const legSwing = isMoving ? Math.sin(walkTime * 12) * 8 : 0;
    const armSwing = isMoving ? Math.sin(walkTime * 12) * 6 : 0;

    if (dir === "RIGHT") ctx.scale(-1, 1);

    // Sombra en el suelo
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 24, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(0, -bob);
    const headY = -28;

    if (dir === "DOWN" || dir === "UP") {
        const front = dir === "DOWN";
        const legL = 14 + (front ? legSwing : -legSwing);
        const legR = 14 - (front ? legSwing : -legSwing);

        // Zapatillas y jeans
        rr(ctx, -14, legL, 10, 9, 3, SHOES);
        rr(ctx, 4, legR, 10, 9, 3, SHOES);
        ctx.fillStyle = SOLE;
        ctx.fillRect(-14, legL + 6, 10, 3);
        ctx.fillRect(4, legR + 6, 10, 3);
        rr(ctx, -13, 2, 10, 15, 3, PANTS);
        rr(ctx, 3, 2, 10, 15, 3, PANTS);

        // Sudadera con bolsillo
        rr(ctx, -14, -11, 28, 17, 5, top);
        ctx.fillStyle = tint(top, -0.18);
        ctx.fillRect(-14, 3, 28, 3); // puño inferior
        if (front) rr(ctx, -7, -3, 14, 6, 2, tint(top, -0.12));

        // Brazos
        for (const side of [-1, 1]) {
            ctx.save();
            ctx.translate(side * 16, -8);
            ctx.rotate((side * (front ? -armSwing : armSwing) * Math.PI) / 180);
            rr(ctx, -3.5, 0, 7, 13, 3, top);
            dot(ctx, 0, 13, 4, skin);
            ctx.restore();
        }

        // Bolso cruzado: correa en diagonal y bolso a un lado
        ctx.strokeStyle = BAG_STRAP;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(front ? -12 : 12, -10);
        ctx.lineTo(front ? 11 : -11, 4);
        ctx.stroke();
        rr(ctx, front ? 7 : -17, -1, 10, 9, 2, BAG);

        // Cabeza
        rr(ctx, -23, headY - 18, 46, 36, 13, skin);
        if (front) {
            // Pelo corto bajo la gorra (patillas) y cara
            ctx.fillStyle = HAIR;
            ctx.fillRect(-23, headY - 8, 4, 9);
            ctx.fillRect(19, headY - 8, 4, 9);
            drawCapFront(ctx, headY, cap);
            drawEyes(ctx, headY);
            dot(ctx, -16, headY + 11, 3.5, "rgba(244, 114, 182, 0.35)");
            dot(ctx, 16, headY + 11, 3.5, "rgba(244, 114, 182, 0.35)");
            ctx.strokeStyle = MOUTH;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(0, headY + 10, 3.5, 0.2, Math.PI - 0.2);
            ctx.stroke();
        } else {
            // De espaldas: nuca con pelo corto y gorra completa con ajuste trasero
            rr(ctx, -23, headY - 6, 46, 20, 10, HAIR);
            ctx.fillStyle = cap;
            ctx.beginPath();
            ctx.roundRect(-24, headY - 21, 48, 18, [14, 14, 4, 4]);
            ctx.fill();
            rr(ctx, -6, headY - 6, 12, 4, 2, tint(cap, -0.3));
        }
    } else {
        // Perfil (se dibuja mirando a la izquierda; la derecha se refleja arriba)
        const stepA = legSwing;
        const stepB = -legSwing;

        // Pierna de atrás
        rr(ctx, -6 + stepB, 14, 11, 8, 3, tint(SHOES, -0.12));
        rr(ctx, -6 + stepB, 2, 10, 14, 3, tint(PANTS, -0.2));

        // Bolso a la espalda y torso
        rr(ctx, 5, -6, 9, 11, 2, BAG);
        rr(ctx, -10, -11, 19, 17, 5, top);
        ctx.fillStyle = tint(top, -0.18);
        ctx.fillRect(-10, 3, 19, 3);
        ctx.strokeStyle = BAG_STRAP;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-2, -11);
        ctx.lineTo(8, -2);
        ctx.stroke();

        // Pierna de delante
        rr(ctx, -9 + stepA, 14, 12, 8, 3, SHOES);
        ctx.fillStyle = SOLE;
        ctx.fillRect(-9 + stepA, 19, 12, 3);
        rr(ctx, -8 + stepA, 2, 11, 14, 3, PANTS);

        // Cabeza de perfil: nuca, cara, oreja, ojo y gorra con visera hacia delante
        rr(ctx, -21, headY - 16, 40, 34, 14, skin);
        rr(ctx, 4, headY - 10, 16, 24, [4, 12, 12, 4], HAIR);
        dot(ctx, 6, headY + 4, 4, tint(skin, -0.1)); // oreja
        dot(ctx, -10, headY + 3, 6, EYE);
        dot(ctx, -8, headY + 1, 2, "#ffffff");
        dot(ctx, -15, headY + 11, 3.5, "rgba(244, 114, 182, 0.35)");
        dot(ctx, -22, headY + 5, 2.5, skin); // nariz
        ctx.fillStyle = cap;
        ctx.beginPath();
        ctx.roundRect(-20, headY - 21, 42, 15, [14, 14, 3, 3]);
        ctx.fill();
        rr(ctx, -31, headY - 9, 20, 5, 2.5, tint(cap, -0.25));

        // Brazo de delante
        ctx.save();
        ctx.translate(-2 - armSwing * 0.8, -7);
        rr(ctx, -3.5, 0, 7, 13, 3, tint(top, -0.08));
        dot(ctx, 0, 13, 4, skin);
        ctx.restore();
    }

    ctx.restore();
}
