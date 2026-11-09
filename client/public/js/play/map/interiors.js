// Interiores (Burger Neón y Supermercado): muebles, casillas sólidas, vecinos, carteles y salida.
// Es PURO (sin canvas): el servidor recibe sus casillas sólidas y sus puertas a través de map-data.js.
// Cada interior está en la zona de interiores del mundo (debajo de la ciudad), en PLACEMENT; las
// coordenadas de cada escena son relativas a su esquina (ox, oy).
// Adaptado de la referencia visual virus_city_map.html (motor procedural de Virus City).
// Dibujo en canvas sin dependencias externas.

import { TILE_SIZE } from "./constants.js";

export const SCENES = {};
// Esquina de cada interior en casillas del mundo (filas 62+; la fila 60-61 es pared)
export const PLACEMENT = { burger: { c0: 2, r0: 62 }, market: { c0: 22, r0: 62 } };

function newScene(id, name, cols, rows) {
    const { c0, r0 } = PLACEMENT[id];
    const sc = { id, name, cols, rows, c0, r0, ox: c0 * TILE_SIZE, oy: r0 * TILE_SIZE, solid: new Uint8Array(cols * rows), objs: [], npcs: [], interactables: [], lights: [], exit: null, spawn: { x: 0, y: 0 } };
    sc.block = (a0, b0, a1, b1) => { for (let r = b0; r <= b1; r++) for (let c = a0; c <= a1; c++) if (c >= 0 && r >= 0 && c < cols && r < rows) sc.solid[r * cols + c] = 1; };
    // sprite con base en el centro-inferior de (c..c+cw-1, r); solid = ancho cw en la fila r
    sc.put = (name, c, r, cw = 1, o = {}) => {
        const x = (c + cw / 2) * TILE_SIZE, y = (r + 1) * TILE_SIZE - (o.dy ?? 6);
        const ob = Object.assign({ sprite: name, x, y, sortY: y, name }, o); sc.objs.push(ob);
        if (o.solid !== false) sc.block(c, r, c + cw - 1, r + (o.rows || 1) - 1); return ob;
    };
    sc.say = (x, y, lines, o = {}) => sc.interactables.push(Object.assign({ x, y, r: 70, lines }, o));
    return sc;
}

// ---------------------------------------------------------------------
//  BURGER NEÓN  (18 × 12)
// ---------------------------------------------------------------------
function buildBurger() {
    const cols = 18, rows = 12, T = TILE_SIZE, sc = newScene('burger', 'Burger Neón', cols, rows);
        sc.put('burgercounter', 1, 5, 12, { dy: 6 });
        sc.put('grill', 2, 2, 2); sc.put('fryer', 5, 2, 1); sc.put('fridge', 7, 2, 1, { dy: 2 }); sc.put('preptable', 9, 2, 2); sc.put('fryer', 12, 2, 1, {});
        [13, 14, 15].forEach((cc, k) => sc.put('arcade' + k, cc, 2, 1, { dy: 4 })); sc.put('jukebox', 16, 2, 1, { dy: 4 });
        sc.put('booth', 1, 7, 2, { rows: 2, dy: 4 }); sc.put('booth', 1, 9, 2, { rows: 2, dy: 4 });
        sc.put('booth', 15, 7, 2, { rows: 2, dy: 4 }); sc.put('booth', 15, 9, 2, { rows: 2, dy: 4 });
        sc.put('stooltable', 4, 8, 2, { dy: 6 }); sc.put('stooltable', 12, 8, 2, { dy: 6 }); sc.put('stooltable', 4, 10, 2, { dy: 6 }); sc.put('stooltable', 12, 10, 2, { dy: 6 });
        sc.put('plant', 1, 6, 1, { dy: 4 }); sc.put('plant', 16, 6, 1, { dy: 4 });
        sc.block(0, 0, 17, 1); sc.block(0, 0, 0, 11); sc.block(17, 0, 17, 11); sc.block(0, 11, 7, 11); sc.block(10, 11, 17, 11);
        sc.exit = { cols: [8, 9], row: 11 }; sc.spawn = { x: 9 * T, y: 10 * T + 6 };
        sc.lights = [{ x: 4 * T, y: 4 * T, r: 220, c: '255,230,170' }, { x: 10 * T, y: 4 * T, r: 220, c: '255,230,170' }, { x: 8.5 * T, y: 8 * T, r: 330, c: '255,240,200' }, { x: 15 * T, y: 4 * T, r: 210, c: '167,139,250' }, { x: 9 * T, y: 0.8 * T, r: 200, c: '244,114,182' }];
        sc.neonSign = { x: 8 * T + 139, y: 38, w: 198, h: 52 };
    
        // --- personajes ---
        sc.npcs.push({ name: 'Cajera Marta', pal: 'cashierPink', x: 108, y: 4.45 * T, dir: 'DOWN', mode: 'idle', speaker: 'Marta (cajera)', lines: ['¡Bienvenida a Burger Neón!', 'Hoy: Hamburguesa Spore a $4.50 y batido verde de regalo.', '...Aunque yo no me tomaría el batido. Brilla en la oscuridad.'] });
        sc.npcs.push({ name: 'Cajero Teo', pal: 'cashierBlue', x: 408, y: 4.45 * T, dir: 'DOWN', mode: 'idle', speaker: 'Teo (cajero)', lines: ['¿Menú doble o menú Cuarentena?', 'El menú Cuarentena viene en bolsa sellada y con guantes. Es muy popular.'] });
        sc.npcs.push({ name: 'Cocinero Beto', pal: 'cook', x: 3 * T, y: 3.7 * T, dir: 'DOWN', mode: 'bob', speaker: 'Beto (cocinero)', lines: ['¡Cuidado, la plancha está caliente!', 'La carne es de res al cien por cien. ...Bueno, al noventa y cinco.'] });
        sc.npcs.push({ name: 'Cliente Lola', pal: 'customerA', x: 2 * T + 8, y: 8.1 * T, dir: 'RIGHT', mode: 'sit', speaker: 'Lola', lines: ['Vengo todos los jueves. Esta mesa tiene la mejor vista de la puerta.', 'Por si acaso, ya sabes.'] });
        sc.npcs.push({ name: 'Niño Pipo', pal: 'kid', x: 14 * T + 24, y: 4.2 * T, dir: 'UP', mode: 'bob', speaker: 'Pipo', lines: ['¡Llevo la máquina VIRUS! en el nivel 9!', 'El jefe final es un germen gigante... ¡y verde!'] });
        sc.npcs.push({ name: 'Cliente Rufo', pal: 'oldman', x: 16 * T + 2, y: 8.1 * T, dir: 'LEFT', mode: 'sit', speaker: 'Don Rufo', lines: ['En mis tiempos las papas fritas no brillaban.', 'Pero están ricas. Y no me han hecho nada. Todavía.'] });
        sc.npcs.push({ name: 'Cliente Nora', pal: 'customerB', x: 9 * T, y: 7.2 * T, dir: 'DOWN', mode: 'walk', path: [[6 * T, 7.2 * T], [11.5 * T, 7.2 * T], [11.5 * T, 9.5 * T], [6 * T, 9.5 * T]], speaker: 'Nora', lines: ['Estoy eligiendo mesa... siempre me cuesta decidir.'] });
    
        // --- interacciones ---
        sc.say(7 * T, 1.9 * T, ['MENÚ NEÓN', 'Hamburguesa Spore $4.50 · Doble Cuarentena $6.00', 'Papas Radiactivas $2.50 · Batido Verde $3.00'], { r: 90 });
        sc.say(16.5 * T, 3.3 * T, ['La rocola ilumina todo el local en rosa y celeste.', '♪ Empieza a sonar una canción sintetizada de los años 80 ♪'], { r: 70, action: 'jukebox' });
        [13.5, 14.5, 15.5].forEach((cx, k) => sc.say(cx * T, 3.4 * T, ['Insert coin... No tienes monedas, pero la pantalla parpadea: "PLAYER 1 READY".'], { r: 36 }));
    SCENES.burger = sc; return sc;
}

// ---------------------------------------------------------------------
//  SUPERMERCADO  (22 × 16)
// ---------------------------------------------------------------------
function buildMarket() {
    const cols = 22, rows = 16, T = TILE_SIZE, sc = newScene('market', 'Supermercado', cols, rows);
        [1, 3, 5, 7, 13, 15, 17, 19].forEach(cc => sc.put('freezer', cc, 2, 2, { dy: 4 }));
        sc.put('producetable', 1, 5, 2, { dy: 4 }); sc.put('producetable', 4, 5, 2, { dy: 4 }); sc.put('producetable', 1, 9, 2, { dy: 4 }); sc.put('producetable', 4, 9, 2, { dy: 4 });
        [8, 11, 14, 17].forEach((cc, k) => { sc.put('shelf' + (k % 6), cc, 5, 2, { dy: 4 }); sc.put('shelf' + ((k + 3) % 6), cc, 9, 2, { dy: 4 }); });
        [3, 7, 14, 18].forEach(cc => sc.put('checkout', cc, 12, 2, { dy: 4 }));
        sc.put('cart', 1, 14, 1, { dy: 4, solid: false }); sc.put('cart', 2, 14, 1, { dy: 4, solid: false }); sc.put('baskets', 19, 14, 1, { dy: 4, solid: false });
        sc.put('mat', 10, 14, 2, { dy: 0, solid: false, sortY: 14 * T }); sc.put('plant', 20, 6, 1, { dy: 4 }); sc.put('plant', 20, 11, 1, { dy: 4 });
        sc.block(0, 0, 21, 1); sc.block(0, 0, 0, 15); sc.block(21, 0, 21, 15); sc.block(0, 15, 9, 15); sc.block(12, 15, 21, 15);
        sc.exit = { cols: [10, 11], row: 15 }; sc.spawn = { x: 11 * T, y: 14 * T + 6 };
        for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) sc.lights.push({ x: (3.5 + k * 5) * T, y: (3.5 + j * 3.4) * T, r: 190, c: '240,250,255' });
    
        // --- personajes ---
        sc.npcs.push({ name: 'Cajera Inés', pal: 'cashierGreen', x: 4 * T, y: 11.55 * T, dir: 'DOWN', mode: 'idle', speaker: 'Inés (cajera)', lines: ['Buenas, ¿encontró todo lo que buscaba?', 'Recuerde: máximo tres latas de comida por persona. Es por el racionamiento.'] });
        sc.npcs.push({ name: 'Cajero Gus', pal: 'cashierBlue', x: 15 * T, y: 11.55 * T, dir: 'DOWN', mode: 'idle', speaker: 'Gus (cajero)', lines: ['¿Bolsa de papel o bolsa antivirus?', 'La antivirus cuesta diez centavos más. Yo siempre llevo la mía.'] });
        sc.npcs.push({ name: 'Guardia Ramírez', pal: 'guard', x: 12.7 * T, y: 13.4 * T, dir: 'DOWN', mode: 'bob', speaker: 'Guardia Ramírez', lines: ['Todo tranquilo por aquí. Nadie entra con la boca tapada.', 'Si ves algo verde en la sección de frutas... avísame. Con discreción.'] });
        sc.npcs.push({ name: 'Comprador Hugo', pal: 'customerA', x: 9.5 * T, y: 7 * T, dir: 'RIGHT', mode: 'walk', path: [[7.5 * T, 7 * T], [20 * T, 7 * T], [20 * T, 8.2 * T], [7.5 * T, 8.2 * T]], speaker: 'Hugo', lines: ['Busco leche sin grumos verdes. Es más difícil de lo que parece.'] });
        sc.npcs.push({ name: 'Reponedora Camila', pal: 'stocker', x: 16 * T, y: 3.6 * T, dir: 'UP', mode: 'walk', path: [[16 * T, 3.6 * T], [9 * T, 3.6 * T], [9 * T, 4.1 * T], [16 * T, 4.1 * T]], speaker: 'Camila (reponedora)', lines: ['Estoy reponiendo los yogures. Hoy llegaron los de fresa... y uno de "sabor misterio".'] });
        sc.npcs.push({ name: 'Niña Luli', pal: 'kid', x: 12.6 * T, y: 7.4 * T, dir: 'LEFT', mode: 'bob', speaker: 'Luli', lines: ['¡Quiero cereal! Mamá dice que no. Pero los dibujitos de la caja me guiñan.'] });
        sc.npcs.push({ name: 'Doña Chela', pal: 'granny', x: 3 * T, y: 8.3 * T, dir: 'RIGHT', mode: 'walk', path: [[3 * T, 8.3 * T], [6.5 * T, 8.3 * T], [6.5 * T, 11 * T], [3 * T, 11 * T]], speaker: 'Doña Chela', lines: ['Las manzanas de hoy brillan más que las de ayer. Qué cosa tan rara, ¿no?'] });
    
        // --- interacciones ---
        sc.say(10 * T, 1.7 * T, ['Una puerta metálica: "SOLO PERSONAL". Se escucha un zumbido eléctrico al otro lado.'], { r: 90 });
        sc.say(16.8 * T, 1.9 * T, ['AVISO SANITARIO', 'Lavarse las manos. No tocar nada de color verde. Reportar toses sospechosas.'], { r: 90 });
        [[1.5, 5.8, 'Manzanas, naranjas y... unas peras con un brillo verde inquietante.'], [4.5, 5.8, 'Verduras frescas. Las lechugas parecen más grandes que ayer.'], [1.5, 9.8, 'Plátanos, uvas y sandías. Todas con etiqueta "sin esporas certificadas".'], [4.5, 9.8, 'Tomates perfectos... demasiado perfectos.']].forEach(([cx, cy, t]) => sc.say(cx * T + 24, cy * T, [t], { r: 70 }));
        [[9, 5.8, 'CEREALES: "Crunchy Spore", "Corn Flakes 85" y uno con un dibujito que te guiña el ojo.'], [12, 5.8, 'CONSERVAS: latas de sopa. Una dice "caduca: 1986". Mejor no.'], [15, 5.8, 'BEBIDAS: refrescos de neón. El verde sabe a lima... o a otra cosa.'], [18, 5.8, 'SNACKS: patatas, palomitas y galletas con forma de bacteria. Ironías de la vida.'], [9, 9.8, 'LIMPIEZA: lejía, jabón y desinfectante. Agotados, claro.'], [12, 9.8, 'PASTAS: espaguetis, macarrones y fideos con forma de virus. De los pocos productos que siguen llenos.'], [15, 9.8, 'CEREALES: otra marca, otra caja que te mira.'], [18, 9.8, 'BEBIDAS: aguas y batidos. Hay un cartel: "Máximo 2 por persona".']].forEach(([cx, cy, t]) => sc.say(cx * T + 24, cy * T, [t], { r: 76 }));
        [2, 4, 6, 14, 16, 18].forEach(cc => sc.say((cc + 1) * T, 2.7 * T, ['Congelador: yogures, helados, nuggets y pizzas. Una puerta está escarchada por dentro con la forma de una mano.'], { r: 70 }));
    SCENES.market = sc; return sc;
}

let built = false;
// Construye las escenas una sola vez (valores por defecto de los vecinos, como addWorldNPC)
export function buildScenes() {
    if (built) return SCENES;
    built = true;
    buildBurger(); buildMarket();
    Object.values(SCENES).forEach(sc => sc.npcs.forEach(n => {
        const d = { dir: 'DOWN', mode: 'walk', pi: 0, wait: 0, wt: 0, moving: false, ph: Math.random() * 6, speed: 0.85 };
        for (const k in d) if (n[k] === undefined) n[k] = d[k];
    }));
    return SCENES;
}
