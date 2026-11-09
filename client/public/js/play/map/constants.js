// Medidas del mapa de Virus City. La ciudad son 80 × 60 casillas de 48 px (3840 × 2880).
// Debajo de la ciudad (filas 60 a 79) están los interiores (Burger Neón y Supermercado): el mundo
// completo del servidor mide 80 × 80 casillas (3840 × 3840).
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

export const TILE_SIZE = 48;
export const MAP_COLS = 80;
export const MAP_ROWS = 60; // filas de la ciudad
export const WORLD_ROWS = 80; // ciudad + zona de interiores
export const CITY_WIDTH = MAP_COLS * TILE_SIZE;
export const CITY_HEIGHT = MAP_ROWS * TILE_SIZE;
export const WORLD_WIDTH = MAP_COLS * TILE_SIZE;
export const WORLD_HEIGHT = WORLD_ROWS * TILE_SIZE;
