// Efectos visuales de los poderes al activarse (tecla E o botón "Usar poder").
// Son SOLO visuales: no cambian posiciones, no dañan a nadie y no hay lógica de juego.
// La activación viaja en extras.powerOn; cada cliente dibuja el efecto durante POWER_MS
// desde que ve el cambio en el state.
//
// drawPowerEffect(ctx, power, dir, t) con t de 0 a 1 (progreso del efecto). El origen es el centro
// del personaje (los pies en y ≈ +22). jetpackHeight(t) da la altura del salto con la mochila.

const DIR_VECTORS = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

// Altura del salto con la mochila cohete: sube y baja en una curva suave
export const jetpackHeight = (t) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) * 46 : 0);

// Pseudoazar fijo por índice (todos los clientes dibujan lo mismo)
const spread = (i, k) => {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
};

function ring(ctx, x, y, r, color, alpha, width = 2) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function puff(ctx, x, y, r, color, alpha) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function drawPowerEffect(ctx, power, dir, t) {
    if (!(t >= 0 && t < 1)) return;
    const [dx, dy] = DIR_VECTORS[dir] ?? DIR_VECTORS.DOWN;
    const fade = 1 - t;
    // Punto de salida: la mano, un poco hacia donde mira
    const hx = dx * 14;
    const hy = 6 + dy * 10;

    switch (power) {
        case "aura": {
            // Onda telequinética que crece alrededor de la cabeza
            const g = ctx.createRadialGradient(0, -28, 4, 0, -28, 40 + t * 70);
            g.addColorStop(0, `rgba(236,72,153,${(0.55 * fade).toFixed(2)})`);
            g.addColorStop(1, "rgba(168,85,247,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, -28, 40 + t * 70, 0, Math.PI * 2);
            ctx.fill();
            for (let k = 0; k < 3; k++) ring(ctx, 0, -28, 20 + ((t + k / 3) % 1) * 90, "#f0abfc", fade * 0.8);
            break;
        }
        case "walkie": {
            // Ondas de radio desde la mano
            for (let k = 0; k < 3; k++) {
                const p = (t * 1.5 + k / 3) % 1;
                ring(ctx, hx, hy - 10, 8 + p * 60, "#22d3ee", (1 - p) * fade, 2.5);
            }
            break;
        }
        case "vial": {
            // Nube de esporas verdes que se expande
            for (let i = 0; i < 14; i++) {
                const a = spread(i, 1) * Math.PI * 2;
                const d = 10 + t * (50 + spread(i, 2) * 40);
                puff(ctx, Math.cos(a) * d, Math.sin(a) * d * 0.7 - 6, 3 + spread(i, 3) * 4, "#7cff6b", fade * 0.85);
            }
            break;
        }
        case "shotgun": {
            // Fogonazo y perdigones en abanico hacia donde mira
            if (t < 0.3) puff(ctx, hx + dx * 20, hy + dy * 20, 14 * (1 - t * 3) + 4, "#fde047", 1);
            ctx.save();
            ctx.strokeStyle = "#fbbf24";
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.globalAlpha = fade;
            for (let i = 0; i < 5; i++) {
                const ang = Math.atan2(dy, dx) + (i - 2) * 0.14;
                const d = 24 + t * 240;
                const cx = Math.cos(ang);
                const cy = Math.sin(ang);
                ctx.beginPath();
                ctx.moveTo(hx + cx * (d - 18), hy + cy * (d - 18));
                ctx.lineTo(hx + cx * d, hy + cy * d);
                ctx.stroke();
            }
            ctx.restore();
            break;
        }
        case "sword": {
            // Arco de corte delante del personaje
            const base = Math.atan2(dy, dx);
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.lineCap = "round";
            ctx.strokeStyle = "rgba(125,211,252,0.45)";
            ctx.lineWidth = 14;
            ctx.beginPath();
            ctx.arc(0, -4, 44, base - 1.3 + t * 0.9, base - 0.1 + t * 1.5);
            ctx.stroke();
            ctx.strokeStyle = "#f0f9ff";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(0, -4, 44, base - 1.3 + t * 0.9, base - 0.1 + t * 1.5);
            ctx.stroke();
            ctx.restore();
            break;
        }
        case "spray": {
            // Chorro de pintura verde hacia donde mira
            for (let i = 0; i < 12; i++) {
                const d = 12 + ((t + spread(i, 4) * 0.5) % 1) * 70;
                const side = (spread(i, 5) - 0.5) * d * 0.5;
                puff(ctx, hx + dx * d - dy * side, hy + dy * d + dx * side, 3 + spread(i, 6) * 4, "#22c55e", fade * 0.8);
            }
            break;
        }
        case "smg": {
            // Ráfaga de trazadoras y fogonazo intermitente
            if (Math.floor(t * 12) % 2 === 0) puff(ctx, hx + dx * 18, hy + dy * 18, 9, "#fde047", 1);
            for (let i = 0; i < 4; i++) {
                const p = (t * 2 + i / 4) % 1;
                const d = 20 + p * 260;
                ctx.save();
                ctx.globalAlpha = fade;
                ctx.strokeStyle = "#fbbf24";
                ctx.lineWidth = 3.5;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(hx + dx * d, hy + dy * d);
                ctx.lineTo(hx + dx * (d + 22), hy + dy * (d + 22));
                ctx.stroke();
                ctx.restore();
            }
            break;
        }
        case "jetpack": {
            // Anillo de polvo al despegar y al aterrizar (el vuelo lo dibuja el personaje)
            if (t < 0.3 || t > 0.8) ring(ctx, 0, 22, 14 + (t < 0.3 ? t : 1 - t) * 120, "#cbd5e1", 0.6, 3);
            break;
        }
        default:
            break;
    }
}
