// Lista "Jugadores en línea": retrato del personaje, nombre, zona del mapa e insignia del proveedor.
// Sale de window.lastState (el servidor): no hay otra fuente. Se reconstruye solo cuando cambia algo
// visible (alguien entra o sale, cambia de apariencia o de zona).
//
// createPlayersPanel(listEl, countEl) → { update(players, meId, zoneOf) }
// zoneOf(player) → nombre de la zona o null. Todo el texto va con textContent.

import { resolveLook } from "./characters/look.js";
import { drawCharacter } from "./characters/index.js";

const PROVIDER_LABELS = { google: "Google", local: "Local" };
const PORTRAIT = 48; // px CSS

function portrait(look, dpr) {
    const canvas = document.createElement("canvas");
    canvas.className = "play-player__portrait";
    canvas.width = PORTRAIT * dpr;
    canvas.height = PORTRAIT * dpr;
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    // Primer plano: cabeza y torso del personaje mirando al frente
    const scale = (canvas.width / 100) * 1.25;
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height * 0.92);
    drawCharacter(ctx, look, "DOWN", false, 0);
    return canvas;
}

export function createPlayersPanel(listEl, countEl) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let signature = "";

    function update(players, meId, zoneOf) {
        // El jugador local primero; los demás por nombre
        const sorted = [...players].sort((a, b) => (b.userId === meId) - (a.userId === meId) || String(a.username).localeCompare(String(b.username), "es"));
        const rows = sorted.map((p) => ({ p, look: resolveLook(p), zone: zoneOf(p), isMe: p.userId === meId }));
        const next = rows.map(({ p, look, zone, isMe }) => [p.userId, p.username, p.provider, look.character, look.color, look.detail, look.skin, zone, isMe].join("|")).join(";");
        if (next === signature) return;
        signature = next;

        listEl.replaceChildren(
            ...rows.map(({ p, look, zone, isMe }) => {
                const li = document.createElement("li");
                li.className = "play-player";
                if (isMe) li.classList.add("is-me");
                li.style.setProperty("--player-color", look.color); // único estilo dinámico: el color del jugador

                const info = document.createElement("div");
                info.className = "play-player__info";
                const name = document.createElement("span");
                name.className = "play-player__name";
                name.textContent = String(p.username ?? "");
                if (isMe) {
                    const you = document.createElement("span");
                    you.className = "play-player__you";
                    you.textContent = " (tú)";
                    name.append(you);
                }
                const meta = document.createElement("span");
                meta.className = "play-player__meta";
                meta.textContent = zone ?? "En el mapa";
                info.append(name, meta);

                li.append(portrait(look, dpr), info);
                if (PROVIDER_LABELS[p.provider]) {
                    const badge = document.createElement("span");
                    badge.className = "provider-badge";
                    badge.dataset.provider = p.provider;
                    badge.textContent = PROVIDER_LABELS[p.provider];
                    li.append(badge);
                }
                return li;
            })
        );
        countEl.textContent = String(players.length);
    }

    return { update };
}
