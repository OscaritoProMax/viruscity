// Dibujo de cualquier personaje a partir de su apariencia (resolveLook).
// drawCharacter(ctx, look, dir, isMoving, walkTime, { flyHeight }) dibuja centrado en (0, 0)
// con los pies en y ≈ +22. El poder elegido (look.power) se ve como objeto en la mano o efecto.

import { drawHeroine } from "./heroine.js";
import { drawExplorer } from "./explorer.js";
import { drawCourier } from "./courier.js";

// Altura aproximada del personaje sobre los pies (para colocar el nombre encima de la cabeza)
export const CHARACTER_HEIGHT = 74;
// Distancia entre el origen del dibujo y la base de los pies
export const FEET_OFFSET = 22;

export function drawCharacter(ctx, look, dir, isMoving, walkTime, opts = {}) {
    if (look.character === "heroina") {
        drawHeroine(ctx, dir, isMoving, walkTime, {
            hairColor: look.detail,
            outfitColor: look.color,
            sleeveColor: "#0d9488",
            tieColor: "#dc2626",
            skinColor: look.skin,
            accessory: look.power ?? "aura",
        });
    } else if (look.character === "mensajero") {
        drawCourier(ctx, dir, isMoving, walkTime, {
            topColor: look.color,
            capColor: look.detail,
            skinColor: look.skin,
            tool: look.power ?? "jetpack",
            flyHeight: opts.flyHeight ?? 0,
        });
    } else {
        drawExplorer(ctx, dir, isMoving, walkTime, { hairColor: look.detail, outfitColor: look.color, skinColor: look.skin, accessory: look.power ?? "shotgun" });
    }
}
