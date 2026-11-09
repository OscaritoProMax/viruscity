// Nombre de la zona del mapa en una posición del mundo (función pura).
// Adaptado de areaName() de la referencia virus_city_map.html (sin interiores).

import { TILE_SIZE } from "./constants.js";

export function areaName(x, y) {
    const c = Math.floor(x / TILE_SIZE);
    const r = Math.floor(y / TILE_SIZE);
    const inR = (c0, r0, c1, r1) => c >= c0 && c <= c1 && r >= r0 && r <= r1;
    if (inR(27, 2, 48, 10)) return "Parque Central";
    if (inR(27, 15, 48, 25)) return "Plaza Mayor";
    if (inR(26, 46, 49, 57)) return "Lago Sur";
    if (inR(53, 46, 69, 57)) return "Granja Los Brotes";
    if (inR(72, 46, 77, 57)) return "Huerto del Este";
    if (inR(27, 32, 36, 41)) return "Parque Infantil";
    if (inR(16, 36, 22, 41)) return "Aparcamiento";
    if (r >= 27 && r <= 30) return "Avenida Central";
    if (r >= 12 && r <= 13) return "Calle Norte";
    if (r >= 43 && r <= 44) return "Calle Sur";
    if (c >= 24 && c <= 25) return "Calle del Parque";
    if (c >= 50 && c <= 52) return "Boulevard";
    if (c >= 70 && c <= 71 && r > 30) return "Calle Este";
    if ((r === 19 || r === 20) && (c < 23 || c > 53)) return "Callejón del Mercado";
    if (inR(2, 2, 23, 10)) return "Barrio Alameda";
    if (inR(54, 2, 77, 10)) return "Barrio de la Iglesia";
    if (inR(2, 15, 23, 25) || inR(54, 15, 77, 25)) return "Zona Comercial";
    if (inR(2, 46, 25, 57)) return "Camino Verde";
    if (inR(2, 32, 23, 42)) return "Supermercado";
    if (inR(37, 32, 77, 42)) return "Barrio Las Flores";
    return "Virus City";
}
