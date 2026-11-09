// Personaje "Explorador": estilo Funko con pelo rizado y chaqueta táctica.
// Adaptado de la referencia visual rpg_funko_2d_movement_demo.html (sin armas: solo el frasco de esporas).
// drawExplorer(ctx, dir, isMoving, walkTime, config) dibuja centrado en (0, 0) con los pies en y ≈ +22.
// config = { hairColor, outfitColor, skinColor, accessory: "vial"|"none" }

export function drawExplorer(ctx, dir, isMoving, walkTime, config) {
    ctx.save();

    // Calculate dynamic animation values
    const bob = isMoving ? Math.abs(Math.sin(walkTime * 12)) * 4 : Math.sin(Date.now() * 0.003) * 1.5;
    const legSwing = isMoving ? Math.sin(walkTime * 12) * 9 : 0;
    const armSwing = isMoving ? Math.sin(walkTime * 12) * 7 : 0;

    // Flip horizontally for RIGHT direction to reuse LEFT drawing code
    if (dir === 'RIGHT') {
        ctx.scale(-1, 1);
    }

    // 1. Dynamic Drop Shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 22, 20 - bob * 0.4, 9 - bob * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Apply vertical head/body bobbing
    ctx.translate(0, -bob);

    // Funko Colors
    const hairColor = config.hairColor;
    const outfitColor = config.outfitColor;
    const skinColor = config.skinColor;
    const pantsColor = '#2b2a33';
    const bootColor = '#1e1b18';

    // -------------------------------------------------------------
    // DIRECTION: DOWN (FRONT VIEW)
    // -------------------------------------------------------------
    if (dir === 'DOWN') {
        // LEGS & BOOTS
        const legYLeft = 14 + legSwing;
        const legYRight = 14 - legSwing;

        // Left Leg/Boot
        ctx.fillStyle = pantsColor;
        ctx.fillRect(-12, 6, 8, 10);
        ctx.fillStyle = bootColor;
        ctx.beginPath();
        ctx.roundRect(-14, legYLeft, 10, 8, 3);
        ctx.fill();

        // Right Leg/Boot
        ctx.fillStyle = pantsColor;
        ctx.fillRect(4, 6, 8, 10);
        ctx.fillStyle = bootColor;
        ctx.beginPath();
        ctx.roundRect(4, legYRight, 10, 8, 3);
        ctx.fill();

        // TORSO / JACKET
        ctx.fillStyle = outfitColor;
        ctx.beginPath();
        ctx.roundRect(-14, -8, 28, 18, 5);
        ctx.fill();
        // Jacket inner shirt / zipper line
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-3, -7, 6, 14);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-14, -8, 28, 18);

        // ARMS (Front view)
        // Left Arm
        ctx.save();
        ctx.translate(-15, -4);
        ctx.rotate((-armSwing * Math.PI) / 180);
        ctx.fillStyle = outfitColor;
        ctx.beginPath();
        ctx.roundRect(-4, 0, 7, 14, 3);
        ctx.fill();
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(-0.5, 13, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Right Arm (Holding Accessory)
        ctx.save();
        ctx.translate(15, -4);
        ctx.rotate((armSwing * Math.PI) / 180);
        ctx.fillStyle = outfitColor;
        ctx.beginPath();
        ctx.roundRect(-3, 0, 7, 14, 3);
        ctx.fill();
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(0.5, 13, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw Accessory in hand
        drawAccessory(ctx, config.accessory, 2, 12, 'DOWN');
        ctx.restore();

        // FUNKO POP GIANT HEAD
        const headY = -28;
        const headW = 46;
        const headH = 36;

        // Back hair layer behind head
        drawCurlyHairBack(ctx, 0, headY, hairColor);

        // Head Base Shape (Soft Funko Trapezoid/Square)
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.roundRect(-headW / 2, headY - headH / 2, headW, headH, 12);
        ctx.fill();

        // Big Glossy Funko Eyes
        drawFunkoEye(ctx, -13, headY + 2);
        drawFunkoEye(ctx, 13, headY + 2);

        // Tiny Nose Bump
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.arc(0, headY + 7, 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Front Curly Hair Volume (Layered locks matching reference image)
        drawCurlyHairFront(ctx, 0, headY, hairColor);
    }

    // -------------------------------------------------------------
    // DIRECTION: UP (BACK VIEW)
    // -------------------------------------------------------------
    else if (dir === 'UP') {
        // LEGS & BOOTS
        const legYLeft = 14 - legSwing;
        const legYRight = 14 + legSwing;

        ctx.fillStyle = pantsColor;
        ctx.fillRect(-12, 6, 8, 10);
        ctx.fillRect(4, 6, 8, 10);

        ctx.fillStyle = bootColor;
        ctx.beginPath();
        ctx.roundRect(-14, legYLeft, 10, 8, 3);
        ctx.roundRect(4, legYRight, 10, 8, 3);
        ctx.fill();

        // ARMS (Swinging at back)
        ctx.fillStyle = outfitColor;
        ctx.fillRect(-18, -4 + armSwing * 0.5, 6, 14);
        ctx.fillRect(12, -4 - armSwing * 0.5, 6, 14);

        // TORSO (Back of Jacket)
        ctx.fillStyle = outfitColor;
        ctx.beginPath();
        ctx.roundRect(-14, -8, 28, 18, 5);
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-14, -8, 28, 18);
        // Backpack straps / jacket seams
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(-7, -8); ctx.lineTo(-7, 10);
        ctx.moveTo(7, -8); ctx.lineTo(7, 10);
        ctx.stroke();

        // GIANT HEAD BACK (FULL CURLY HAIR COVERAGE)
        const headY = -28;
        drawCurlyHairFullBack(ctx, 0, headY, hairColor);
    }

    // -------------------------------------------------------------
    // DIRECTION: LEFT / RIGHT (PROFILE VIEW)
    // -------------------------------------------------------------
    else if (dir === 'LEFT' || dir === 'RIGHT') {
        const stepX1 = legSwing;
        const stepX2 = -legSwing;

        // BACK LEG
        ctx.fillStyle = pantsColor;
        ctx.fillRect(-4 + stepX2, 6, 7, 10);
        ctx.fillStyle = bootColor;
        ctx.beginPath();
        ctx.roundRect(-6 + stepX2, 14, 10, 8, 3);
        ctx.fill();

        // TORSO (Profile)
        ctx.fillStyle = outfitColor;
        ctx.beginPath();
        ctx.roundRect(-10, -8, 18, 18, 5);
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-10, -8, 18, 18);

        // FRONT LEG
        ctx.fillStyle = pantsColor;
        ctx.fillRect(-5 + stepX1, 6, 8, 10);
        ctx.fillStyle = bootColor;
        ctx.beginPath();
        ctx.roundRect(-8 + stepX1, 14, 11, 8, 3);
        ctx.fill();

        // BACK ARM
        ctx.fillStyle = outfitColor;
        ctx.fillRect(2 + armSwing, -4, 6, 12);

        // HEAD PROFILE BASE
        const headY = -28;
        const headW = 42;
        const headH = 36;

        // Skin Base
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.roundRect(-headW / 2 + 2, headY - headH / 2, headW, headH, 12);
        ctx.fill();

        // Side Eye (Single big glossy eye visible)
        drawFunkoEye(ctx, -9, headY + 2);

        // Profile Nose Bump
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(-headW / 2 + 1, headY + 3, 3, 0, Math.PI * 2);
        ctx.fill();

        // FRONT ARM & ACCESSORY
        ctx.save();
        ctx.translate(-4 - armSwing * 0.8, -2);
        ctx.fillStyle = outfitColor;
        ctx.beginPath();
        ctx.roundRect(-3, 0, 7, 13, 3);
        ctx.fill();
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(0, 12, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Accessory held forward
        drawAccessory(ctx, config.accessory, -4, 10, 'LEFT');
        ctx.restore();

        // SIDE CURLY HAIR LAYER
        drawCurlyHairSide(ctx, 0, headY, hairColor);
    }

    ctx.restore();
}

// --- FUNKO EYE RENDERER ---
function drawFunkoEye(ctx, x, y) {
    ctx.save();
    // Black Eye Base
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, Math.PI * 2);
    ctx.fill();

    // Top Eyelash Accent
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    // Primary Gloss Shine Reflection
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 2.2, y - 2.5, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Secondary Micro Shine
    ctx.beginPath();
    ctx.arc(x - 2.5, y + 2.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// --- FUNKO CURLY HAIR GENERATORS ---
function drawCurlyHairFront(ctx, headX, headY, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;

    // Cluster of volumetric curls framing the forehead & sides (matching Funko image)
    const curls = [
        { x: -24, y: headY - 10, r: 11 },
        { x: -18, y: headY - 18, r: 12 },
        { x: -8,  y: headY - 21, r: 13 },
        { x: 3,   y: headY - 21, r: 13 },
        { x: 14,  y: headY - 18, r: 12 },
        { x: 22,  y: headY - 10, r: 11 },
        // Side hanging curly locks
        { x: -25, y: headY + 2,  r: 10 },
        { x: -22, y: headY + 12, r: 9 },
        { x: 23,  y: headY + 2,  r: 10 },
        { x: 20,  y: headY + 12, r: 9 },
        // Forehead bangs curls
        { x: -12, y: headY - 12, r: 7 },
        { x: -3,  y: headY - 13, r: 8 },
        { x: 6,   y: headY - 12, r: 7 }
    ];

    curls.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
    });

    // Highlight strand curves
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    curls.slice(0, 6).forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r - 2, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
    });

    ctx.restore();
}

function drawCurlyHairBack(ctx, headX, headY, color) {
    ctx.save();
    ctx.fillStyle = color;
    const backCurls = [
        { x: -26, y: headY - 4, r: 12 },
        { x: -24, y: headY + 8, r: 11 },
        { x: 24,  y: headY - 4, r: 12 },
        { x: 22,  y: headY + 8, r: 11 }
    ];
    backCurls.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

function drawCurlyHairFullBack(ctx, headX, headY, color) {
    ctx.save();
    ctx.fillStyle = color;
    // Dense array of curls covering full back of head
    for (let x = -24; x <= 24; x += 10) {
        for (let y = headY - 18; y <= headY + 14; y += 10) {
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawCurlyHairSide(ctx, headX, headY, color) {
    ctx.save();
    ctx.fillStyle = color;
    const sideCurls = [
        { x: -18, y: headY - 18, r: 12 },
        { x: -6,  y: headY - 21, r: 13 },
        { x: 8,   y: headY - 20, r: 12 },
        { x: 18,  y: headY - 12, r: 11 },
        { x: 21,  y: headY,      r: 10 },
        { x: 18,  y: headY + 10, r: 9 },
        { x: -4,  y: headY - 13, r: 8 }
    ];
    sideCurls.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

// --- DRAW HELD ACCESSORY ---
function drawAccessory(ctx, type, x, y, dir) {
    if (type === 'none') return;
    ctx.save();
    ctx.translate(x, y);

    if (type === 'vial') {
        // Virus City Spore Vial (Cyan Glow)
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-2, -7, 4, 3);
    }

    ctx.restore();
}

