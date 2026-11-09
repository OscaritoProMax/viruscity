// Personaje "Heroína": estilo Funko de los 80 con trenzas, overol y walkie-talkie.
// Adaptado de la referencia visual rpg_funko_2d_movement_demo_80s_heroine.html / virus_city_map.html.
// drawHeroine(ctx, dir, isMoving, walkTime, config) dibuja centrada en (0, 0) con los pies en y ≈ +22.
// config = { hairColor, outfitColor, sleeveColor, tieColor, skinColor, accessory: "walkie"|"aura"|"vial"|"none" }

export function drawHeroine(ctx, dir, isMoving, walkTime, config) {
    ctx.save();

    // Dynamic movement bounce & swinging physics
    const bob = isMoving ? Math.abs(Math.sin(walkTime * 12)) * 4 : Math.sin(Date.now() * 0.003) * 1.5;
    const legSwing = isMoving ? Math.sin(walkTime * 12) * 9 : 0;
    const armSwing = isMoving ? Math.sin(walkTime * 12) * 7 : 0;
    const braidSway = isMoving ? Math.sin(walkTime * 12) * 6 : Math.sin(Date.now() * 0.004) * 2;

    // Flip horizontally for RIGHT direction to reuse LEFT drawing logic
    if (dir === 'RIGHT') {
        ctx.scale(-1, 1);
    }

    // 1. Drop Shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 22, 20 - bob * 0.4, 9 - bob * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Telekinesis Power Glow Aura (if equipped)
    if (config.accessory === 'aura') {
        ctx.save();
        const glowRadius = 32 + Math.sin(Date.now() * 0.01) * 4;
        const grad = ctx.createRadialGradient(0, -28, 5, 0, -28, glowRadius);
        grad.addColorStop(0, 'rgba(236, 72, 153, 0.6)');
        grad.addColorStop(0.6, 'rgba(0, 229, 255, 0.3)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, -28, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Apply vertical head/body bobbing
    ctx.translate(0, -bob);

    const hairColor = config.hairColor;
    const outfitColor = config.outfitColor;
    const sleeveColor = config.sleeveColor;
    const tieColor = config.tieColor;
    const skinColor = config.skinColor;

    // -------------------------------------------------------------
    // DIRECTION: DOWN (FRONT VIEW)
    // -------------------------------------------------------------
    if (dir === 'DOWN') {
        const legYLeft = 14 + legSwing;
        const legYRight = 14 - legSwing;

        // Left Foot: Pink & White Striped Cast / Sock
        ctx.fillStyle = outfitColor;
        ctx.fillRect(-12, 6, 8, 8);
        ctx.fillStyle = '#f472b6'; // Pink
        ctx.beginPath(); ctx.roundRect(-14, legYLeft, 10, 9, 3); ctx.fill();
        ctx.fillStyle = '#ffffff'; // White stripes
        ctx.fillRect(-14, legYLeft + 2, 10, 2);
        ctx.fillRect(-14, legYLeft + 6, 10, 2);

        // Right Foot: Brown Leather Boot with Teal Trim
        ctx.fillStyle = outfitColor;
        ctx.fillRect(4, 6, 8, 8);
        ctx.fillStyle = '#78350f'; // Brown Boot
        ctx.beginPath(); ctx.roundRect(4, legYRight, 10, 9, 3); ctx.fill();
        ctx.fillStyle = '#0d9488'; // Teal trim cuff
        ctx.fillRect(4, legYRight + 7, 10, 2);

        // TORSO & 80s GEOMETRIC JUMPSUIT
        ctx.fillStyle = outfitColor;
        ctx.beginPath(); ctx.roundRect(-13, 0, 26, 10, [0, 0, 4, 4]); ctx.fill();
        drawJumpsuitPattern(ctx, -13, 0, 26, 10);

        // Teal Upper Body / Collar Insert
        ctx.fillStyle = sleeveColor;
        ctx.beginPath(); ctx.roundRect(-13, -8, 26, 10, [4, 4, 0, 0]); ctx.fill();

        // 80s V-neck Patterned Collar
        ctx.fillStyle = '#eab308';
        ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(6, -8); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#dc2626';
        ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(4, -8); ctx.lineTo(0, -3); ctx.closePath(); ctx.fill();

        // Left Arm
        ctx.save();
        ctx.translate(-15, -4);
        ctx.rotate((-armSwing * Math.PI) / 180);
        ctx.fillStyle = sleeveColor;
        ctx.beginPath(); ctx.roundRect(-4, 0, 7, 13, 3); ctx.fill();
        ctx.fillStyle = skinColor;
        ctx.beginPath(); ctx.arc(-0.5, 12, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Right Arm (Holding Accessory)
        ctx.save();
        ctx.translate(15, -4);
        ctx.rotate((armSwing * Math.PI) / 180);
        ctx.fillStyle = sleeveColor;
        ctx.beginPath(); ctx.roundRect(-3, 0, 7, 13, 3); ctx.fill();
        ctx.fillStyle = skinColor;
        ctx.beginPath(); ctx.arc(0.5, 12, 3.5, 0, Math.PI * 2); ctx.fill();
        drawAccessoryItem(ctx, config.accessory, 2, 10);
        ctx.restore();

        // GIANT FUNKO HEAD Base
        const headY = -28;
        const headW = 46;
        const headH = 36;

        ctx.fillStyle = skinColor;
        ctx.beginPath(); ctx.roundRect(-headW / 2, headY - headH / 2, headW, headH, 12); ctx.fill();

        // Big Glossy Funko Eyes with Eyelashes
        drawFunkoEyeWithLashes(ctx, -13, headY + 2);
        drawFunkoEyeWithLashes(ctx, 13, headY + 2);

        // Tiny Nose Bump
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath(); ctx.arc(0, headY + 7, 1.8, 0, Math.PI * 2); ctx.fill();

        // SMOOTH BLONDE HAIR & MIDDLE PART
        drawSmoothBlondeHairFront(ctx, 0, headY, hairColor);

        // BRAIDED PIGTAILS (LEFT & RIGHT)
        drawBraidedPigtail(ctx, -24, headY + 4, braidSway, hairColor, tieColor);
        drawBraidedPigtail(ctx, 24, headY + 4, -braidSway, hairColor, tieColor);
    }

    // -------------------------------------------------------------
    // DIRECTION: UP (BACK VIEW)
    // -------------------------------------------------------------
    else if (dir === 'UP') {
        const legYLeft = 14 - legSwing;
        const legYRight = 14 + legSwing;

        ctx.fillStyle = outfitColor;
        ctx.fillRect(-12, 6, 8, 8);
        ctx.fillRect(4, 6, 8, 8);

        ctx.fillStyle = '#f472b6';
        ctx.beginPath(); ctx.roundRect(-14, legYLeft, 10, 9, 3); ctx.fill();
        ctx.fillStyle = '#78350f';
        ctx.beginPath(); ctx.roundRect(4, legYRight, 10, 9, 3); ctx.fill();

        ctx.fillStyle = sleeveColor;
        ctx.fillRect(-18, -4 + armSwing * 0.5, 6, 13);
        ctx.fillRect(12, -4 - armSwing * 0.5, 6, 13);

        ctx.fillStyle = outfitColor;
        ctx.beginPath(); ctx.roundRect(-13, -8, 26, 18, 4); ctx.fill();
        drawJumpsuitPattern(ctx, -13, -8, 26, 18);

        const headY = -28;
        drawBlondeHairBack(ctx, 0, headY, hairColor);

        drawBraidedPigtail(ctx, -22, headY + 6, -braidSway, hairColor, tieColor);
        drawBraidedPigtail(ctx, 22, headY + 6, braidSway, hairColor, tieColor);
    }

    // -------------------------------------------------------------
    // DIRECTION: LEFT / RIGHT (FULL PROFILE VIEW WITH BACK HAIR DOME)
    // -------------------------------------------------------------
    else if (dir === 'LEFT' || dir === 'RIGHT') {
        const stepX1 = legSwing;
        const stepX2 = -legSwing;
        const headY = -28;

        // LAYER 0: FAR PIGTAIL (Attached behind the head on the right/back)
        drawBraidedPigtail(ctx, 16, headY + 4, braidSway * 1.2, hairColor, tieColor);

        // LAYER 1: BACK FOOT & LEGS
        ctx.fillStyle = outfitColor;
        ctx.fillRect(-4 + stepX2, 6, 7, 8);
        ctx.fillStyle = '#78350f'; // Brown boot back foot
        ctx.beginPath(); ctx.roundRect(-6 + stepX2, 14, 10, 8, 3); ctx.fill();

        // TORSO PROFILE
        ctx.fillStyle = outfitColor;
        ctx.beginPath(); ctx.roundRect(-10, -8, 18, 18, 5); ctx.fill();
        drawJumpsuitPattern(ctx, -10, -8, 18, 18);

        // FRONT FOOT (Pink striped sock)
        ctx.fillStyle = outfitColor;
        ctx.fillRect(-5 + stepX1, 6, 8, 8);
        ctx.fillStyle = '#f472b6';
        ctx.beginPath(); ctx.roundRect(-8 + stepX1, 14, 11, 8, 3); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-8 + stepX1, 16, 11, 2);

        // BACK ARM (Teal sleeve swinging)
        ctx.fillStyle = sleeveColor;
        ctx.beginPath(); ctx.roundRect(2 + armSwing, -4, 6, 12, 3); ctx.fill();

        // LAYER 2: FULL REAR HAIR DOME (Eliminates baldness on posterior skull)
        // Covers from apex y=headY-24 down to nape y=headY+16 and back to x=+26
        ctx.fillStyle = hairColor;
        ctx.beginPath();
        // Outer head curvature starting from forehead down the back skull
        ctx.arc(2, headY - 2, 23, Math.PI * 0.75, Math.PI * 2.25, false);
        ctx.fill();

        // Extension down the nape of the neck
        ctx.beginPath();
        ctx.roundRect(0, headY - 18, 25, 34, [10, 16, 12, 6]);
        ctx.fill();

        // LAYER 3: VINYL HEAD SKIN BASE (Shifted slightly forward to face direction)
        const faceW = 38;
        const faceH = 34;
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        // Rounded face block positioned from x = -21 forward
        ctx.roundRect(-21, headY - faceH / 2 + 1, faceW, faceH, 14);
        ctx.fill();

        // LAYER 4: FACIAL FEATURES (Single Profile Eye, Lash, Nose Bump & Cheek Blush)
        // Cheek Blush
        ctx.fillStyle = 'rgba(244, 114, 182, 0.25)';
        ctx.beginPath(); ctx.arc(-11, headY + 8, 4.5, 0, Math.PI * 2); ctx.fill();

        // Profile Eye
        drawFunkoEyeWithLashes(ctx, -10, headY + 2);

        // Profile Nose Bump
        ctx.fillStyle = skinColor;
        ctx.beginPath(); ctx.arc(-22, headY + 5, 2.8, 0, Math.PI * 2); ctx.fill();

        // LAYER 5: TOP/FRONT HAIR SWEEP & BANGS
        ctx.fillStyle = hairColor;
        
        // Top Hair Dome & Forehead Parting Sweep
        ctx.beginPath();
        ctx.arc(0, headY - 4, 21.5, Math.PI * 0.85, Math.PI * 1.8, false);
        ctx.fill();

        // Front Bangs draping down over the temple
        ctx.beginPath();
        ctx.roundRect(-23, headY - 14, 14, 16, [10, 4, 6, 10]);
        ctx.fill();

        // Side Hair Lock (framing cheek line)
        ctx.beginPath();
        ctx.roundRect(-15, headY - 4, 10, 16, [4, 4, 8, 8]);
        ctx.fill();

        // Rear Hair Strands / Nape Shading detail
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(4, headY - 20);
        ctx.quadraticCurveTo(16, headY - 8, 20, headY + 12);
        ctx.stroke();

        // LAYER 6: NEAR PIGTAIL (Attached on the near side of head)
        drawBraidedPigtail(ctx, 6, headY + 6, -braidSway * 1.1, hairColor, tieColor);

        // LAYER 7: FRONT ARM & HELD ACCESSORY
        ctx.save();
        ctx.translate(-4 - armSwing * 0.8, -2);
        ctx.fillStyle = sleeveColor;
        ctx.beginPath(); ctx.roundRect(-3, 0, 7, 13, 3); ctx.fill();
        ctx.fillStyle = skinColor;
        ctx.beginPath(); ctx.arc(0, 12, 3.5, 0, Math.PI * 2); ctx.fill();
        drawAccessoryItem(ctx, config.accessory, -4, 10);
        ctx.restore();
    }

    ctx.restore();
}

// --- FUNKO EYE WITH EYELASHES ---
function drawFunkoEyeWithLashes(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, Math.PI * 2);
    ctx.fill();

    // Eyelashes
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, 8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();

    // Outer Lash Flick
    ctx.beginPath();
    ctx.moveTo(x + 6, y - 5);
    ctx.lineTo(x + 9, y - 7);
    ctx.stroke();

    // Glossy Double Shine Spots
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x + 2.2, y - 2.5, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 2.5, y + 2.5, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

// --- BRAIDED PIGTAILS RENDERER ---
function drawBraidedPigtail(ctx, startX, startY, swayAngle, hairColor, tieColor) {
    ctx.save();
    ctx.translate(startX, startY);
    ctx.rotate((swayAngle * Math.PI) / 180);

    // Red Ribbon Hair Tie
    ctx.fillStyle = tieColor;
    ctx.beginPath();
    ctx.roundRect(-4, -2, 8, 4, 2);
    ctx.fill();

    // Braided Segments (Interlaced Oval Loops)
    ctx.fillStyle = hairColor;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;

    const segments = [
        { y: 4,  rx: 5.5, ry: 4, rot: 0.2 },
        { y: 10, rx: 5.0, ry: 4, rot: -0.2 },
        { y: 16, rx: 4.2, ry: 4, rot: 0.2 },
        { y: 21, rx: 3.2, ry: 3.5, rot: 0 }
    ];

    segments.forEach(seg => {
        ctx.save();
        ctx.translate(0, seg.y);
        ctx.rotate(seg.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, seg.rx, seg.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    });

    // Tail tip
    ctx.beginPath();
    ctx.arc(0, 25, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// --- FRONT & BACK HAIR RENDER HELPERS ---
function drawSmoothBlondeHairFront(ctx, headX, headY, color) {
    ctx.save();
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.arc(0, headY - 4, 23, Math.PI * 0.95, Math.PI * 2.05, false);
    ctx.fill();

    // Middle Part Seam
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, headY - 26);
    ctx.lineTo(0, headY - 14);
    ctx.stroke();

    // Side hair framing
    ctx.beginPath();
    ctx.roundRect(-24, headY - 16, 10, 22, 5);
    ctx.roundRect(14, headY - 16, 10, 22, 5);
    ctx.fill();

    ctx.restore();
}

function drawBlondeHairBack(ctx, headX, headY, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-24, headY - 18, 48, 30, 10);
    ctx.fill();
    ctx.restore();
}

// --- JUMPSUIT PATTERN PRINT ---
function drawJumpsuitPattern(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#a855f7'; // Light purple pattern icons
    for (let px = x + 3; px < x + w - 2; px += 7) {
        for (let py = y + 2; py < y + h - 2; py += 6) {
            ctx.fillRect(px, py, 3, 2);
        }
    }
    ctx.restore();
}

// --- ACCESSORY ITEMS ---
function drawAccessoryItem(ctx, type, x, y) {
    if (type === 'none' || type === 'aura') return;
    ctx.save();
    ctx.translate(x, y);

    if (type === 'walkie') {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-3, -2, 7, 12);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(-2, 1, 5, 4);
        ctx.fillStyle = '#00e5ff';
        ctx.fillRect(1, -8, 1.5, 6);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(-1, 0, 1, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'vial') {
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}
