// Despliegue por túnel con 7 cuentas de ngrok (un túnel por servicio, sin gateway): configura todo de una vez.
//
//   node tunel/configurar.js              lee tunel/tunel.env, escribe los .env y tunel/ngrok-*.yml e imprime
//                                         los 7 comandos de ngrok (también en tunel/abrir-tuneles.cmd)
//   node tunel/configurar.js --simular    muestra qué cambiaría sin escribir nada
//   node tunel/configurar.js --local      deja los .env otra vez con localhost (para jugar sin túnel)
//   opciones: --archivo=<ruta de tunel.env>  --raiz=<carpeta del repo>
//
// Qué cambia (SOLO estas claves; el resto de cada .env queda igual):
//   client/.env                       AUTH_URLS   = los 3 dominios de auth
//   auth-service/.env.auth-a|b|c      PUBLIC_URL  = su dominio · AUTH_NODES = id|dominio|PEER_URL (el mesh sigue local)
//   coordinator/.env.coord-a|b|c      PUBLIC_URL  = wss://su dominio (AUTH_URLS y PEER_URL siguen en localhost)
// Los authtoken solo se copian a tunel/ngrok-<servicio>.yml (no se versionan) y NUNCA se imprimen.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split("=").slice(1).join("=");

const ROOT = path.resolve(option("raiz", path.join(__dirname, "..")));
const TUNEL = path.join(ROOT, "tunel");
const SOURCE = path.resolve(option("archivo", path.join(TUNEL, "tunel.env")));
const LOCAL = flag("local");
const DRY = flag("simular");

// Servicios: clave en tunel.env, archivo .env, puerto por defecto y puerto del inspector de ngrok
const SERVICES = [
    { key: "CLIENT", name: "client", file: "client/.env", port: 3000, web: 4040 },
    { key: "AUTH_A", name: "auth-a", file: "auth-service/.env.auth-a", port: 4001, web: 4041, peer: "ws://localhost:4101" },
    { key: "AUTH_B", name: "auth-b", file: "auth-service/.env.auth-b", port: 4002, web: 4042, peer: "ws://localhost:4102" },
    { key: "AUTH_C", name: "auth-c", file: "auth-service/.env.auth-c", port: 4003, web: 4043, peer: "ws://localhost:4103" },
    { key: "COORD_A", name: "coord-a", file: "coordinator/.env.coord-a", port: 5001, web: 4044 },
    { key: "COORD_B", name: "coord-b", file: "coordinator/.env.coord-b", port: 5002, web: 4045 },
    { key: "COORD_C", name: "coord-c", file: "coordinator/.env.coord-c", port: 5003, web: 4046 },
];
const AUTHS = SERVICES.filter((s) => s.name.startsWith("auth-"));
const COORDS = SERVICES.filter((s) => s.name.startsWith("coord-"));

function fail(message) {
    console.error(`✘ ${message}`);
    process.exit(1);
}

// ---------- .env: leer y cambiar una clave conservando el resto ----------
function parseEnv(text) {
    const out = {};
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
    return out;
}
function setKey(text, key, value) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) return text.replace(re, () => `${key}=${value}`);
    return `${text}${text.endsWith(eol) || text === "" ? "" : eol}${key}=${value}${eol}`;
}

// https://dominio sin ruta, query ni barra final
function readDomain(env, key) {
    const raw = String(env[`${key}_URL`] ?? "").trim();
    if (!raw) fail(`falta ${key}_URL en ${SOURCE}`);
    let url;
    try {
        url = new URL(raw);
    } catch {
        fail(`${key}_URL no es una URL válida`);
    }
    if (url.protocol !== "https:") fail(`${key}_URL debe empezar por https://`);
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) fail(`${key}_URL debe ser solo el dominio (sin ruta): ${raw}`);
    if (/ejemplo/.test(url.hostname)) fail(`${key}_URL sigue con el valor de ejemplo: pon tu dominio de ngrok`);
    return `https://${url.host}`;
}

// ---------- Plan ----------
const files = new Map(); // ruta relativa → { text, env }
for (const s of SERVICES) {
    const full = path.join(ROOT, s.file);
    if (!fs.existsSync(full)) fail(`no existe ${s.file}: cópialo de su .example antes (ver README, "Cómo levantar todo")`);
    const text = fs.readFileSync(full, "utf8");
    files.set(s.file, { text, env: parseEnv(text) });
}
const portOf = (s) => Number(files.get(s.file).env.PORT) || s.port;
const peerOf = (s) => files.get(s.file).env.PEER_URL || s.peer;
const idOf = (s) => files.get(s.file).env.AUTH_ID || s.name;

let tunnel = null;
if (!LOCAL) {
    if (!fs.existsSync(SOURCE)) fail(`no existe ${path.relative(ROOT, SOURCE)}: copia tunel/tunel.example.env como tunel/tunel.env y llénalo`);
    tunnel = parseEnv(fs.readFileSync(SOURCE, "utf8"));
}
const urlOf = (s) => (LOCAL ? `http://localhost:${portOf(s)}` : readDomain(tunnel, s.key));
const domains = Object.fromEntries(SERVICES.map((s) => [s.name, urlOf(s)]));
if (!LOCAL && new Set(Object.values(domains)).size !== SERVICES.length) fail("hay dominios repetidos: cada servicio necesita su propio dominio (una cuenta de ngrok cada uno)");

const changes = []; // { file, key, value }
const authUrls = AUTHS.map((s) => domains[s.name]).join(",");
const authNodes = AUTHS.map((s) => `${idOf(s)}|${domains[s.name]}|${peerOf(s)}`).join(",");
changes.push({ file: "client/.env", key: "AUTH_URLS", value: authUrls });
for (const s of AUTHS) {
    changes.push({ file: s.file, key: "PUBLIC_URL", value: domains[s.name] });
    changes.push({ file: s.file, key: "AUTH_NODES", value: authNodes });
}
for (const s of COORDS) changes.push({ file: s.file, key: "PUBLIC_URL", value: domains[s.name].replace(/^http/, "ws") });

// ---------- Aplicar ----------
console.log(LOCAL ? "Modo local: los .env vuelven a localhost" : `Dominios leídos de ${path.relative(ROOT, SOURCE)}`);
console.log("");
for (const c of changes) {
    const before = files.get(c.file).env[c.key];
    const same = before === c.value;
    console.log(`${same ? "=" : "✎"} ${c.file.padEnd(28)} ${c.key} = ${c.value}`);
    files.get(c.file).text = setKey(files.get(c.file).text, c.key, c.value);
}
if (!DRY) for (const [file, { text }] of files) fs.writeFileSync(path.join(ROOT, file), text);

if (LOCAL) {
    console.log(DRY ? "\n(simulación: no se escribió nada)" : "\nListo. Reinicia los 7 servicios para que lean los .env.");
    process.exit(0);
}

// Configuración de ngrok por cuenta (authtoken + puerto propio del inspector para que no choquen)
const commands = [];
for (const s of SERVICES) {
    const token = String(tunnel[`${s.key}_TOKEN`] ?? "").trim();
    const yml = path.join(TUNEL, `ngrok-${s.name}.yml`);
    if (token) {
        if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) fail(`${s.key}_TOKEN no parece un authtoken de ngrok`);
        if (!DRY) fs.writeFileSync(yml, `version: "3"\nagent:\n  authtoken: ${token}\n  web_addr: localhost:${s.web}\n`);
    } else if (!fs.existsSync(yml)) {
        console.warn(`! falta ${s.key}_TOKEN: el comando de ${s.name} necesitará tunel/ngrok-${s.name}.yml con su authtoken`);
    }
    commands.push({ s, cmd: `ngrok http ${portOf(s)} --url ${domains[s.name]} --config tunel/ngrok-${s.name}.yml` });
}
if (!DRY) {
    const cmdFile = ["@echo off", "rem Abre los 7 túneles de ngrok, cada uno en su ventana (generado por tunel/configurar.js)", "cd /d %~dp0..", ...commands.map(({ s, cmd }) => `start "ngrok ${s.name}" ${cmd}`), ""].join("\r\n");
    fs.writeFileSync(path.join(TUNEL, "abrir-tuneles.cmd"), cmdFile);
}

console.log("\nComandos de ngrok (uno por terminal, desde la raíz del repo; o ejecuta tunel\\abrir-tuneles.cmd):");
for (const { cmd } of commands) console.log(`  ${cmd}`);
console.log(`\nGoogle Cloud → Credenciales → tu ID de cliente OAuth → Orígenes autorizados de JavaScript:\n  ${domains.client}`);
console.log(`\nEntra al juego en ${domains.client}  ·  espectador: ${domains.client}/spectate.html`);
console.log(DRY ? "\n(simulación: no se escribió nada)" : "\nListo. Reinicia los 7 servicios para que lean los .env nuevos.");
