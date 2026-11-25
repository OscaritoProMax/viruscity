// Página del juego: por ahora solo diseño.
// Con ?preview (y UI.PREVIEW_ENABLED) muestra la vista previa con datos de ejemplo;
// sin ?preview vuelve al lobby, porque la partida real todavía no existe.

import { UI } from "./ui/ui-config.js";
import { createSceneRenderer } from "./ui/scene-renderer.js";
import { createHud } from "./ui/hud.js";
import { createModal } from "./ui/modal.js";
import { startGamePreview } from "./ui/preview.js";

const params = new URLSearchParams(location.search);

if (UI.PREVIEW_ENABLED && params.has("preview")) {
    const canvas = document.getElementById("gameCanvas");
    const renderer = createSceneRenderer(canvas);
    const hud = createHud(document.getElementById("hud"));
    const modal = createModal();
    startGamePreview({ canvas, hud, modal, renderer });
} else {
    // ---------------------------------------------------------------------------------------
    // INTEGRACIÓN REAL (Taller 5): aquí se conectará la partida.
    // La lógica de red vivirá fuera de los módulos de UI y solo los alimentará con datos planos:
    //   const renderer = createSceneRenderer(canvas);   // y en cada actualización del servidor:
    //   renderer.draw(scene, performance.now());       // scene según el contrato de CLAUDE.md
    //   hud.setMe({ username, status }); hud.setCure(pct); hud.setPlayerCount(n);
    //   hud.setTasks(tareas); hud.setHint(texto|null); hud.setInfectCooldown(segundos|null);
    //   hud.setConnection("ok"|"unstable"|"lost");
    //   hud.showRoleIntro({ status }) al empezar y showEndOverlay(...) al terminar.
    // Mientras no exista, la página no tiene nada que mostrar: se vuelve al lobby.
    // ---------------------------------------------------------------------------------------
    window.location.replace("lobby.html");
}
