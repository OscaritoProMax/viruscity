// Exporta la grilla de colisiones del mapa de Virus City para el coordinator.
//
// El cliente DIBUJA el mapa con public/js/play/map/layout.js; el servidor, que es la autoridad del
// movimiento, necesita saber qué casillas son sólidas. Este script ejecuta el MISMO layout (es puro y
// determinista) y guarda solo los datos que usa el servidor:
//   { id, tile, cols, rows, solid: ["0101…", …], spawns: [[col, row], …] }
//
// Uso (desde client/):  node scripts/export-map.mjs [archivo de salida]
// Por defecto escribe ../coordinator/map/virus-city.json. La prueba client/test/map.test.mjs
// comprueba que el archivo versionado coincide con el layout.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMapData } from "../public/js/play/map/map-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, process.argv[2] ?? "../../coordinator/map/virus-city.json");

const data = buildMapData();
mkdirSync(dirname(out), { recursive: true });
// Una fila de la grilla por línea: el archivo se puede leer (y revisar en un diff) a simple vista
const json = JSON.stringify(data, null, 1).replace(/\[\n\s+(\d+),\n\s+(\d+)\n\s+\]/g, "[$1, $2]");
writeFileSync(out, json + "\n");
const solidCount = data.solid.join("").split("").filter((ch) => ch === "1").length;
console.log(`Mapa "${data.id}" ${data.cols}×${data.rows} (casillas de ${data.tile}) → ${out}`);
console.log(`Casillas sólidas: ${solidCount} · casillas de aparición: ${data.spawns.length}`);
