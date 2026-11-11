// Vista de depuración del clúster (Taller 6): cada 1 s pide GET {AUTH_URL}/directory y pinta la tabla
// de coordinadores vivos. No necesita sesión. Todo el texto va con textContent (sin innerHTML).
//
// Funciones puras exportadas (se prueban con node:test):
//   summarizeDirectory(data) → { coordinators, totalPlayers }
//   formatUptime(seconds)    → "1 min 5 s"
//   formatAge(ms)            → "0,8 s"

export const REFRESH_MS = 1000;
export const STALE_MS = 4000; // sin latido hace más de 4 s: se marca "sin latir"

// Entradas válidas del directorio y la suma de jugadores (lo inválido se descarta)
export function summarizeDirectory(data) {
    const list = Array.isArray(data?.coordinators) ? data.coordinators : [];
    const coordinators = list
        .filter((c) => c && typeof c.coordinatorId === "string" && c.coordinatorId)
        .map((c) => ({
            coordinatorId: c.coordinatorId,
            publicUrl: typeof c.publicUrl === "string" ? c.publicUrl : "",
            connectedPlayers: Number.isInteger(c.connectedPlayers) && c.connectedPlayers >= 0 ? c.connectedPlayers : 0,
            uptime: Number.isFinite(c.uptime) && c.uptime >= 0 ? c.uptime : 0,
            ageMs: Number.isFinite(c.ageMs) && c.ageMs >= 0 ? c.ageMs : 0,
        }));
    return { coordinators, totalPlayers: coordinators.reduce((sum, c) => sum + c.connectedPlayers, 0) };
}

// 65 → "1 min 5 s"; 3725 → "1 h 2 min 5 s"; 0 → "0 s"
export function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (h) parts.push(`${h} h`);
    if (m) parts.push(`${m} min`);
    if (s || parts.length === 0) parts.push(`${s} s`);
    return parts.join(" ");
}

// 812 → "0,8 s"
export const formatAge = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1).replace(".", ",")} s`;

// ---------- Página (solo en el navegador) ----------
function startPage() {
    const $ = (id) => document.getElementById(id);
    const url = `${window.APP_CONFIG.AUTH_URL}/directory`;

    function cell(text, className) {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = text;
        return td;
    }

    function render(data) {
        const { coordinators, totalPlayers } = summarizeDirectory(data);
        $("summary").textContent =
            coordinators.length === 0
                ? "No hay coordinadores vivos"
                : `${coordinators.length} coordinador${coordinators.length === 1 ? "" : "es"} vivo${coordinators.length === 1 ? "" : "s"} · ${totalPlayers} jugador${totalPlayers === 1 ? "" : "es"}`;
        const rows = coordinators.map((c) => {
            const tr = document.createElement("tr");
            const stale = c.ageMs > STALE_MS;
            if (stale) tr.classList.add("is-stale");
            tr.append(
                cell(c.coordinatorId, "cluster-id"),
                cell(c.publicUrl, "cluster-url"),
                cell(String(c.connectedPlayers), "cluster-num"),
                cell(formatUptime(c.uptime)),
                cell(formatAge(c.ageMs), "cluster-num"),
                cell(stale ? "sin latir" : "latiendo", stale ? "cluster-state cluster-state--stale" : "cluster-state")
            );
            return tr;
        });
        $("rows").replaceChildren(...rows);
        $("emptyRow").hidden = coordinators.length > 0;
        $("updated").textContent = `Actualizado: ${new Date().toLocaleTimeString("es")}`;
    }

    async function refresh() {
        try {
            const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "true" }, cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            render(await res.json());
            $("netNotice").hidden = true;
        } catch {
            // Aviso discreto; la tabla anterior se conserva
            $("netNotice").textContent = "No se pudo contactar al servicio de autenticación. Reintentando…";
            $("netNotice").hidden = false;
        }
        setTimeout(refresh, REFRESH_MS);
    }

    $("authUrl").textContent = window.APP_CONFIG.AUTH_URL;
    refresh();
}

if (typeof document !== "undefined" && typeof window !== "undefined" && window.APP_CONFIG) startPage();
