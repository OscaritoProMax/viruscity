// Decisiones PURAS de las acciones de la partida en el cliente (decisiones 5, 11 y 20). El servidor valida
// todo; aquí solo se decide qué mensaje mandar y cuánto esperar, a partir del último 'game'.
//
// decideMissionKey({ game, pos, rules, blocked }) → { action:'start', missionId } | { action:'toast', reason } | { action:'none' }
// completeDelayMs({ missionStartedAt, missionMinMs, clock, localNow, openedAtLocal }) → ms a esperar antes de mission_complete
// missionTimeLeftMs({ missionStartedAt, missionMaxMs, clock, localNow, openedAtLocal }) → ms que le quedan a la misión

import { nearestAvailableStation } from "./view.js";

// Margen sobre MISSION_MIN_MS para que el servidor no la vea "demasiado rápida" por el desfase de relojes
export const COMPLETE_MARGIN_MS = 300;

// Tecla E durante la partida. 'none' deja que E haga lo de siempre (hablar con un vecino o mirar un cartel).
export function decideMissionKey({ game, pos, rules, blocked = false }) {
    if (blocked || game?.phase !== "playing") return { action: "none" };
    const station = nearestAvailableStation(pos, game.missions, rules?.missionRange);
    const role = game.you?.role;
    if (role === "healthy") {
        if (game.you.missionId) return { action: "none" }; // ya tiene una en curso (el minijuego está abierto)
        return station ? { action: "start", missionId: station.id } : { action: "none" };
    }
    // Un infectado junto a una estación: se le recuerda que no puede hacer misiones (sin molestar al servidor)
    if (role === "infected" && station) return { action: "toast", reason: "not_healthy" };
    return { action: "none" };
}

// Hasta missionStartedAt + missionMinMs + margen (hora del servidor). Sin missionStartedAt todavía, se cuenta
// desde que se abrió el minijuego en este navegador.
export function completeDelayMs({ missionStartedAt, missionMinMs, clock, localNow, openedAtLocal }) {
    const min = Number.isFinite(missionMinMs) ? missionMinMs : 0;
    if (Number.isFinite(missionStartedAt)) return clock.remaining(missionStartedAt + min + COMPLETE_MARGIN_MS, localNow);
    const base = Number.isFinite(openedAtLocal) ? openedAtLocal : localNow;
    return Math.max(0, base + min + COMPLETE_MARGIN_MS - localNow);
}

export function missionTimeLeftMs({ missionStartedAt, missionMaxMs, clock, localNow, openedAtLocal }) {
    const max = Number.isFinite(missionMaxMs) ? missionMaxMs : 0;
    if (Number.isFinite(missionStartedAt)) return clock.remaining(missionStartedAt + max, localNow);
    const base = Number.isFinite(openedAtLocal) ? openedAtLocal : localNow;
    return Math.max(0, base + max - localNow);
}
