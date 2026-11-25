// Misión en curso del jugador local (decisión 11). El minijuego NO se abre de forma optimista: se abre al
// recibir mission_started (o si el 'game' ya trae you.missionId, por ejemplo tras reconectar).
//
// createMissionController({ container, send, clock, getRules, onOpenChange }) → {
//   isOpen(), requestStart(missionId), onGame(game), onEvent(event) → true si el aviso debe callarse,
//   tick(localNow), close()
// }
//   send(msg)            envía un mensaje al servidor (sendJson de play.js)
//   onOpenChange(open)   avisa a play.js: al abrir, el jugador se detiene (intent 0,0) ANTES de bloquear la entrada
//
// Al resolver el minijuego se espera a missionStartedAt + missionMinMs + 300 ms ("Verificando…") y se envía
// mission_complete; si el servidor contesta too_fast se reintenta cada 1 s hasta 3 veces. Esc o Cancelar
// envían mission_cancel. Un mission_result (ok o no) o you.missionId en null cierran el modal.

import { openMinigame } from "./minigames/index.js";
import { formatMMSS } from "./clock.js";
import { completeDelayMs, missionTimeLeftMs } from "./actions.js";

const TOO_FAST_RETRY_MS = 1000;
const TOO_FAST_RETRIES = 3;
// Un 'game' viejo (anterior a mission_started) puede llegar justo después de abrir: no cierra en este margen
const OPEN_GRACE_MS = 1500;

export function createMissionController({ container, send, clock, getRules, onOpenChange = () => {} }) {
    let modal = null;
    let missionId = null;
    let openedAt = 0; // hora local al abrir
    let solved = false;
    let retries = 0;
    let completeTimer = null;
    let lastGame = null;

    const isOpen = () => modal !== null;

    // missionStartedAt del servidor solo si el 'game' habla de esta misma misión
    const startedAt = () => (lastGame?.you?.missionId === missionId ? lastGame.you.missionStartedAt : null);

    function sendAction(action) {
        send({ type: "game_action", action, missionId });
    }

    function open(id) {
        if (isOpen()) return;
        const mission = lastGame?.missions?.find((m) => m.id === id);
        onOpenChange(true); // play.js detiene al jugador mientras la entrada todavía no está bloqueada
        missionId = id;
        openedAt = Date.now();
        solved = false;
        retries = 0;
        modal = openMinigame(mission?.kind ?? "hold", container, {
            title: mission?.title ?? "Misión",
            onSolved,
            onCancel: cancel,
        });
        tick(Date.now());
    }

    function onSolved() {
        solved = true;
        modal?.setInfo("Verificando…");
        const wait = completeDelayMs({ missionStartedAt: startedAt(), missionMinMs: getRules().missionMinMs, clock, localNow: Date.now(), openedAtLocal: openedAt });
        clearTimeout(completeTimer);
        completeTimer = setTimeout(() => sendAction("mission_complete"), wait);
    }

    function cancel() {
        if (!isOpen()) return;
        sendAction("mission_cancel");
        close();
    }

    function close() {
        clearTimeout(completeTimer);
        completeTimer = null;
        if (!modal) return;
        modal.close();
        modal = null;
        missionId = null;
        solved = false;
        onOpenChange(false);
    }

    function tick(localNow) {
        if (!modal) return;
        if (solved) {
            modal.setInfo("Verificando…");
            return;
        }
        const left = missionTimeLeftMs({ missionStartedAt: startedAt(), missionMaxMs: getRules().missionMaxMs, clock, localNow, openedAtLocal: openedAt });
        modal.setInfo(`Tiempo restante ${formatMMSS(left)}`);
    }

    return {
        isOpen,
        close,
        tick,
        requestStart(id) {
            if (isOpen()) return;
            send({ type: "game_action", action: "mission_start", missionId: id });
        },
        onGame(game) {
            lastGame = game;
            if (!game || game.phase !== "playing") {
                close();
                return;
            }
            const current = game.you.missionId;
            if (!isOpen()) {
                if (current) open(current); // reconexión con una misión en curso
                return;
            }
            if (current !== missionId && Date.now() - openedAt > OPEN_GRACE_MS) close();
        },
        onEvent(event) {
            if (event.kind === "mission_started") {
                open(event.missionId);
                return false;
            }
            if (event.kind === "you_infected") {
                close();
                return false;
            }
            if (event.kind !== "mission_result" || !isOpen()) return false;
            if (event.missionId && event.missionId !== missionId) return false;
            if (!event.ok && event.reason === "too_fast" && solved && retries < TOO_FAST_RETRIES) {
                retries += 1;
                modal.setInfo("Verificando…");
                clearTimeout(completeTimer);
                completeTimer = setTimeout(() => sendAction("mission_complete"), TOO_FAST_RETRY_MS);
                return true; // reintento silencioso
            }
            close();
            return false;
        },
    };
}
