// Track 2.1 del examen final: persistencia del estado del juego en el coordinador.
//
// Cada coordinador guarda en SU PROPIA base node:sqlite (STATE_DB_PATH), cada PERSIST_MS:
//   - players: la última posición y extras de los jugadores que conoce como dueño (conectados a él ahora o que se
//     desconectaron de él), con un número de VERSIÓN por jugador;
//   - match: la partida de Viruscity que tiene (la del árbitro, replicada a todos).
// Al arrancar los carga; al entrar al mesh intercambia un world_snapshot con los demás.
//
// Reconciliación (la parte difícil): por cada jugador gana la entrada con MAYOR versión; si empatan, la de savedAt
// mayor y luego el ownerId mayor (determinista). La versión la incrementa el dueño cada vez que el jugador cambia,
// así que el orden no depende de los relojes de cada máquina (que pueden estar desfasados). Un jugador CONECTADO
// AHORA a un coordinador siempre gana sobre lo guardado (es el presente). Las entradas con más de
// PERSIST_MAX_AGE_MS se descartan: un estado de hace horas no debe resucitar a nadie.
//
// Lógica pura: winner, mergeEntry, isFresh, validateEntry, snapshotEntries. E/S: openStateStore (node:sqlite).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const USER_ID_MAX = 64;
const USERNAME_MAX = 64;
const EXTRAS_MAX_BYTES = 1024;
const SNAPSHOT_MAX = 5000;

// ---------- Lógica pura ----------

// ¿Cuál de dos entradas del mismo jugador gana? (versión, luego savedAt, luego ownerId)
function winner(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.version !== b.version) return a.version > b.version ? a : b;
    if (a.savedAt !== b.savedAt) return a.savedAt > b.savedAt ? a : b;
    return a.ownerId >= b.ownerId ? a : b;
}

const isFresh = (entry, now, maxAgeMs) => !!entry && Number.isFinite(entry.savedAt) && now - entry.savedAt <= maxAgeMs;

// Valida una entrada que llega por el mesh o de la base (null si no sirve). Posición dentro del mundo.
function validateEntry(e, cfg) {
    if (!e || typeof e !== "object") return null;
    const userId = typeof e.userId === "number" ? String(e.userId) : e.userId;
    if (typeof userId !== "string" || userId.length < 1 || userId.length > USER_ID_MAX) return null;
    if (typeof e.username !== "string" || e.username.length < 1 || e.username.length > USERNAME_MAX) return null;
    if (![e.x, e.y, e.version, e.savedAt].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    if (!Number.isInteger(e.version) || e.version < 0 || e.savedAt < 0) return null;
    if (typeof e.ownerId !== "string" || e.ownerId.length < 1 || e.ownerId.length > 32) return null;
    const r = cfg?.PLAYER_RADIUS ?? 0;
    if (cfg && (e.x < r || e.y < r || e.x > cfg.WORLD_WIDTH - r || e.y > cfg.WORLD_HEIGHT - r)) return null;
    let extras = {};
    if (e.extras !== undefined && e.extras !== null) {
        if (typeof e.extras !== "object" || Array.isArray(e.extras) || JSON.stringify(e.extras).length > EXTRAS_MAX_BYTES) return null;
        extras = e.extras;
    }
    return { userId, username: e.username, x: e.x, y: e.y, extras, version: e.version, savedAt: e.savedAt, ownerId: e.ownerId };
}

// Fusiona una entrada en el mapa de conocidos (userId → entrada). Devuelve true si la entrante ganó.
// live: userIds conectados ahora a este coordinador (su estado en vivo gana siempre).
function mergeEntry(known, entry, { live = new Set(), now = Date.now(), maxAgeMs = Infinity } = {}) {
    if (!entry || live.has(entry.userId) || !isFresh(entry, now, maxAgeMs)) return false;
    const current = known.get(entry.userId);
    if (winner(current, entry) !== entry || current === entry) return false;
    known.set(entry.userId, entry);
    return true;
}

// Las entradas a guardar/enviar: los jugadores LOCALES en vivo (con su versión ya incrementada si cambiaron) y
// los conocidos (desconectados) que no están en vivo. version(userId, p) decide la versión de cada local.
function snapshotEntries(localPlayers, known, selfId, now, version) {
    const out = [];
    const seen = new Set();
    for (const [userId, p] of localPlayers) {
        out.push({ userId, username: p.username, x: p.x, y: p.y, extras: p.extras ?? {}, version: version(userId, p), savedAt: now, ownerId: selfId });
        seen.add(userId);
    }
    for (const [userId, e] of known) if (!seen.has(userId)) out.push(e);
    return out.slice(0, SNAPSHOT_MAX);
}

// ---------- E/S: base node:sqlite del coordinador ----------
function openStateStore(dbPath) {
    const { DatabaseSync } = require("node:sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            extras TEXT NOT NULL,
            version INTEGER NOT NULL,
            saved_at INTEGER NOT NULL,
            owner_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS match_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            json TEXT NOT NULL,
            saved_at INTEGER NOT NULL
        );
    `);
    const upsert = db.prepare(`INSERT INTO players (user_id, username, x, y, extras, version, saved_at, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, x = excluded.x, y = excluded.y, extras = excluded.extras,
            version = excluded.version, saved_at = excluded.saved_at, owner_id = excluded.owner_id
        WHERE excluded.version > players.version OR (excluded.version = players.version AND excluded.saved_at >= players.saved_at)`);
    const prune = db.prepare("DELETE FROM players WHERE saved_at < ?");
    const all = db.prepare("SELECT user_id, username, x, y, extras, version, saved_at, owner_id FROM players");
    const putMatch = db.prepare("INSERT INTO match_state (id, json, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, saved_at = excluded.saved_at");
    const getMatch = db.prepare("SELECT json, saved_at FROM match_state WHERE id = 1");

    return {
        // Guarda las entradas en una transacción (solo pisa si la versión guardada no es más nueva)
        savePlayers(entries, { pruneBefore = 0 } = {}) {
            db.exec("BEGIN");
            try {
                for (const e of entries) upsert.run(e.userId, e.username, e.x, e.y, JSON.stringify(e.extras ?? {}), e.version, Math.round(e.savedAt), e.ownerId);
                if (pruneBefore > 0) prune.run(Math.round(pruneBefore));
                db.exec("COMMIT");
            } catch (err) {
                db.exec("ROLLBACK");
                throw err;
            }
        },
        loadPlayers() {
            return all.all().map((r) => ({
                userId: r.user_id,
                username: r.username,
                x: r.x,
                y: r.y,
                extras: (() => {
                    try {
                        return JSON.parse(r.extras);
                    } catch {
                        return {};
                    }
                })(),
                version: r.version,
                savedAt: r.saved_at,
                ownerId: r.owner_id,
            }));
        },
        saveMatch(match, savedAt) {
            putMatch.run(JSON.stringify(match), Math.round(savedAt));
        },
        loadMatch() {
            const row = getMatch.get();
            if (!row) return null;
            try {
                return { match: JSON.parse(row.json), savedAt: row.saved_at };
            } catch {
                return null;
            }
        },
        close() {
            db.close();
        },
    };
}

module.exports = { winner, mergeEntry, isFresh, validateEntry, snapshotEntries, openStateStore, SNAPSHOT_MAX };
