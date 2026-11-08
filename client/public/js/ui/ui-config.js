// Configuración visual de Viruscity.
// Estos valores solo se usan para textos de ayuda y para la vista previa:
// el servidor es la única autoridad sobre las reglas reales (longitudes, jugadores, etc.).

export const UI = {
    PREVIEW_ENABLED: true, // vista previa con ?preview=1 mientras se diseña; DEBE ser false antes de la entrega
    MIN_PLAYERS_TO_START: 4,
    SHOW_MIN_PLAYERS_HINT: true,
    USERNAME_MIN: 3,
    USERNAME_MAX: 30,
    PASSWORD_MIN: 6,
    PASSWORD_MAX: 72,
    TOAST_MS: 3500,
    PLAYER_RADIUS_DEFAULT: 16,
};
