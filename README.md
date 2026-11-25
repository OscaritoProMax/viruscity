# Viruscity · Sistemas Distribuidos · Proyecto final (Partes I, II, III y IV + el juego)

Universidad de Boyacá. Tres procesos independientes que se comunican por red:

- **auth-service** (Taller 7: tres réplicas auth-a/b/c en 4001-4003 con mesh en 4101-4103; un nodo único sigue usando 4000): registro e inicio de sesión con usuario/contraseña **y con Google**. Una sola tabla `users` en SQLite (`node:sqlite`) y JWT HS256.
- **auth-service** además es **directory service** (Taller 6): los coordinadores le avisan que están vivos y el cliente le pregunta a cuál conectarse.
- **coordinator** (tres instancias: coord-a 5001, coord-b 5002 y coord-c 5003, más los puertos del mesh 5101–5103): **servidores autoritativos** del juego en vivo. Reciben a los jugadores por WebSocket, aplican sus *intenciones* en un game loop a 20 Hz (con choques contra el mapa de Virus City) y se replican entre sí por un mesh WebSocket para que todos tengan el mismo mundo.
- **client** (puerto 3000): páginas HTML + JS plano servidas con Express. `login.html` (con botón de Google) y `play.html` (el juego sobre el mapa de la ciudad, con selector de personaje).

**Parte I (Taller 4)** fue la identidad: login con JWT y lobby en vivo. **Parte II (Taller 5)** agrega el juego en vivo con el servidor como autoridad y el login con Google. **Parte III (Taller 6)** reparte el juego entre varios coordinadores intercambiables con el mismo estado. **Parte IV (Taller 7)** replica el auth-service en tres nodos con un líder elegido y failover en coordinadores y cliente. Sobre ese sistema corre **el juego de Viruscity**: sanos que fabrican la cura con misiones contra un infectado oculto, con un árbitro único replicado entre los coordinadores. Este README empieza por Viruscity, sigue con el Taller 7 (auth replicados) y el Taller 6 (el clúster de coordinadores); el Taller 5 sigue siendo válido para el juego, la base de datos y Google, y al final hay un resumen del Taller 4.

**Contenido**
- [Viruscity](#viruscity): 1. Concepto y ciclo · 2. Reglas · 3. Información oculta · 4. Arquitectura · 5. Fallas y limitaciones · 6. Protocolo · 7. Configuración · 8. Controles y archivos · 9. Pruebas · 10. Balance · 11. Demostración
- [Taller 7: auth-services replicados](#taller-7-auth-services-replicados): 1. Arquitectura · 2. Mesh · 3. Elección · 4. Consistencia · 5. Directorio · 6. Failover · 7. Variables · 8. Correr todo · 9. ngrok con gateway · 10. Limitaciones · 11. Sustentación
- [Parte III · Taller 6](#parte-iii--taller-6): 1. Arquitectura · 2. Directorio · 3. Mesh · 4. Los cuatro problemas · 5. Seguridad · 6. Cliente · 7. Variables · 8. Correr el clúster · 9. ngrok · 10. Limitaciones · 11. Decisiones · 12. Sustentación
- [Parte II · Taller 5](#parte-ii--taller-5): 1. Arquitectura · 2. Base de datos · 3. Google · 4. API del auth · 5. Coordinador · 6. Extra: personaje · 7. Cliente · 8. Variables · 9. Correr todo · 10. Google Cloud · 11. ngrok · 12. Decisiones · 13. Errores típicos · 14. Sustentación
- [Estructura del repositorio](#estructura-del-repositorio)
- [Interfaz de Viruscity](#interfaz-de-viruscity)
- [Parte I · Taller 4 (resumen)](#parte-i--taller-4-resumen)
- [Créditos](#créditos)

---

# Viruscity

El juego sobre el clúster del Taller 6: una ciudad con jugadores **sanos** que fabrican la cura con misiones y un **infectado** oculto que contagia a los demás. Todo lo decide el servidor; el cliente solo muestra su vista y manda acciones. Rama `viruscity`; las reglas fijas están en CLAUDE.md, sección "VIRUSCITY – METODOLOGÍA".

**Contenido:** 1. Concepto y ciclo · 2. Reglas · 3. Información oculta · 4. Arquitectura · 5. Fallas y limitaciones · 6. Protocolo · 7. Configuración y partida rápida · 8. Controles y archivos · 9. Pruebas · 10. Balance · 11. Demostración y preguntas

## 1. Concepto y ciclo de la partida

Mientras no hay partida, la ciudad es el **mundo abierto** de siempre. Cuando hay al menos 3 jugadores conectados **en todo el clúster** empieza una cuenta regresiva; al llegar a 0 la partida arranca con los conectados en ese instante (el *roster*), se sortea **un** infectado y todos aparecen en círculo en la plaza.

```
            ≥ 3 conectados                  0 s                   cura 100 % · sin sanos
 ┌────────────┐ ────────► ┌───────────┐ ────────► ┌─────────┐ ────────────────────────► ┌───────┐
 │ open_world │           │ countdown │           │ playing │   sin infectados · tiempo │ ended │
 └────────────┘ ◄──────── └───────────┘           └─────────┘ ────────────────────────► └───────┘
       ▲           < 3          (10 s)                 │  roster < 2: match_cancelled        │
       │                                               └─────────────────────┐              │
       └───────────────────────────────────────────────────────────────────── ┴ ◄────────────┘
                              open_world de nuevo (RESULTS_MS = 15 s con los roles revelados)
```

- **open_world:** caminar libre; sin roles, misiones ni cura. El HUD muestra "Jugadores: conectados/3".
- **countdown** (`MATCH_COUNTDOWN_MS`, 10 s): banner "La partida empieza en N s". Si baja de 3 conectados, vuelve a open_world.
- **playing** (hasta `MATCH_DURATION_MS`, 15 min): pantalla de rol de 4 s, misiones, cura e infección. Quien entra durante la partida es **espectador** (se ve translúcido y no interactúa).
- **ended** (`RESULTS_MS`, 15 s): pantalla de fin con el ganador, el motivo y los roles de todos; luego se borran roles, misiones y cura.

## 2. Reglas

### Infección (tecla F)

| Regla | Valor por defecto |
|---|---|
| Bloqueo inicial del infectado (desde el inicio) | `INITIAL_LOCK_MS` = 60 s |
| Enfriamiento tras contagiar | `INFECT_COOLDOWN_MS` = 2 min |
| Bloqueo del recién infectado | `NEW_INFECTED_LOCK_MS` = 3 min |
| Alcance | `INFECT_RANGE` = 70 px (+ `RANGE_TOLERANCE` = 25 px en el árbitro) |

- Solo un infectado del roster con su bloqueo vencido. El objetivo es el **sano** del roster más cercano dentro del alcance.
- Sin objetivo: `infect_result { ok:false, reason:'no_target' }` y **no** consume el enfriamiento (se puede reintentar).
- La víctima se vuelve infectada (y puede contagiar cuando venza su bloqueo: el virus se propaga), pierde su misión en curso y recibe "Has sido infectado". Todos reciben la alerta pública "Nuevo contagio detectado cerca de <zona>", sin nombres.
- Los infectados no hacen misiones; no saben quiénes más lo están.

### Misiones (tecla E)

6 zonas con 2 estaciones cada una = 12 misiones fijas. En cada partida se eligen al azar **M = min(12, 3 × (roster − 1))** (con 3 jugadores, 6). Son compartidas y se completan una sola vez; cualquier sano puede hacer cualquiera.

| Misión (id = estación) | Zona | Título | Minijuego |
|---|---|---|---|
| hospital-1 | Hospital | Recolectar muestras de pacientes | Secuencia |
| hospital-2 | Hospital | Esterilizar el quirófano | Mantener |
| laboratorio-1 | Laboratorio | Analizar la muestra del paciente cero | Calibración |
| laboratorio-2 | Laboratorio | Secuenciar el genoma del virus | Código |
| farmacia-1 | Farmacia | Preparar el suero base | Cables |
| farmacia-2 | Farmacia | Etiquetar las dosis | Código |
| central-1 | Central de datos | Restaurar el registro de contagios | Cables |
| central-2 | Central de datos | Descargar el historial clínico | Mantener |
| planta-1 | Planta de síntesis | Sintetizar el compuesto | Calibración |
| planta-2 | Planta de síntesis | Purificar el reactor | Secuencia |
| almacen-1 | Almacén | Cargar el suero en los camiones | Mantener |
| almacen-2 | Almacén | Inventariar el cargamento | Código |

Minijuegos (`client/public/js/vc/minigames/`): **Secuencia** (repetir 5 símbolos ▲ ● ■ ◆), **Código** (6 caracteres mostrados 4 s), **Cables** (unir 4 colores), **Calibración** (detener el marcador en la zona verde 3 veces seguidas) y **Mantener** (E pulsada 10 s).

Flujo: el sano llega a la estación (≤ `MISSION_RANGE` = 60 px + tolerancia) y pulsa E → `mission_start` → si el árbitro acepta, la misión queda `in_progress` reservada a él y el jugador queda **inmóvil** (el servidor ignora su movimiento) → el cliente abre el minijuego **solo** al recibir `mission_started` → al resolverlo espera a `missionStartedAt + MISSION_MIN_MS + 300 ms` ("Verificando…") y manda `mission_complete` → el árbitro la acepta si pasaron entre `MISSION_MIN_MS` (8 s) y `MISSION_MAX_MS` (45 s), el jugador sigue en rango y sigue sano. Esc o "Cancelar" mandan `mission_cancel`. La misión se libera sola si expira, si el jugador se infecta, se desconecta o se aleja.

### Cura y victoria

- Cada misión hecha suma **100/M** a la cura (la última deja exactamente 100). La barra es pública: la ven todos, infectados incluidos.
- Orden de evaluación: **cura ≥ 100** → ganan los jugadores · **sin sanos** en el roster → ganan los infectados · **sin infectados** en el roster → ganan los jugadores · **tiempo agotado** → ganan los infectados.
- Si el roster queda con menos de 2 personas (conectadas o en gracia) la partida se cancela (`match_cancelled`) y vuelve a open_world.

### Espectadores y reconexión

- Quien entra durante `playing` (o no estaba en el roster) es espectador: `you.role = 'spectator'`, se dibuja con `ghost:true` (35 % de opacidad, sin insignia) y E y F no actúan sobre la partida (E sigue sirviendo para hablar o mirar).
- Un miembro del roster que se desconecta conserva su rol durante `RECONNECT_GRACE_MS` (60 s) y su misión se libera de inmediato. Si vuelve a **cualquier** coordinador en ese plazo, recupera su rol y reaparece en su punto de la plaza; si no, sale del roster y se reevalúa la victoria.

## 3. Información oculta: qué ve cada rol

| | Sano | Infectado | Espectador | Al terminar |
|---|---|---|---|---|
| Su propio rol | sí (pantalla de rol y chip "SANO") | sí ("INFECTADO · m:ss") | "ESPECTADOR" | — |
| Rol de los demás | **no** | **no** (ni quiénes más están infectados) | no | **sí, de todos** (results) |
| Misiones y cura | lista y barra; anillos dorados que laten | lista y barra; anillos apagados | lista y barra | sí |
| Quién hace una misión | **no** | **no** | no | — |
| Alerta de contagio | solo la zona | solo la zona | solo la zona | — |
| Enfriamiento de F | — | el propio (`infectReadyAt`) | — | — |

Cómo se garantiza (verificado en la auditoría de la Fase V6):

- **Vistas personalizadas:** el árbitro guarda el estado completo, pero a cada cliente se le manda `buildClientView(state, userId)` (coordinator/match.js): fase, tiempos, cura, misiones **sin** `by` ni `startedAt`, y `you` con **solo su** rol. `infectReadyAt` solo va a un infectado del roster.
- **Roles solo en `results`:** la tabla de roles viaja únicamente en la fase `ended`.
- **Eventos personales** (`match_started`, `you_infected`, `infect_result`, `mission_*`) llevan `to` y solo se entregan si ese jugador es local del coordinador (arbiter.js, `routeEvents`); `contagion_alert` solo lleva la zona.
- **`state` (20 Hz) y `/status`** no llevan roles: `state` solo agrega `ghost:true` a quien no está en el roster; `/status.match` es `{ phase, matchId, rev, cure, rosterSize, arbiterId }`.
- **Extras sin datos de la partida:** los extras (apariencia) se reenvían a todos, así que `sanitizeExtras` rechaza los que traen las claves `role`, `infected`, `status` o `cure` (en cualquier mayúscula), tanto desde un cliente como desde un peer.
- **El cliente** guarda solo el último `game` (su vista); no hay ningún lugar donde guarde roles ajenos.
- **Logs:** nunca imprimen roles; los smokes revisan que no aparezcan "infected" ni "healthy" en los logs.

## 4. Arquitectura

```
 navegador ──WS──► coord-b (seguidor) ──game_action──► coord-a (ÁRBITRO: match.js) ──game_state──► coord-b, coord-c
     ▲                    │ adopta el game_state                    │ aplica la acción con applyAction       │
     └── game + event ◄───┘ (vista y eventos de SUS jugadores)        └── a sus propios clientes ◄─────────────┘
```

- **Reducer puro** (`coordinator/match.js`): `advance(state, ctx)` (cuenta regresiva, inicio, expiraciones, gracia, victoria) y `applyAction(state, userId, action, ctx)` devuelven un estado nuevo y una lista de eventos; reloj (`ctx.now`) y azar (`ctx.rng`) inyectados, sin red ni efectos. `match.rev` crece en cada cambio y `match.eid` en cada evento.
- **Un solo árbitro:** el coordinador de **menor `coordinatorId`** entre él y sus peers ready (`computeArbiter`, comparación de strings). Solo él avanza la partida y procesa acciones.
- **Replicación:** el árbitro manda `game_state { origin, match, events }` cada `MATCH_REPLICATE_MS` (250 ms) en countdown/playing/ended, cada 1000 ms en open_world, y de inmediato tras procesar una acción (máximo una vez cada 50 ms). Cada mensaje lleva como mucho 100 eventos (si hay más, se parte).
- **Acciones reenviadas:** un cliente siempre habla con su coordinador; si ese no es el árbitro, la reenvía como `game_action { origin, userId, action }` (solo el dueño del jugador puede hacerlo). Si no hay conexión con el árbitro, el cliente recibe `arbiter_unavailable`.
- **Eventos con `eid`:** cada coordinador entrega a sus clientes solo los eventos con `eid` mayor al último entregado (sin duplicados al cambiar de árbitro; si `eid` retrocede, el contador se reinicia).
- **Aceptación de un `game_state`** (decisión 18): (a) si viene del árbitro que calculo, se adopta siempre; (b) si trae `handover:true`, yo soy el árbitro y no tengo estado o el suyo es más nuevo por `(matchId, rev)`, se adopta y sigo siendo árbitro; (c) todo lo demás se ignora.
- **Relevo por caída:** si el árbitro cae, el siguiente id menor asume **con el último estado replicado** y lo replica de inmediato. Sus clientes reconectan por el directorio a otro coordinador y conservan el rol (gracia).
- **Handover al reingresar:** cuando vuelve un coordinador de id menor, el árbitro saliente le manda `handover:true` con el estado al completar el handshake; el que vuelve espera hasta `GAME_SYNC_WAIT_MS` (1,5 s) ese estado antes de avanzar nada (también al formarse la malla).
- La partida usa las posiciones de la simulación de cada coordinador; las de jugadores remotos llegan por el mesh, por eso el árbitro aplica `RANGE_TOLERANCE` a los rangos.

## 5. Qué pasa en cada falla y limitaciones conocidas

| Falla | Qué pasa |
|---|---|
| Cae el árbitro (coord-a) | coord-b (siguiente id menor) asume en milisegundos con el último `game_state`; los clientes de coord-a reconectan a coord-b o coord-c en < 1 s y siguen con su rol. Una misión que estaba en curso puede perderse (vuelve a disponible). |
| Cae un seguidor | El árbitro sigue; los jugadores de ese coordinador se desconectan, reconectan a otro y conservan su rol durante la gracia; su misión se libera. |
| Vuelve el árbitro de id menor | Handover: recibe el estado más nuevo y retoma la partida sin reiniciarla. |
| Se parte la red | Cada lado calcula su propio árbitro (dos árbitros) y la partida diverge. Al reunirse la malla, el de id menor vuelve a ser el único árbitro: recibe el handover del otro y adopta su estado si es más nuevo por `(matchId, rev)` (si no, conserva el suyo); el otro pasa a seguidor y adopta lo que replique el árbitro. Lo hecho en el lado que pierde se descarta. |
| Un peer con el secreto manda basura | `game_state` y `game_action` se validan entero (`validateMatchState`, `sanitizeGameAction`); un `game_state` que no viene del árbitro se ignora y un `game_action` sobre jugadores ajenos también. |

Limitaciones conocidas:

- **Rangos con posiciones remotas:** el árbitro ve a los jugadores de otros coordinadores con un poco de retraso; por eso suma `RANGE_TOLERANCE` (25 px). En el borde del rango una acción puede aceptarse o rechazarse según ese retraso.
- **Una misión en curso puede perderse en un relevo** (si el `game_state` con ella no llegó antes de la caída): el jugador ve que se cerró y la puede repetir.
- **Los minijuegos se resuelven en el cliente:** un cliente modificado puede "resolverlos" sin jugar. El servidor valida lo que importa: que el jugador esté sano, en rango, inmóvil y que haya pasado al menos `MISSION_MIN_MS` (no se puede acelerar la cura).
- **Sin persistencia:** la partida vive en memoria de los coordinadores; si se caen todos a la vez, se pierde.
- **Mapa real:** las coordenadas de la ciudad están normalizadas para cualquier tamaño de mundo, pero sobre el mapa de Virus City (3840 × 3840, `MAP_FILE`) 6 de las 12 estaciones y el centro de la plaza caen en casillas sólidas. Para jugar Viruscity se usa el mundo sin mapa (`MAP_FILE=` vacío, 1200 × 800) hasta ubicar la ciudad a mano sobre el mapa.
- **Varias pestañas en el mismo navegador comparten la sesión** (localStorage, Taller 5): para probar con varios jugadores en un equipo se usan navegadores o perfiles distintos (por ejemplo Chrome, una ventana de incógnito y Edge).

## 6. Protocolo

### Cliente ↔ servidor (contrato de CLAUDE.md, decisión 20)

Cliente → servidor:

```js
{ type:'game_action', action:'infect'|'mission_start'|'mission_complete'|'mission_cancel', missionId? }
// máx. 5 por segundo por socket (el exceso se descarta); missionId con patrón ^[a-z0-9-]{1,40}$
```

Servidor → cliente:

- `welcome` gana `city:{ zones:[{id,name,x,y,w,h}], stations:[{id,zoneId,x,y}], plaza:{x,y} }` y `game:{ minPlayers, missionMinMs, missionMaxMs, infectRange, missionRange }`.
- `game` (cada `GAME_VIEW_MS` = 250 ms y tras cada evento; personalizado):

```js
{ type:'game', serverTime, phase, minPlayers, connected, countdownEndsAt?, startedAt?, endsAt?, resultsEndsAt?, cure,
  missions:[{ id, zoneId, stationId, x, y, title, kind, status }],
  you:{ role:'healthy'|'infected'|'spectator'|null, infectReadyAt:number|null, missionId:string|null, missionStartedAt:number|null },
  results?:{ winner, reason, players:[{ userId, username, role }] } }
// you.role es null en open_world y countdown; results solo en ended; infectReadyAt solo para un infectado del roster
```

- `event`: `{ type:'event', kind, ... }` con los kinds `match_started {role}` · `you_infected` · `infect_result {ok, reason?}` · `mission_started {missionId}` · `mission_result {ok, missionId, reason?}` · `contagion_alert {zone}` · `cure_update {cure}` · `match_cancelled {reason}` · `match_ended {winner}`. Motivos de fallo: `not_playing`, `spectator`, `not_infected`, `cooldown`, `no_target`, `not_healthy`, `busy`, `not_available`, `too_far`, `too_fast`, `expired`, `infected`, `cancelled`, `no_active_mission`, `arbiter_unavailable`.
- `state` (20 Hz) mantiene su formato y añade `ghost:true` a los jugadores fuera del roster durante playing.

El cliente valida cada `game` y `event` contra este contrato (`js/vc/view.js`, `parseServerMessage`) y descarta los mal formados.

### Mesh (decisión 17; validados como todos los del Taller 6)

```js
{ type:'game_action', origin, userId, action:{ kind:'infect'|'mission_start'|'mission_complete'|'mission_cancel', missionId? } }
// solo el dueño del jugador la envía; solo el árbitro la procesa
{ type:'game_state', origin, handover?, match, events:[...] }
// del árbitro a todos (handover:true del árbitro saliente al que vuelve); match pasa por validateMatchState
```

## 7. Configuración

Todas en el `.env` de cada coordinador (`.env.coord-a`, …; los `.example` traen los valores por defecto). Son solo de balance y pruebas: el cliente las recibe en `welcome.game` o en cada `game`.

| Variable | Efecto | Por defecto |
|---|---|---|
| `MIN_PLAYERS_TO_START` | Jugadores conectados (en todo el clúster) para empezar la cuenta | 3 |
| `MATCH_COUNTDOWN_MS` | Duración de la cuenta regresiva | 10000 |
| `INITIAL_LOCK_MS` | Bloqueo del infectado inicial desde el inicio | 60000 |
| `INFECT_COOLDOWN_MS` | Enfriamiento del que contagió | 120000 |
| `NEW_INFECTED_LOCK_MS` | Bloqueo del recién infectado | 180000 |
| `MATCH_DURATION_MS` | Duración máxima de la partida (al agotarse ganan los infectados) | 900000 |
| `RESULTS_MS` | Tiempo de la pantalla de fin | 15000 |
| `RECONNECT_GRACE_MS` | Cuánto conserva el rol un jugador desconectado | 60000 |
| `MISSION_MIN_MS` | Tiempo mínimo entre `mission_start` y `mission_complete` | 8000 |
| `MISSION_MAX_MS` | Tiempo máximo de una misión (luego expira) | 45000 |
| `INFECT_RANGE` | Alcance de la infección (px) | 70 |
| `MISSION_RANGE` | Distancia máxima a la estación (px) | 60 |
| `RANGE_TOLERANCE` | Margen que suma el árbitro a ambos rangos (posiciones remotas) | 25 |
| `MATCH_REPLICATE_MS` | Cada cuánto replica el árbitro en countdown/playing/ended | 250 |
| `GAME_TICK_MS` | Cada cuánto avanza el reducer (`advance`) | 200 |
| `GAME_VIEW_MS` | Cada cuánto se manda `game` a cada cliente | 250 |
| `GAME_SYNC_WAIT_MS` | Espera de un árbitro sin estado (o recién unido a la malla) por un handover | 1500 |

Además siguen las del Taller 6 (identidad, puertos, URLs y secretos) y las del Taller 5 (mapa, velocidad, tick). `MAP_FILE` vacío = mundo de 1200 × 800 sin mapa (recomendado para Viruscity, ver limitaciones).

### Receta: partida rápida para probar

1. En `coordinator/.env.coord-a`, `-b` y `-c` (los tres iguales):

   ```
   MAP_FILE=
   MATCH_COUNTDOWN_MS=3000
   INITIAL_LOCK_MS=5000
   INFECT_COOLDOWN_MS=8000
   NEW_INFECTED_LOCK_MS=12000
   MISSION_MIN_MS=3000
   MATCH_DURATION_MS=180000
   RESULTS_MS=8000
   ```

2. Levantar todo como en el Taller 6 (cinco terminales): `cd auth-service && npm start` · `cd coordinator && npm run start:a` (y `start:b`, `start:c`) · `cd client && npm start`.
3. Abrir `http://localhost:3000` en **tres navegadores o perfiles distintos** y entrar con tres usuarios. Al entrar el tercero empieza la cuenta (3 s).
4. Para volver a la partida real, borrar esas líneas (o volver a los valores de los `.example`) y reiniciar los coordinadores.

## 8. Controles y archivos

| Tecla | Acción |
|---|---|
| WASD o flechas | Moverse |
| E | Iniciar la misión de la estación cercana (sano); si no hay, hablar con un vecino o mirar un cartel |
| F | Infectar al sano más cercano (infectado) |
| Esc | Cancelar el minijuego (manda `mission_cancel`) o cerrar una conversación |
| Cualquier tecla | Cerrar la pantalla de rol |
| 1-4 · Espacio · E (mantener) | Dentro de los minijuegos: Secuencia, Calibración y Mantener |
| Q | Poder del personaje (solo visual, Taller 5) |

```
coordinator/
├── city.js        # 6 zonas normalizadas, 12 estaciones y la plaza; zoneNear() para la alerta
├── missions.js    # catálogo de las 12 misiones y pickMissions(count, rng)
├── match.js       # reducer puro: createMatchState, advance, applyAction, buildClientView, validateMatchState
├── arbiter.js     # computeArbiter, shouldAdoptGameState, sanitizeGameAction, selectEventsToDeliver, routeEvents
├── index.js       # tickers del árbitro, replicación, reenvío de acciones, relevo y handover
└── scripts/viruscity-smoke.js   # npm run smoke:viruscity (V1-V12, X1-X7 con --coordinators=3)
client/public/
├── css/vc.css     # HUD, pantallas de rol y de fin, minijuegos
└── js/vc/
    ├── view.js        # parseServerMessage, textos de eventos y motivos, pistas, pantallas (puro)
    ├── clock.js       # reloj sincronizado con serverTime y formatMMSS (puro)
    ├── actions.js     # qué hacen E y F, cuánto esperar antes de mission_complete (puro)
    ├── city-render.js # ciudad, plaza y anillos de las estaciones en el canvas
    ├── hud.js         # chip de fase y rol, cura, jugadores, misiones, pista, avisos, pantallas de rol y fin
    ├── mission.js     # minijuego de la misión en curso (abrir, verificar, reintentar, cancelar)
    └── minigames/     # index.js (modal accesible) y sequence, code, wires, slider, hold
```

## 9. Pruebas

| Comando | Qué prueba |
|---|---|
| `cd auth-service && npm test` | 39 pruebas: registro, login, Google, migración y directorio |
| `cd coordinator && npm test` | 125 pruebas: juego del Taller 5, mesh, configuración, ciudad, misiones, reducer M1-M10 (con inmutabilidad verificada), vistas, árbitro, validación del estado replicado y extras |
| `cd client && npm test` | 111 pruebas: utilidades del juego, mapa, personajes, directorio, lógica de la partida (vistas, reloj, textos, acciones) y de los minijuegos |
| `cd coordinator && npm run smoke` | Taller 5 con un coordinador (S1-S11, G1-G14) |
| `cd coordinator && npm run smoke:cluster` | Taller 6: mesh, directorio, caída y vuelta de un coordinador (C1-C13) |
| `cd coordinator && npm run smoke:viruscity` | Partidas completas con un coordinador y tiempos reducidos (V1-V12): cuenta, roles, información oculta, misiones, victorias, cancelación y gracia |
| `cd coordinator && npm run smoke:viruscity -- --coordinators=3` | Lo anterior más X1-X7 en el clúster: acuerdo del árbitro, contagio y cura entre coordinadores, relevo matando a coord-a, handover al volver, peer falso y sin roles expuestos |

Los smokes levantan sus propios procesos en puertos de prueba con secretos aleatorios, una base temporal y sin tocar los `.env`; al terminar los cierran y borran todo.

## 10. Guía de balance

| Si pasa esto… | Toca… |
|---|---|
| Los infectados ganan demasiado (casi siempre "sin sanos") | Subir `INFECT_COOLDOWN_MS` o `NEW_INFECTED_LOCK_MS`, bajar `INFECT_RANGE` |
| Los infectados ganan muy rápido al inicio | Subir `INITIAL_LOCK_MS` (más tiempo para hacer misiones antes del primer contagio) |
| Los infectados ganan por tiempo | Bajar `MISSION_MIN_MS` (misiones más cortas) o subir `MATCH_DURATION_MS` |
| Los sanos ganan demasiado fácil | Subir `MISSION_MIN_MS`, bajar `INITIAL_LOCK_MS` o `NEW_INFECTED_LOCK_MS` |
| Cuesta acertar las estaciones o los contagios en el borde | Subir `MISSION_RANGE`, `INFECT_RANGE` o `RANGE_TOLERANCE` (con jugadores en coordinadores distintos) |
| Las misiones expiran antes de terminarlas | Subir `MISSION_MAX_MS` |
| Las partidas tardan en arrancar | Bajar `MATCH_COUNTDOWN_MS` o `MIN_PLAYERS_TO_START` (mínimo 2) |
| Se pierden muchos jugadores por cortes de red | Subir `RECONNECT_GRACE_MS` |

El número de misiones (3 por cada jugador además del primero, máximo 12) es fijo; para más o menos trabajo por partida se ajusta el tiempo de cada una con `MISSION_MIN_MS`.

## 11. Guía de demostración (5 minutos)

Con la receta de partida rápida, los tres coordinadores y `cluster.html` abierto en otra ventana.

1. **Mundo abierto (30 s):** dos navegadores entran; el HUD dice "MUNDO ABIERTO" y "Jugadores: 2/3"; la pista "Mundo abierto: falta 1 jugador para empezar". En la lista de jugadores se ve el coordinador de cada uno y `cluster.html` muestra la carga de los tres.
2. **Entra el tercero (30 s):** banner "La partida empieza en 3 s" en las tres pantallas; al llegar a 0, la pantalla de rol: uno lee "ERES EL INFECTADO", los otros "ESTÁS SANO".
3. **Misiones (1 min):** un sano va a una estación dorada y pulsa E: se abre el minijuego y queda quieto; al resolverlo, "Verificando…" y la barra de cura sube **en las tres pantallas** (de coordinadores distintos).
4. **Infección (1 min):** el infectado pulsa F antes de tiempo ("Tu infección todavía no está lista"); tras el bloqueo se acerca a un sano y lo contagia: la víctima ve "Has sido infectado" y la viñeta verde; todos ven "Nuevo contagio detectado cerca de <zona>", sin nombres.
5. **Matar el árbitro (1 min):** `curl -s http://localhost:5002/status` muestra `"arbiterId":"coord-a"`. Ctrl+C en la terminal de coord-a: sus jugadores ven "Conexión perdida… Buscando otro coordinador", reconectan en menos de 1 s con su rol, `/status` de coord-b muestra `"arbiterId":"coord-b"` y la partida sigue (misiones y cura intactas).
6. **Fin (1 min):** completar las misiones (o contagiar a todos) → "¡LA CURA FUNCIONÓ!" o "LA CIUDAD HA CAÍDO" con la tabla de roles, y a los pocos segundos vuelta al mundo abierto. Levantar coord-a de nuevo: recibe el handover y vuelve a ser el árbitro sin reiniciar nada.

### Preguntas probables

1. **¿Por qué un solo árbitro?** Para que la partida tenga una sola historia: cada contagio y cada misión se deciden en un lugar, en orden, sin conflictos entre coordinadores. Los demás solo reenvían acciones y replican.
2. **¿Qué pasa si cae el árbitro?** El siguiente id menor asume con el último estado replicado (cada 250 ms y tras cada acción); los jugadores reconectan a otro coordinador y conservan su rol por la gracia. Como mucho se pierde una misión en curso.
3. **¿Cómo se evita que el cliente vea roles?** Nunca se los mandamos: cada cliente recibe su vista personalizada con solo su rol; los roles de todos viajan únicamente en `results` al terminar; `state`, `/status` y los extras no llevan datos de la partida.
4. **¿Por qué la alerta de contagio no lleva nombres?** Porque revelaría al infectado (y a la víctima). La zona da información para jugar (sospechar de quien estaba cerca) sin romper el secreto.
5. **¿Por qué el servidor valida el tiempo mínimo de la misión?** El minijuego corre en el cliente y se puede falsear; el servidor no confía en él: exige presencia en la estación, quedarse quieto, seguir sano y que pasen al menos `MISSION_MIN_MS`. Así nadie acelera la cura.
6. **¿Qué es el handover?** Cuando vuelve un coordinador de id menor (que pasa a ser el árbitro), el árbitro saliente le entrega el estado con `handover:true`; el que vuelve espera ese estado antes de avanzar, para no reiniciar la partida con su estado vacío.
7. **¿Por qué las misiones son compartidas?** Para que los sanos colaboren y la cura sea un objetivo común; además una misión se completa una sola vez y quién la hace no se publica (no delata a nadie).
8. **¿Por qué hay bloqueo inicial?** Para que el infectado no gane en los primeros segundos con todos juntos en la plaza: los sanos tienen un minuto para dispersarse y empezar misiones, y el infectado para disimular.

---

# Taller 7: auth-services replicados

El auth-service deja de ser un punto único de falla: **tres auth replicados** con *single-writer replication*. Un líder a la vez acepta escrituras; las réplicas leen y mantienen una copia local de la BD; si el líder cae, se elige otro. Coordinadores y cliente conocen los tres (`AUTH_URLS`) y hacen *failover*. Los jugadores conectados **no se desconectan** cuando caen auths: el coordinador valida el JWT localmente, sin consultar al auth. Las reglas fijas están en CLAUDE.md, sección "TALLER 7".

**Contenido:** 1. Arquitectura y flujos · 2. Roles y protocolo del mesh · 3. Elección · 4. Consistencia · 5. Directorio de coordinadores · 6. Cliente y coordinadores · 7. Variables · 8. Correr todo en local · 9. ngrok con el gateway · 10. Limitaciones · 11. Guía de sustentación

## 1. Arquitectura y flujos

```
                     navegador (login.html · play.html · cluster.html)
                        │ HTTP con failover (AUTH_URLS)          │ WebSocket del juego
                        ▼                                        ▼
   ┌────────────────────────────────────────────┐      ┌──────────────────────────────────────┐
   │ auth-a 4001 ◄──mesh WS 4101──► auth-b 4002 │      │ coord-a 5001 ◄─mesh─► coord-b 5002   │
   │  (réplica)        ▲      ▲      (LÍDER)    │◄─────│      ▲    5101-5103    ▲             │
   │                   │      └──────┐   │      │  heartbeat a TODOS los auth  │             │
   │                   └── mesh ──► auth-c 4003 │      │      └──── coord-c 5003┘             │
   │                                 (réplica)  │      │ (validan el JWT sin preguntar al auth)│
   └────────────────────────────────────────────┘      └──────────────────────────────────────┘
          cada auth: users + oplog + meta (users-a.db, users-b.db, users-c.db)

   Opcional para ngrok: gateway 8080 ─ /auth-a /auth-b /auth-c → 4001-4003 · /coord-a … → 5001-5003 · resto → client 3000
```

| Proceso | Puertos | Qué hace |
|---|---|---|
| `auth-service` × 3 (auth-a/b/c) | HTTP 4001-4003 · mesh 4101-4103 | Registro, login y Google; elección de líder, replicación del oplog, sync; directorio de coordinadores (estado blando en cada uno) |
| `coordinator` × 3 (coord-a/b/c) | 5001-5003 · mesh 5101-5103 | Igual que en el Taller 6, con `AUTH_URLS`: heartbeat a los tres auth y descubrimiento con el primero que responda |
| `client` | 3000 | Páginas; `js/auth/failover.js` decide a qué auth preguntar |
| `gateway` (opcional) | 8080 | Proxy HTTP y WebSocket por prefijo de ruta para exponer todo con **un solo** túnel de ngrok |

**Registro** (`POST /register` en una réplica):

```
navegador ──POST /register──► auth-a (réplica) ──503 { error:"not_leader", leaderUrl:"http://localhost:4002", leaderId:"auth-b" }
navegador ──POST /register──► auth-b (líder: leaderUrl está en AUTH_URLS → reintento inmediato)
   auth-b: bcrypt (fuera del mutex) → mutex → ¿username libre? → userId = MAX(id)+1 → entrada { seq, term, entryId }
   auth-b ──write_propagate──► auth-a, auth-c   (aplican AL RECIBIR y contestan write_ack ok:true)
   auth-b: con mayoría (él + 1 ack) aplica en su BD, espera ≤ 150 ms los acks que falten → 201 { userId, username }
```

**Login:** cualquier nodo con líder conocido y conectado responde con su BD local si no va atrasado (§4). **Elección:** §3. **Sync:** una réplica que vuelve o va atrás pide `request_sync` y el líder le manda lo que le falta por lotes (§4). **Directorio:** cada coordinador manda su heartbeat a los **tres** auth cada 2 s (§5).

Código: `auth-service/replication/` → `election.js` (núcleo puro de elección), `node.js` (nodo: escrituras por mayoría, sync, conflictos, lecturas), `mesh.js` (sockets) y `mesh-messages.js` (validación); `auth-service/oplog.js` (almacenamiento replicable); `client/public/js/auth/failover.js`; `gateway/`.

## 2. Roles y protocolo del mesh

Roles: **leader** (acepta escrituras) y **replica**. Internamente existe **candidate** (en elección); `/status` lo muestra como `replica` con `election:true`. Hay un solo líder por término.

**Una conexión por par:** la abre el `authId` **menor** (comparación de strings: auth-a → auth-b y auth-c; auth-b → auth-c). Si llega una entrante de un id **mayor** cuando ya hay una activa, se cierra la nueva (4010 `duplicate peer`); si llega de un id **menor**, reemplaza a la anterior. Los salientes se reintentan cada 2 s mientras no estén conectados.

**Seguridad del mesh** (como el de coordinadores): header `x-cluster-secret` en el upgrade (comparado con sha256 + `timingSafeEqual`; si no, 401 y se destruye el socket), `hello` en 3 s (si no, 4011), id fuera de `AUTH_NODES` o igual al propio → 4011, el remitente de cada mensaje es **siempre** el id de la conexión (un `authId`/`candidate`/`voter`/`leader` que lo contradiga hace descartar el mensaje), ping/pong cada `AUTH_PEER_PING_MS`, máximo 500 mensajes por segundo y conexión, `maxPayload` 2 MB y validación estricta de cada tipo.

Mensajes (JSON). Los campos marcados con **(+)** son adicionales al enunciado:

| Tipo | Campos | Ejemplo |
|---|---|---|
| `hello` | authId, role, term, leaderId (+), lastSeq (+), lastTerm (+) | `{"type":"hello","authId":"auth-a","role":"replica","term":2,"leaderId":"auth-b","lastSeq":14,"lastTerm":2}` |
| `heartbeat` | authId, term, lastSeq, lastTerm (+) | `{"type":"heartbeat","authId":"auth-b","term":2,"lastSeq":14,"lastTerm":2}` |
| `heartbeat_ack` (+) | authId, term, lastSeq | `{"type":"heartbeat_ack","authId":"auth-a","term":2,"lastSeq":14}` |
| `write_propagate` | term, seq, entryId (+), op, data | `{"type":"write_propagate","term":2,"seq":15,"entryId":"9b2…","op":"register","data":{"userId":15,"username":"alice","provider":"local","password_hash":"$2a$10$…","created_at":"2026-11-23 10:00:00"}}` |
| `write_ack` (+) | authId, term, seq, entryId, ok, reason? | `{"type":"write_ack","authId":"auth-a","term":2,"seq":15,"entryId":"9b2…","ok":true}` |
| `write_abort` (+) | term, seq, entryId | `{"type":"write_abort","term":2,"seq":15,"entryId":"9b2…"}` |
| `request_sync` | fromSeq, fromEntryId (+) | `{"type":"request_sync","fromSeq":12,"fromEntryId":"41c…"}` |
| `sync_response` | term (+), entries:[{seq, term (+), entryId (+), op, data}], conflict (+), done (+) | `{"type":"sync_response","term":2,"entries":[…],"conflict":false,"done":true}` |
| `election` | candidate, term, lastSeq, lastTerm (+) | `{"type":"election","candidate":"auth-c","term":3,"lastSeq":15,"lastTerm":2}` |
| `vote` | voter, term, voteGranted | `{"type":"vote","voter":"auth-a","term":3,"voteGranted":true}` |
| `new_leader` | leader, term | `{"type":"new_leader","leader":"auth-c","term":3}` |

El receptor de una conexión contesta el `hello` con el suyo. Los mensajes del mesh nunca se escriben en los logs.

## 3. Elección (estilo Raft simplificado)

- **Término:** un número que solo crece y se guarda en `meta` (`current_term`, `voted_for`) **antes** de contestar un voto o de anunciar una candidatura. Cualquier mensaje con un término mayor baja a líderes y candidatos a réplica.
- **Disparo:** una réplica sin contacto del líder durante `LEADER_TIMEOUT_MS` (6000) + un **jitter** aleatorio de 0 a `ELECTION_JITTER_MS` (1500) se vuelve candidata: término+1, vota por sí misma y envía `election`. El jitter evita que dos réplicas se postulen a la vez. Solo se postula si tiene mayoría conectada (él cuenta): un nodo aislado no infla su término.
- **Voto:** se concede si el término del candidato es ≥ al propio, no votó por otro en ese término y el **log del candidato está al día** (`lastTerm` mayor, o igual y `lastSeq` ≥ propio). Así nunca gana alguien al que le falten escrituras confirmadas.
- **Estabilidad:** quien escuchó a un líder en los últimos `LEADER_TIMEOUT_MS − 1000` ms (o es el líder) no concede votos ni adopta el término de un candidato: un nodo que vuelve no derriba a un líder sano. Un candidato que oye a un líder vigente abandona su candidatura y lo sigue.
- **Victoria:** con mayoría (`floor(N/2)+1`, 2 de 3) anuncia `new_leader` y manda un heartbeat de inmediato; luego un heartbeat cada `AUTH_HEARTBEAT_MS` (2000).
- **Elección de arranque:** en un arranque en frío, un nodo sin líder conocido, con mayoría conectada y sin que ningún peer reporte líder en su `hello`, se postula a los 500..1500 ms (no espera 6 s). Un nodo que vuelve se incorpora como réplica y sincroniza; **nunca** recupera el liderazgo por tener el id más bajo.
- **Lease:** las réplicas contestan cada heartbeat con `heartbeat_ack`. Un líder sin acks de una mayoría (él cuenta) durante `LEADER_TIMEOUT_MS` se baja a réplica sin líder.

| Falla | Qué pasa |
|---|---|
| Cae el líder | Las réplicas pierden la conexión y desde ese momento responden 503 `no_leader` (lecturas y escrituras). A los 6–7,5 s una se postula con término+1, la otra le vota y hay líder nuevo (5,7–7,3 s en los smokes). Los jugadores siguen jugando. |
| Cae una réplica | Nada visible: el líder y la otra réplica son mayoría (2 de 3). Al volver, la réplica sincroniza lo que se perdió. |
| Caen dos | El que queda no tiene mayoría: las escrituras dan 503 `no_quorum` de inmediato; si era el líder, al vencer el lease (≤ 6 s) se baja y todo da 503 `no_leader`. **No hay logins ni registros**, pero el juego sigue y el directorio de coordinadores responde. |
| Vuelve un nodo | Hace el `hello`, adopta al líder (por su `hello` o su heartbeat), pide `request_sync` y queda como réplica al día. |
| Partición (líder aislado) | El líder aislado da `no_quorum` y a los 6 s se baja; el lado con mayoría elige otro con término mayor. Al sanar, el viejo ve el término mayor y lo sigue; como nunca tuvo mayoría, nunca aplicó escrituras propias que haya que deshacer. |

## 4. Modelo de consistencia

**Opción B con mayoría.** El líder serializa las escrituras con un mutex y **no aplica nada hasta tener mayoría**:

1. Dentro del mutex valida contra su BD (username libre, sub de Google nuevo), calcula `userId = MAX(id)+1` y arma la entrada (`seq = lastSeq+1`, término actual, `entryId` uuid).
2. Si no tiene mayoría de nodos **conectados**, responde 503 `no_quorum` sin proponer nada.
3. Envía `write_propagate` a las réplicas conectadas, que la aplican al recibir y contestan `write_ack`.
4. Con acks de una mayoría (él cuenta) dentro de `WRITE_TIMEOUT_MS` (3000) aplica en su BD y responde, esperando además hasta `ACK_GRACE_MS` (150) a las réplicas que falten (así `/status` coincide en los tres).
5. Si vence el tiempo: `write_abort` y 503 `replication_timeout`; quien la había aplicado la deshace (solo si es su última entrada y coincide el `entryId`).

**Por qué B y no A.** En la opción A el líder aplica y responde de inmediato y replica después: es más rápido, pero si el líder cae justo después de confirmar, la escritura se pierde (el usuario recibió 201 y su cuenta no existe en el nuevo líder). Con B, toda escritura confirmada está en una mayoría, y la restricción de voto (§3) garantiza que el próximo líder la tiene. **Costo:** un viaje de ida y vuelta más por escritura y ninguna escritura sin mayoría (el sistema es CP).

**Resultado ambiguo:** si el líder cae después de proponer y antes de responder, el cliente ve un error, pero la escritura pudo quedar en una mayoría y sobrevivir al relevo. Un reintento del registro da 409 (el cliente lo explica, §6).

**Conflictos** (una réplica con entradas que el líder no tiene):

- Misma posición y mismo `entryId` → ack idempotente.
- Otra entrada en la **última** posición (por ejemplo, un `write_abort` perdido) → se deshace y se aplica la nueva.
- Diferencias más atrás, o una violación de unicidad al aplicar → **resincronización completa**: se borran `users` y `oplog` y se pide todo desde 0.
- Hueco (`seq` > `lastSeq`+1) → `request_sync`.
- Solo se acepta replicación del líder del término actual o mayor; un líder viejo recibe `ok:false, reason:"stale_term"`.

**Sync:** la réplica pide `request_sync { fromSeq, fromEntryId }` al conectar con el líder, cuando un heartbeat (o el `hello`) muestra que va atrás o que su log difiere, o ante un hueco. Hay un solo pedido en vuelo, que se reintenta si no hay respuesta en 6 s. El líder contesta por lotes de `SYNC_BATCH` (500). Si la entrada de la réplica en `fromSeq` no coincide con la suya, o la réplica tiene más entradas que él, contesta `conflict:true` con todo desde 1 y la réplica borra antes de aplicar.

**Lecturas** (`/login` y `/auth/google` de un usuario existente):

- Una réplica responde con su BD solo si conoce al líder, sigue conectada con él y va atrasada menos de `READ_TOLERANCE` (10) entradas.
- Con más atraso → 503 `not_leader` con `leaderUrl`.
- Si la lectura fallaría (usuario inexistente o contraseña incorrecta) y la réplica va atrasada aunque sea una entrada → 503 `not_leader`, **nunca 401**: el usuario puede existir en el líder.
- Sin líder (en elección o desconectada de él) → 503 `no_leader`. Nunca se emite un token desde una BD atrasada.

**Durante una elección las escrituras fallan** (`no_leader`): no hay quién las ordene, así que el cliente reintenta según el failover (§6), con hasta 12 s de presupuesto, más que una elección normal.

Todas las respuestas llevan `X-Auth-Id` y `X-Auth-Role` (`leader`/`replica`), expuestas por CORS. `GET /status` describe el nodo (`authId, role, publicUrl, peerUrl, leaderUrl, knownPeers, lastAppliedSeq, users, term, leaderId, election, lastTerm, checksum`); `GET /peers` lista los otros dos nodos con su rol y si están conectados. `checksum` es el sha256 de las líneas `id:username` ordenadas: dos nodos sincronizados lo muestran igual.

**Almacenamiento:** cada nodo tiene `users` (esquema exacto del Taller 5), `oplog(seq, term, entry_id, op, data)` y `meta(key, value)`. Una BD heredada (con usuarios y sin oplog) genera al arrancar entradas deterministas `legacy-<id>`, así que la migración del Taller 4/5 sigue funcionando. **Ojo:** si un nodo arranca con usuarios heredados y los otros dos con la BD vacía, los dos vacíos pueden elegirse entre sí (sus logs empatan) y el nodo con datos se resincroniza borrándolos. Hay que arrancar primero el nodo con datos y un solo nodo vacío, o copiar la BD a los tres.

## 5. Directorio de coordinadores: estado blando en cada auth

El directorio del Taller 6 (`/heartbeat`, `/coordinator`, `/directory`) **no pasa por la replicación**: cada coordinador manda su heartbeat a los **tres** auth de `AUTH_URLS` (en paralelo, cada uno con su timeout), así que cualquier nodo responde `/coordinator`, `/coordinator-peers` y `/directory` aunque esté en una elección o sin líder. Si un auth reinicia, el directorio se reconstruye con el siguiente heartbeat (≤ 2 s). `/status` del coordinador muestra `authReachable` (al menos uno responde) y `authNodesUp` (`{ up, total }`); el log solo avisa cuando cambia cuántos responden.

**`/peers` → `/coordinator-peers`.** En el Taller 6, `GET /peers` del auth listaba coordinadores. En el Taller 7, `GET /peers` lista los **nodos de auth** (decisión 14), así que la lista de coordinadores pasó a `GET /coordinator-peers`, con la misma forma `{ peers:[{ coordinatorId, peerUrl }] }`. El coordinador la pide al primer auth que responda.

## 6. Cliente y coordinadores: AUTH_URLS y failover

`AUTH_URLS` (lista separada por comas) reemplaza a `AUTH_URL` en el coordinator y en el client; si solo existe `AUTH_URL`, es una lista de una. Las URLs se normalizan (sin barra final) y una repetida es un error de configuración.

**Failover** (`client/public/js/auth/failover.js`, el mismo que usa el smoke completo):

1. Se empieza por el último nodo que respondió.
2. Error de red, timeout (4 s) o un 5xx distinto de los 503 de abajo → siguiente nodo.
3. 503 `not_leader` con un `leaderUrl` **exactamente igual** (normalizado) a una entrada de `AUTH_URLS` → reintento inmediato contra esa URL, una sola vez.
4. 503 `no_leader` / `no_quorum` / `replication_timeout`, o `not_leader` sin URL permitida → siguiente nodo; tras una pasada completa sin éxito, 1 s de espera y otra pasada, hasta un presupuesto de 12 s. Al agotarse, `AuthUnavailableError` → "No hay servidores de autenticación disponibles. Inténtalo de nuevo en unos segundos."
5. Cualquier otra respuesta (2xx, 4xx) se devuelve tal cual. Las peticiones son secuenciales: un POST nunca se manda a dos nodos a la vez.

**Por qué solo se sigue un `leaderUrl` permitido:** la respuesta la escribe un servidor; si el cliente siguiera cualquier URL, un nodo comprometido (o un proxy en el medio) podría redirigir el `POST /login` con la contraseña a un servidor ajeno. Solo se sigue una URL que el propio cliente ya tiene en su configuración.

**`/register` reintentado:** si hubo reintentos y la respuesta final es 409, el primer intento pudo haber registrado al usuario (resultado ambiguo, §4); el mensaje dice "El usuario ya existe. Si acabas de registrarte, inicia sesión."

**Integración:** `js/auth-fetch.js` (script clásico) define `window.authFetch(path, init)`. Importa `failover.js` la primera vez, agrega `ngrok-skip-browser-warning`, devuelve la `Response` con `authInfo = { authId, authRole, retried, nodeUrl }` y emite el evento `viruscity:auth-node`. Lo usan `login.js` (`/login`, `/register`), `google-login.js` (`/auth/google`), `play/play.js` (`/coordinator`) y `cluster.js` (`/directory`).

**Indicador:** `login.html` (pie del card) y `play.html` (barra superior, junto al coordinador) muestran "Auth: auth-b (líder)" o "Auth: auth-a (réplica)", según `X-Auth-Id` y `X-Auth-Role` de la última respuesta (`js/auth-node.js`); antes de la primera, "Auth: —".

## 7. Variables de entorno

**auth-service** (`.env` para un nodo único con `npm start`; `.env.auth-a/b/c` para el clúster con `npm run start:a/b/c`; los `.example` traen todas las claves):

| Variable | Qué es | Ejemplo (auth-a) / defecto |
|---|---|---|
| `AUTH_ID` | Id del nodo (`^[A-Za-z0-9_-]{1,32}$`) | `auth-a` (sin `AUTH_NODES`: `auth-solo`) |
| `PORT` · `PEER_PORT` | HTTP público · mesh WebSocket (obligatorio con más de un nodo) | `4001` · `4101` |
| `PUBLIC_URL` | URL que usan clientes y coordinadores; debe ser **igual** a su entrada en `AUTH_NODES` y en las `AUTH_URLS` del client | `http://localhost:4001` |
| `PEER_URL` | URL del mesh para los otros auth | `ws://localhost:4101` |
| `AUTH_NODES` | Todos los nodos, incluido él: `id\|publicUrl\|peerUrl` separados por comas (2 a 9) | `auth-a\|http://localhost:4001\|ws://localhost:4101,auth-b\|…,auth-c\|…` |
| `DB_PATH` | Una BD por nodo | `./users-a.db` |
| `JWT_SECRET` · `CLUSTER_SECRET` · `GOOGLE_CLIENT_ID` | **Iguales** en los tres auth y en los coordinadores (los dos secretos) | — |
| `JWT_EXPIRES_IN` · `BCRYPT_ROUNDS` · `COORDINATOR_TTL_MS` · `RESERVATION_TTL_MS` | Como en los Talleres 5 y 6 | `1h` · `10` · `6000` · `3000` |
| `AUTH_HEARTBEAT_MS` | Heartbeat del líder | `2000` |
| `LEADER_TIMEOUT_MS` | Sin contacto del líder → elección; también el lease (≥ 3 heartbeats) | `6000` |
| `ELECTION_JITTER_MS` | Jitter aleatorio de la elección | `1500` |
| `READ_TOLERANCE` | Atraso máximo (entradas) para leer en una réplica | `10` |
| `WRITE_TIMEOUT_MS` · `ACK_GRACE_MS` | Espera de la mayoría · espera extra al resto | `3000` · `150` |
| `SYNC_BATCH` · `AUTH_PEER_PING_MS` | Entradas por lote de sync · ping del mesh | `500` · `3000` |

**coordinator** (`.env.coord-a/b/c`): todo lo del Taller 6 (Parte III §7) más `AUTH_URLS=http://localhost:4001,http://localhost:4002,http://localhost:4003` en lugar de `AUTH_URL`.

**client** (`.env`): `PORT=3000`, `AUTH_URLS=http://localhost:4001,http://localhost:4002,http://localhost:4003`, `GOOGLE_CLIENT_ID` y `COORDINATOR_WS_URL` (opcional, vacío). `/config.js` entrega `AUTH_URLS` (lista) y `AUTH_URL` (la primera, por compatibilidad).

**gateway** (`gateway/.env`, opcional; sin él se usan los mismos valores): `PORT=8080`, `GATEWAY_ROUTES=/auth-a=http://localhost:4001,…,/coord-c=http://localhost:5003` y `GATEWAY_DEFAULT=http://localhost:3000`.

Solo existen en tu equipo (ignorados por git): `auth-service/.env.auth-a`/`-b`/`-c`, `users-a.db`/`-b`/`-c`, `coordinator/.env.coord-*`, `client/.env` y `gateway/.env`.

## 8. Cómo correr todo en local

Requisitos: Node.js ≥ 22.13 (con `node:sqlite` sin flags; en 22.5–22.12 los smokes agregan `--experimental-sqlite`) y Git Bash. Desde la raíz del repositorio:

1. **Dependencias:** `(cd auth-service && npm install) && (cd coordinator && npm install) && (cd client && npm install) && (cd gateway && npm install)`
2. **Archivos de entorno:** copiar cada `.example` sin el sufijo: `auth-service/.env.auth-a/b/c`, `coordinator/.env.coord-a/b/c`, `client/.env` (y `gateway/.env` si se usa). Poner el **mismo** `JWT_SECRET`, `CLUSTER_SECRET` y `GOOGLE_CLIENT_ID` en los tres auth y los dos secretos en los tres coordinadores (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` genera uno).
3. **Siete terminales** (los auth primero):
   ```bash
   cd auth-service && npm run start:a     # 1 · Auth service auth-a en puerto 4001 · clúster de 3 (mayoría 2), mesh en 4101
   cd auth-service && npm run start:b     # 2
   cd auth-service && npm run start:c     # 3 · en ~2 s uno dice "[auth] auth-x es el líder (término 1)"
   cd coordinator && npm run start:a      # 4 · "Auth: 3 de 3 nodos responden · coord-a registrado en su directorio"
   cd coordinator && npm run start:b      # 5
   cd coordinator && npm run start:c      # 6
   cd client && npm start                 # 7 · http://localhost:3000
   ```
4. **Comprobar:**
   ```bash
   for p in 4001 4002 4003; do curl -s http://localhost:$p/status; echo; done   # un leader, dos replica, mismos users y checksum
   curl -s http://localhost:4001/peers
   curl -s http://localhost:4002/coordinator-peers
   ```

**Pruebas:**

| Comando | Qué prueba |
|---|---|
| `cd auth-service && npm test` | 111 pruebas: configuración multi-nodo, oplog, interfaz de replicación, rutas, núcleo de elección (E1-E12 con un simulador de reloj falso, incluida la propiedad "nunca dos líderes en el mismo término" en 200 semillas), nodo de replicación (R1-R14) y validación del mesh |
| `cd coordinator && npm test` | 49 pruebas: las del Taller 6 más `AUTH_URLS` y el failover del cliente de directorio |
| `cd client && npm test` | 83 pruebas: las anteriores más el failover del cliente y el indicador |
| `cd gateway && npm test` | 9 pruebas: enrutamiento y proxy HTTP/WebSocket con servidores falsos |
| `cd coordinator && AUTH_URL=http://localhost:<puerto del líder> npm run smoke` | Taller 5 contra coord-a con el clúster de §8 levantado (`AUTH_URL` debe ser el **líder**: en una réplica los registros del smoke reciben 503) |
| `cd coordinator && npm run smoke:cluster` | Taller 6 (C1-C13), con un auth de prueba |
| `cd auth-service && npm run smoke:auth-cluster` | A1-A13: 3 auth reales en 4801-4803, relevo, sync, mayoría, reinicio, seguridad, headers y logs |
| `cd coordinator && npm run smoke:full` | F1-F8: 3 auth + 3 coordinadores + un jugador moviéndose mientras caen el líder de auth, un coordinador y la mayoría |

Los smokes levantan sus propios procesos en puertos de prueba, con secretos aleatorios y BD temporales, y al terminar los cierran y borran todo.

## 9. ngrok con el gateway (un solo túnel)

El sistema necesita 7 URLs públicas (client, 3 auth, 3 coordinadores) y el plan gratuito de ngrok permite pocos endpoints simultáneos (verifícalo en tu cuenta: los límites de endpoints y de peticiones cambian). El **gateway** expone todo por un solo puerto:

```bash
cd gateway && npm start     # Gateway en puerto 8080 · /auth-a → http://localhost:4001 … · (resto) → http://localhost:3000
ngrok http 8080             # sintaxis comprobada con ngrok 3.39 (`ngrok http --help`: ngrok http [address:port | port])
```

Con el dominio que da ngrok (`https://<dominio>`):

| Dónde | Variable | Valor |
|---|---|---|
| `client/.env` | `AUTH_URLS` | `https://<dominio>/auth-a,https://<dominio>/auth-b,https://<dominio>/auth-c` |
| `auth-service/.env.auth-a` (y b, c) | `PUBLIC_URL` | `https://<dominio>/auth-a` (`/auth-b`, `/auth-c`): **igual** a su entrada en `AUTH_URLS` del client |
| los tres `.env.auth-*` | `AUTH_NODES` | `auth-a\|https://<dominio>/auth-a\|ws://localhost:4101,auth-b\|https://<dominio>/auth-b\|ws://localhost:4102,auth-c\|https://<dominio>/auth-c\|ws://localhost:4103` |
| los tres `.env.auth-*` | `PEER_URL` | **sin cambios**: `ws://localhost:4101` (4102, 4103) |
| `coordinator/.env.coord-a` (y b, c) | `PUBLIC_URL` | `wss://<dominio>/coord-a` (`/coord-b`, `/coord-c`) |
| los tres `.env.coord-*` | `AUTH_URLS` y `PEER_URL` | **sin cambios** (localhost): los heartbeats y el mesh no salen de la máquina |

Por qué así: el `leaderUrl` que devuelve una réplica es el `PUBLIC_URL` del líder, y el cliente solo lo sigue si está en sus `AUTH_URLS` (§6). El gateway quita el prefijo (`/auth-b/login` → `http://localhost:4002/login`; `wss://<dominio>/coord-a/connect?token=…` → `ws://localhost:5001/connect?token=…`) y no registra queries ni headers (el token del WebSocket viaja en la query).

**Google:** el origen autorizado es `https://<dominio>` (el client está en la raíz). Se registra **una vez** en la consola de Google, porque el dominio de desarrollo del plan gratuito no cambia entre sesiones. Si tu cuenta te da otro dominio, hay que registrarlo de nuevo (Parte II §10).

## 10. Limitaciones conocidas

- **Membresía estática:** `AUTH_NODES` es fijo; agregar o quitar un nodo requiere reiniciar todos con la lista nueva.
- **Sin snapshots ni compactación del oplog:** el oplog crece con cada usuario y una réplica nueva lo recibe completo (por lotes).
- **Sin pre-vote:** un nodo que estuvo aislado y vuelve con un término alto no consigue votos mientras el líder vive (estabilidad), pero en algunos casos puede provocar una elección extra.
- **CP:** sin mayoría no hay logins ni registros (503); el juego y el directorio siguen.
- **Directorio no replicado:** es estado blando en cada auth; se reconstruye con los heartbeats (≤ 2 s) tras un reinicio.
- **Resultado ambiguo** de una escritura cuando el líder cae entre proponer y responder (un reintento da 409).
- **Lecturas no disponibles durante una elección** ni en una réplica desconectada de su líder (503 `no_leader`).
- **BD heredadas:** ver la nota del final de §4 sobre el orden de arranque.

## 11. Guía de sustentación (Taller 7)

Durante **todo** el recorrido hay un cliente jugando en pantalla (`http://localhost:3000`, moviéndose con WASD): el coordinador valida el JWT con `JWT_SECRET` sin preguntarle al auth, así que caídas y elecciones del auth no lo afectan. El chip "Auth: …" muestra qué nodo respondió.

1. **Arranque (3 min):** las 7 terminales de §8 y `for p in 4001 4002 4003; do curl -s http://localhost:$p/status; echo; done`: un `leader`, dos `replica`, el mismo `term`, `users` y `checksum`.
2. **Registro (3 min):** primero contra una réplica, para ver el 503:
   ```bash
   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4002/register -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
   # (si 4002 es réplica) {"error":"not_leader","leaderUrl":"http://localhost:4001","leaderId":"auth-a"}  HTTP 503
   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4001/register -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
   # {"userId":"1","username":"alice"}  HTTP 201
   ```
   y otra vez los tres `/status`: `users+1`, mismo `lastAppliedSeq` y `checksum`. (También desde la página: el chip pasa a "Auth: auth-a (líder)").
3. **Caída del líder (2 min):** Ctrl+C en la terminal del líder; el jugador sigue moviéndose; a los ~10 s, `/status` de las otras dos muestra un `leader` nuevo con `term+1` (los logs dicen "[auth] auth-x es el líder (término 2)").
4. **Registro con el nuevo líder (4 min):** registrar `bob` desde la página (el failover salta el nodo caído y llega al líder) o con curl al nuevo líder; mostrar `users+1` en los dos vivos.
5. **Vuelve el muerto (3 min):** `npm run start:x` en su terminal: log "[auth] auth-x sigue al líder …", y su `/status` dice `replica`, con `users`, `lastAppliedSeq` y `checksum` iguales a los demás (sync); no recupera el liderazgo aunque tenga el id más bajo.

### Preguntas probables

1. **¿Por qué mayoría?** Porque dos mayorías siempre se cruzan: toda escritura confirmada está en al menos un nodo de cualquier mayoría futura, y la regla de voto hace que el nuevo líder la tenga.
2. **¿Qué pasa con dos auths caídos?** El que queda no puede formar mayoría: no hay logins ni registros (503) hasta que vuelva uno. El juego sigue (el JWT se valida sin auth) y el directorio responde.
3. **¿Por qué el líder no aplica antes de tener mayoría?** Para no confirmar una escritura que puede perderse: si cae antes de replicarla, el usuario tendría un 201 de una cuenta que no existe.
4. **¿Qué es un término?** Un número de "época" que crece con cada elección; hay como mucho un líder por término y todo mensaje con un término viejo se rechaza.
5. **¿Por qué la restricción de log al día?** Para que nunca gane un nodo al que le falten escrituras confirmadas (que están en una mayoría, y esa mayoría no le vota).
6. **¿Por qué la estabilidad del voto?** Para que un nodo que vuelve (o que quedó aislado) no derribe a un líder sano: quien oyó al líder hace menos de 5 s no vota por otro.
7. **¿Qué es el lease?** El líder solo sigue siéndolo mientras una mayoría le contesta los heartbeats; si queda aislado se baja solo en 6 s, y así no hay dos líderes atendiendo a la vez.
8. **¿Por qué el directorio va a todos los auth?** Porque es estado blando que no necesita consenso: así cualquier auth asigna coordinadores aunque esté en una elección o sin líder, y un auth reiniciado lo recupera en 2 s.
9. **¿Por qué se ignora un `leaderUrl` no permitido?** Para que nadie pueda redirigir el login (con la contraseña) a un servidor ajeno: el cliente solo sigue URLs que ya están en su `AUTH_URLS`.
10. **¿Qué pasa con un `/register` cuya respuesta se pierde?** El usuario puede haber quedado registrado (en una mayoría). El cliente reintenta; si recibe 409 tras reintentos, le dice que inicie sesión.

---

# Parte III · Taller 6

> **Desde el Taller 7:** la lista de coordinadores del auth es `GET /coordinator-peers` (lo que aquí se describe como `GET /peers`, que ahora lista los nodos de auth) y los coordinadores usan `AUTH_URLS` con los tres auth. Ver [Taller 7 §5 y §6](#taller-7-auth-services-replicados).

Varios coordinadores corren en paralelo, son intercambiables y tienen **el mismo estado del juego**. El auth-service además es **directory service**: sabe qué coordinadores están vivos y a cuál conectar a cada cliente. Los coordinadores forman un **mesh** por WebSocket: cada uno se conecta con todos los demás.

> No hay que confundir dos heartbeats distintos:
> - **`HEARTBEAT_INTERVAL_MS`** (30 s) es el ping WebSocket del coordinador a **sus clientes** (Taller 4).
> - **`HEARTBEAT_AUTH_MS`** (2 s) es el `POST /heartbeat` HTTP del coordinador **al auth**.

## 1. Arquitectura

```
 ┌───────────────────────────────────── NAVEGADORES (4 pestañas) ─────────────────────────────────────┐
 │  cluster.html (depuración)          login.html → play.html                                         │
 └───────┬──────────────────────────────────┬────────────────────────────┬────────────────────────────┘
         │ GET /directory                   │ (1) POST /login            │ (3) WS {publicUrl}/connect?token=<JWT>
         │ cada 1 s                         │     o /auth/google         │     ◄── welcome, state (20 Hz),
         │                                  │ (2) GET /coordinator       │         players_update
         ▼                                  ▼                            ▼
 ┌─────────────────────────────────────────────────┐   ┌────────────────┬────────────────┬────────────────┐
 │ auth-service  :4000                             │   │ coord-a        │ coord-b        │ coord-c        │
 │ usuarios (SQLite) + JWT                         │   │ :5001 clientes │ :5002 clientes │ :5003 clientes │
 │ DIRECTORIO en memoria                           │   │ :5101 mesh     │ :5102 mesh     │ :5103 mesh     │
 │ /heartbeat (secreto) · /coordinator · /peers    │   └───────┬────────┴───────┬────────┴───────┬────────┘
 │ /directory                                      │           │                │                │
 └─────────────────────────────────────────────────┘        coord-a ════════ coord-b ════════ coord-c
          ▲                                                    ╚═════════════════════════════════╝
          │ (5) POST /heartbeat cada 2 s (x-cluster-secret)     (7) mesh WebSocket: una conexión por par
          │ (6) GET /peers cada 3 s                                 (inicia el id menor)
          └──────────────────── desde cada coordinador
```

**Flujo numerado**

1. **Login.** El cliente entra con usuario/contraseña (`POST /login`) o con Google (`POST /auth/google`) y recibe el JWT, igual que en el Taller 5.
2. **Asignación.** `play.html` pide `GET {AUTH_URL}/coordinator` y recibe `{ coordinatorId, publicUrl }` del coordinador vivo con menos carga.
3. **WebSocket.** El cliente se conecta a `{publicUrl}/connect?token=<JWT>`. Ese coordinador verifica el JWT (mismo `JWT_SECRET`) y responde `welcome`, que incluye su `coordinatorId`.
4. **Estado.** Cada coordinador corre su game loop a 20 Hz con **todos** los jugadores del mundo y envía `state` y `players_update` **solo a sus clientes locales**. Cada jugador de la lista lleva su `coordinatorId` (el dueño).
5. **Heartbeat.** Cada 2 s (`HEARTBEAT_AUTH_MS`) cada coordinador hace `POST /heartbeat` al auth con sus jugadores locales y su uptime. Si deja de latir 6 s (`COORDINATOR_TTL_MS`), el directorio lo descarta.
6. **Descubrimiento.** Al arrancar y cada 3 s (`PEER_DISCOVERY_MS`) cada coordinador pide `GET /peers` y abre conexión con los peers de id **mayor** que el suyo que todavía no tenga conectados.
7. **Mesh.** Por esas conexiones cada coordinador envía **directamente** a cada peer lo que pasa con **sus** jugadores: entra, sale, intención, extras y, cada 1 s, sus posiciones.

| Proceso | Puerto(s) | Archivo de configuración |
|---|---|---|
| auth-service | 4000 | `auth-service/.env` |
| coord-a | 5001 (clientes) · 5101 (mesh) | `coordinator/.env.coord-a` |
| coord-b | 5002 · 5102 | `coordinator/.env.coord-b` |
| coord-c | 5003 · 5103 | `coordinator/.env.coord-c` |
| client | 3000 | `client/.env` |

`npm start` en el coordinator usa `coordinator/.env` (que es igual a coord-a); para el clúster se usan `npm run start:a`, `start:b` y `start:c`.

Código nuevo del Taller 6:

| Archivo | Qué hace |
|---|---|
| `auth-service/directory.js` | Directorio puro: validación del heartbeat, TTL, reservas, selección |
| `auth-service/app.js` | Rutas `/heartbeat`, `/coordinator`, `/peers`, `/directory` |
| `coordinator/config.js` | Configuración por instancia (`--env <archivo>`) |
| `coordinator/directory-client.js` | Heartbeat al auth y `GET /peers` (nunca lanza errores; desde el Taller 7, a todos los auth y `GET /coordinator-peers`) |
| `coordinator/mesh.js` | Lógica pura del mesh: quién inicia, duplicados, validación, propiedad, conflictos, resync |
| `coordinator/peers.js` | Red del mesh: servidor de peers, conexiones salientes, hello, ping/pong, positions_sync |
| `coordinator/scripts/cluster-smoke.js` | Smoke multi-proceso C1–C13 (`npm run smoke:cluster`) |
| `client/public/js/play/directory.js` | Lógica pura del cliente: respuesta del directorio, URL, contenido mixto, espera, cierres |
| `client/public/cluster.html` · `js/cluster.js` · `css/cluster.css` | Vista del directorio |

---

## 2. Directory service (auth-service)

El directorio vive **en memoria** del auth: un `Map` por `coordinatorId` en orden de registro, con la última información y `lastSeen`.

| Método y ruta | Protección | Respuestas |
|---|---|---|
| `POST /heartbeat` | header `x-cluster-secret` | `200 { ok: true }` · `401 { error: "invalid_cluster_secret" }` · `400 { error: "<motivo>" }` · `503 { error: "directory_full" }` (más de 50) |
| `GET /coordinator` | pública | `200 { coordinatorId, publicUrl }` · `503 { error: "no_coordinators_available" }` |
| `GET /peers` | pública | `200 { peers: [{ coordinatorId, peerUrl }] }` (vivos, en orden de registro) |
| `GET /directory` | pública (depuración) | `200 { coordinators: [{ coordinatorId, publicUrl, peerUrl, connectedPlayers, uptime, ageMs }], ttlMs }` |

Las tres rutas GET responden con `Cache-Control: no-store`.

**Validación del heartbeat** (cualquier falla → 400 con el motivo en español):
- `coordinatorId` cumple `^[A-Za-z0-9_-]{1,32}# Viruscity · Sistemas Distribuidos · Proyecto final (Partes I, II y III)

Universidad de Boyacá. Tres procesos independientes que se comunican por red:

- **auth-service** (puerto 4000): registro e inicio de sesión con usuario/contraseña **y con Google**. Una sola tabla `users` en SQLite (`node:sqlite`) y JWT HS256.
- **auth-service** además es **directory service** (Taller 6): los coordinadores le avisan que están vivos y el cliente le pregunta a cuál conectarse.
- **coordinator** (tres instancias: coord-a 5001, coord-b 5002 y coord-c 5003, más los puertos del mesh 5101–5103): **servidores autoritativos** del juego en vivo. Reciben a los jugadores por WebSocket, aplican sus *intenciones* en un game loop a 20 Hz (con choques contra el mapa de Virus City) y se replican entre sí por un mesh WebSocket para que todos tengan el mismo mundo.
- **client** (puerto 3000): páginas HTML + JS plano servidas con Express. `login.html` (con botón de Google) y `play.html` (el juego sobre el mapa de la ciudad, con selector de personaje).

**Parte I (Taller 4)** fue la identidad: login con JWT y lobby en vivo. **Parte II (Taller 5)** agrega el juego en vivo con el servidor como autoridad y el login con Google. **Parte III (Taller 6)** reparte el juego entre varios coordinadores intercambiables con el mismo estado. Este README empieza por el Taller 6 (el estado actual); el Taller 5 sigue siendo válido para el juego, la base de datos y Google, y al final hay un resumen del Taller 4.

**Contenido**
- [Parte III · Taller 6](#parte-iii--taller-6): 1. Arquitectura · 2. Directorio · 3. Mesh · 4. Los cuatro problemas · 5. Seguridad · 6. Cliente · 7. Variables · 8. Correr el clúster · 9. ngrok · 10. Limitaciones · 11. Decisiones · 12. Sustentación
- [Parte II · Taller 5](#parte-ii--taller-5): 1. Arquitectura · 2. Base de datos · 3. Google · 4. API del auth · 5. Coordinador · 6. Extra: personaje · 7. Cliente · 8. Variables · 9. Correr todo · 10. Google Cloud · 11. ngrok · 12. Decisiones · 13. Errores típicos · 14. Sustentación
- [Estructura del repositorio](#estructura-del-repositorio)
- [Interfaz de Viruscity](#interfaz-de-viruscity)
- [Parte I · Taller 4 (resumen)](#parte-i--taller-4-resumen)
- [Créditos](#créditos)

---
;
- `publicUrl` y `peerUrl` son URLs `ws:` o `wss:` de hasta 200 caracteres;
- `connectedPlayers` es entero ≥ 0 y `uptime` es número ≥ 0.

**Ejemplos con curl** (Git Bash, desde la raíz del repo, con el auth en 4000). El secreto se lee del `.env` sin mostrarlo:

```bash
SECRET=$(grep '^CLUSTER_SECRET=' auth-service/.env | cut -d= -f2-)

# Heartbeat a mano (lo hace cada coordinador cada 2 s)
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/heartbeat \
  -H "Content-Type: application/json" -H "x-cluster-secret: $SECRET" \
  -d '{"coordinatorId":"coord-x","publicUrl":"ws://localhost:5009","peerUrl":"ws://localhost:5109","connectedPlayers":0,"uptime":12}'
# {"ok":true}  HTTP 200

# Sin secreto
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/heartbeat -H "Content-Type: application/json" -d '{}'
# {"error":"invalid_cluster_secret"}  HTTP 401

curl -s http://localhost:4000/coordinator
# {"coordinatorId":"coord-a","publicUrl":"ws://localhost:5001"}

curl -s http://localhost:4000/peers
# {"peers":[{"coordinatorId":"coord-a","peerUrl":"ws://localhost:5101"},{"coordinatorId":"coord-b","peerUrl":"ws://localhost:5102"},…]}

curl -s http://localhost:4000/directory
# {"coordinators":[{"coordinatorId":"coord-a","publicUrl":"ws://localhost:5001","peerUrl":"ws://localhost:5101","connectedPlayers":1,"uptime":84,"ageMs":712},…],"ttlMs":6000}
```

El `coord-x` de prueba desaparece solo a los 6 s, porque nadie sigue latiendo por él. Mientras tanto, `/coordinator` podría asignárselo a un cliente y los coordinadores intentarían conectarse a su `peerUrl`. No lo hagas con clientes entrando.

**TTL de 6 s.**
- Un coordinador está vivo si `Date.now() - lastSeen <= COORDINATOR_TTL_MS` (6000).
- Los muertos no aparecen en `/coordinator`, `/peers` ni `/directory`, y un barrido cada 2 s los borra de memoria.
- Con heartbeat cada 2 s, el TTL tolera perder dos latidos seguidos antes de declarar muerto a un coordinador.

**Selección y reservas.**
- `GET /coordinator` elige el vivo con menor **carga efectiva** = `connectedPlayers` + reservas activas. Si hay empate, gana el primero en orden de registro.
- Cada respuesta 200 crea una **reserva** de 3 s (`RESERVATION_TTL_MS`; 0 las desactiva) para el coordinador elegido.
- **Por qué hacen falta las reservas:** `connectedPlayers` llega con el heartbeat, que puede tener hasta 2 s de atraso. Si 4 clientes piden coordinador a la vez, sin reservas el directorio vería los tres en 0 y mandaría a los 4 al mismo. Con reservas, el primero se cuenta como 1 en coord-a y el siguiente va a coord-b, y así sucesivamente. A los 3 s la reserva vence y ya la reemplaza el `connectedPlayers` real.

---

## 3. Protocolo del mesh

**Conexión y handshake**
1. El que inicia (el de id **menor**) abre `WebSocket(peerUrl)` con el header `x-cluster-secret`. Sin secreto válido, el servidor de peers responde `401` y destruye el socket.
2. El iniciador envía `hello`. El receptor tiene **3 s** para recibirlo; si no llega, cierra con `4011 "hello timeout"`. El `coordinatorId` del hello debe cumplir el patrón y ser distinto del propio.
3. El receptor contesta con su propio `hello`. El iniciador verifica que el id sea el que esperaba según `/peers`; si no, cierra con `4011 "unexpected hello"`.
4. Con el handshake completo, **los dos** hacen el *resync*: se mandan sus jugadores locales.

**Mensajes** (JSON; `userId` siempre string):

```json
{ "type": "hello", "coordinatorId": "coord-a" }
{ "type": "player_joined", "origin": "coord-a", "userId": "7", "username": "alice", "provider": "local", "x": 1920, "y": 1450, "connectedAtMs": 1762790400123 }
{ "type": "player_left", "origin": "coord-a", "userId": "7" }
{ "type": "intent_replicate", "origin": "coord-a", "userId": "7", "intent": { "dir": { "x": 1, "y": 0 } } }
{ "type": "extras_replicate", "origin": "coord-a", "userId": "7", "extras": { "color": "#ff5500", "character": "heroina" } }
{ "type": "positions_sync", "origin": "coord-a", "players": [{ "userId": "7", "x": 1984.5, "y": 1450 }] }
```

**Validación de cada mensaje.**
- Se usan las mismas funciones del juego: `sanitizeIntent` y `sanitizeExtras`.
- El username debe tener 3–32 caracteres y el provider ∈ {local, google}.
- `x` e `y` deben ser finitos y estar dentro del mundo.
- Lo inválido se ignora sin responder.
- Límites: `maxPayload` 262144 bytes y 500 mensajes por segundo por conexión; el exceso se descarta.

**`origin` y anti-bucles.**
- Después del hello, cada mensaje debe traer `origin` igual al id del peer de **esa** conexión; si no, se ignora.
- Los mensajes con `origin` igual al propio id se descartan.
- **Nada se retransmite**: cada coordinador envía lo de sus jugadores directamente a cada peer. Por eso un mensaje nunca vuelve a su origen ni da vueltas.

**Una conexión por par** (`shouldInitiate` y `resolveLink` en `coordinator/mesh.js`):
- Solo el id **menor** inicia (comparación `<` de JS sobre strings). coord-a conecta con coord-b y coord-c, y coord-b conecta con coord-c. Con n coordinadores salen n·(n−1)/2 conexiones, sin que dos se conecten a la vez en ambos sentidos.
- **Entrante de un id mayor** (no debería pasar, por ejemplo un peer con otra versión): si ya hay una conexión activa con él, la nueva se cierra con `4010 "duplicate peer"`; si no la hay, se acepta.
- **Entrante de un id menor:** **reemplaza** a cualquier conexión previa con ese peer, que se cierra con `4010`. Así, si un peer se reinicia y vuelve a conectar antes de que se detecte la caída de la conexión vieja, gana la nueva.
- **Saliente que termina el handshake** cuando ya existe una conexión activa: se cierra la nueva con `4010`.

**Ping/pong.** Cada 3 s (`PEER_PING_MS`) se hace ping a cada peer; si en el ciclo siguiente no llegó el pong, se termina la conexión y se tratan como caídos sus jugadores.

---

## 4. Los cuatro problemas del sistema distribuido

**1. Descubrimiento de peers.**
- Ningún coordinador conoce de antemano a los demás: el auth es el punto de encuentro.
- Cada coordinador **se anuncia** con el heartbeat (que incluye su `peerUrl`) y **descubre** a los otros con `GET /peers` cada 3 s.
- Un coordinador nuevo aparece en `/peers` con su primer heartbeat. En menos de 3 s los de id menor lo encuentran y lo conectan, y él conecta a los de id mayor.
- Si el auth no responde, se conservan las conexiones existentes y se reintenta en el siguiente ciclo.

**2. Bucles de replicación.**
- Cada mensaje lleva `origin`. Solo se acepta si `origin` coincide con el peer de la conexión, y se descarta si es el propio id.
- Nadie reenvía lo que recibe: el dueño envía a todos directamente. En un mesh completo no hace falta retransmitir, así que no hay rutas que formen ciclos.

**3. Consistencia.**
- **Dueño autoritativo:** cada jugador tiene `ownerId`, el coordinador donde está su cliente. Solo el dueño puede mandar `intent_replicate`, `extras_replicate`, `positions_sync` y `player_left` de ese jugador; lo que llegue de otro origen se ignora.
- **Simulación replicada:** cada coordinador aplica las intenciones de **todos** en su game loop, así que los jugadores remotos se mueven con fluidez aunque solo lleguen cambios de dirección.
- **`positions_sync` cada 1 s:** el dueño manda las posiciones reales de sus jugadores y los demás las copian. Corrige la deriva por mensajes que llegan en otro tick o por choques calculados con un `dt` distinto.
- **Resync al conectar:** un peer nuevo (o que vuelve) recibe los jugadores locales del otro como `player_joined`, con su posición actual y su `connectedAtMs` original, más su intención (si no es 0,0) y sus extras (si no están vacíos).
- **Conflicto de sesión:** la misma cuenta entra en dos coordinadores. Gana la conexión con **mayor `connectedAtMs`** (en empate, mayor `coordinatorId`). Si pierde la local, se cierra con `4002 "replaced by new session"` y el jugador pasa a ser remoto del otro, sin `player_left` (borraría la sesión nueva). Si el jugador ya era remoto, solo se reemplaza cuando la entrante es más nueva.
- Es **consistencia eventual**: durante unos milisegundos dos coordinadores pueden ver a un jugador en posiciones algo distintas. Ver la sección 10.

**4. Entrada y salida de coordinadores.**
- **Sale (Ctrl+C o caída):**
  - sus clientes pierden la conexión y se reconectan a otro (sección 6);
  - los peers detectan el cierre del WebSocket (o la falta de pong), **eliminan los jugadores remotos de ese `ownerId`** y mandan `players_update` a sus clientes;
  - el directorio lo descarta cuando vence su TTL (entre 4 y 6 s después de su último heartbeat).
  - **No se desregistra** del auth a propósito: así se demuestra el TTL.
- **Entra (o vuelve):**
  - aparece en el directorio con su primer heartbeat;
  - el mesh se arma solo por el descubrimiento;
  - con cada handshake se hace el resync, así que en menos de 10 s ve a todos los jugadores existentes y ellos a los suyos (prueba C11).

---

## 5. Seguridad

- **`CLUSTER_SECRET`** (≥ 32 caracteres, idéntico en el auth y en los tres coordinadores):
  - se exige en `POST /heartbeat`: sin él, nadie puede registrar un coordinador falso y desviar jugadores a su servidor;
  - se exige en el **upgrade** del puerto de peers: sin él, `401` y `destroy`, antes de cualquier mensaje.
- **Comparación en tiempo constante:** se compara `sha256(recibido)` con `sha256(esperado)` usando `crypto.timingSafeEqual`. Los hashes tienen siempre la misma longitud, así que no se filtra ni el largo ni el prefijo correcto.
- **Validación de todo lo que entra:**
  - heartbeat (sección 2);
  - mensajes del mesh (sección 3), con las mismas funciones que validan a los clientes;
  - mensajes de clientes (Taller 5: intenciones saneadas con `Math.sign`, extras ≤ 1024 bytes, 60 mensajes/s).
- **Propiedad:** aunque un peer con el secreto se equivoque o mienta, no puede mover, cambiar ni sacar jugadores de otro dueño.
- **El JWT sigue siendo la llave del jugador:** todos los coordinadores comparten `JWT_SECRET` con el auth, así que cualquiera acepta el token de cualquier cliente sin consultar al auth.
- **Endpoints públicos y por qué:**
  - `/coordinator` lo usa el navegador antes de conectarse y solo devuelve una URL que el cliente igual va a usar;
  - `/peers` contiene URLs que no sirven sin el secreto;
  - `/directory` es de depuración y no tiene datos de usuarios.
  - Solo `/heartbeat` **escribe** en el directorio, y está protegido.
- **Logs:** nunca se registran `CLUSTER_SECRET`, `JWT_SECRET`, tokens ni contenido de mensajes. El auth registra cada petición con método, ruta y status (incluidos los heartbeats). El coordinador avisa del auth **solo cuando cambia** su estado ("Auth alcanzable…" / "Auth NO alcanzable…"), y de un peer que no responde solo una vez.
- **Puertos de peers sin exponer:** en la demo los coordinadores están en la misma máquina, así que el mesh va por `localhost` y no se publica con ngrok.

---

## 6. Cliente

**Flujo de `play.html`**
1. `GET {AUTH_URL}/coordinator`, con el header `ngrok-skip-browser-warning` y sin caché, devuelve `{ coordinatorId, publicUrl }`.
2. Conexión a `{publicUrl}/connect?token=<JWT>`.
3. Con `welcome`, la píldora de la barra superior muestra **"Tick: 20 Hz · Coordinador: coord-b"** (los dos datos vienen del `welcome`). La lista "Jugadores en línea" muestra el coordinador de cada jugador.

**Reconexión** (`classifyClose` y `nextDelay` en `js/play/directory.js`):

| Cierre | Qué hace |
|---|---|
| `4001` (token inválido o vencido) | Vuelve al login con el mensaje; sin reintentos |
| `4002` (sesión reemplazada) | Vuelve al login con el mensaje, sin borrar el token (ya es de la sesión nueva); sin reintentos |
| Cerrar sesión | Nada: se cancelan los reintentos pendientes |
| Cualquier otro (1001 por Ctrl+C, 1006 por caída…) | **No** reconecta al mismo: vuelve a pedir `GET /coordinator` y se conecta al que diga el directorio. Aviso: "Conexión perdida con coord-x. Buscando otro coordinador… (intento N)" |

- **Espera** antes del intento N: `min(1000·N, 3000)` ms (1 s, 2 s, 3 s, 3 s…).
- **Límite:** a los **20 intentos** seguidos fallidos vuelve al login con "No hay coordinadores disponibles. Inténtalo más tarde.". Un `welcome` reinicia el contador.
- **`503` del directorio:** "Sin coordinadores disponibles. Reintentando…", y sigue reintentando con la misma espera.
- **Auth caído:** "No se pudo contactar al servicio de autenticación. Reintentando…".
- **Contenido mixto:** si `publicUrl` empieza por `ws://`, la página es `https://` y el host no es `localhost`, `127.0.0.1` ni `[::1]`, el cliente no intenta conectar. Muestra un error que explica que el `PUBLIC_URL` de ese coordinador debe ser `wss://`.

**`cluster.html`** (<http://localhost:3000/cluster.html>):
- es una tabla de `GET {AUTH_URL}/directory` que se refresca cada 1 s, con columnas coordinador, URL pública, jugadores, activo hace, último latido y estado;
- una fila que no late hace más de 4 s se marca **"sin latir"**, y desaparece cuando vence el TTL;
- si falla la red se muestra un aviso y se conserva la tabla anterior;
- no usa `innerHTML`.

---

## 7. Variables de entorno (Taller 6)

**auth-service/.env** (además de las del Taller 5, Parte II §8):

| Variable | Función | Ejemplo |
|---|---|---|
| `CLUSTER_SECRET` | Secreto del clúster, ≥ 32 caracteres, idéntico en los coordinadores | 64 caracteres hex |
| `COORDINATOR_TTL_MS` | Tiempo sin heartbeat para dar por muerto a un coordinador (entero ≥ 1000) | `6000` |
| `RESERVATION_TTL_MS` | Duración de cada reserva de `/coordinator` (entero ≥ 0; 0 las desactiva) | `3000` |

**coordinator/.env.coord-a, .env.coord-b y .env.coord-c** (y `coordinator/.env`, que equivale a coord-a). Se cargan con `node index.js --env <archivo>`; una variable que ya existe en el entorno tiene prioridad sobre el archivo.

| Variable | Función | coord-a | coord-b | coord-c |
|---|---|---|---|---|
| `COORDINATOR_ID` | Id único (`^[A-Za-z0-9_-]{1,32}# Viruscity · Sistemas Distribuidos · Proyecto final (Partes I, II y III)

Universidad de Boyacá. Tres procesos independientes que se comunican por red:

- **auth-service** (puerto 4000): registro e inicio de sesión con usuario/contraseña **y con Google**. Una sola tabla `users` en SQLite (`node:sqlite`) y JWT HS256.
- **auth-service** además es **directory service** (Taller 6): los coordinadores le avisan que están vivos y el cliente le pregunta a cuál conectarse.
- **coordinator** (tres instancias: coord-a 5001, coord-b 5002 y coord-c 5003, más los puertos del mesh 5101–5103): **servidores autoritativos** del juego en vivo. Reciben a los jugadores por WebSocket, aplican sus *intenciones* en un game loop a 20 Hz (con choques contra el mapa de Virus City) y se replican entre sí por un mesh WebSocket para que todos tengan el mismo mundo.
- **client** (puerto 3000): páginas HTML + JS plano servidas con Express. `login.html` (con botón de Google) y `play.html` (el juego sobre el mapa de la ciudad, con selector de personaje).

**Parte I (Taller 4)** fue la identidad: login con JWT y lobby en vivo. **Parte II (Taller 5)** agrega el juego en vivo con el servidor como autoridad y el login con Google. **Parte III (Taller 6)** reparte el juego entre varios coordinadores intercambiables con el mismo estado. Este README empieza por el Taller 6 (el estado actual); el Taller 5 sigue siendo válido para el juego, la base de datos y Google, y al final hay un resumen del Taller 4.

**Contenido**
- [Parte III · Taller 6](#parte-iii--taller-6): 1. Arquitectura · 2. Directorio · 3. Mesh · 4. Los cuatro problemas · 5. Seguridad · 6. Cliente · 7. Variables · 8. Correr el clúster · 9. ngrok · 10. Limitaciones · 11. Decisiones · 12. Sustentación
- [Parte II · Taller 5](#parte-ii--taller-5): 1. Arquitectura · 2. Base de datos · 3. Google · 4. API del auth · 5. Coordinador · 6. Extra: personaje · 7. Cliente · 8. Variables · 9. Correr todo · 10. Google Cloud · 11. ngrok · 12. Decisiones · 13. Errores típicos · 14. Sustentación
- [Estructura del repositorio](#estructura-del-repositorio)
- [Interfaz de Viruscity](#interfaz-de-viruscity)
- [Parte I · Taller 4 (resumen)](#parte-i--taller-4-resumen)
- [Créditos](#créditos)

---
) | `coord-a` | `coord-b` | `coord-c` |
| `PORT` | Puerto de clientes (HTTP + `/connect`) | `5001` | `5002` | `5003` |
| `PEER_PORT` | Puerto del mesh (distinto de `PORT`) | `5101` | `5102` | `5103` |
| `PUBLIC_URL` | URL que usan los **clientes** (`ws://` o `wss://`) | `ws://localhost:5001` | `ws://localhost:5002` | `ws://localhost:5003` |
| `PEER_URL` | URL que usan los **otros coordinadores** | `ws://localhost:5101` | `ws://localhost:5102` | `ws://localhost:5103` |
| `AUTH_URL` | URL del auth (directorio) | `http://localhost:4000` | igual | igual |
| `JWT_SECRET` | La misma del auth | igual en todos | | |
| `CLUSTER_SECRET` | La misma del auth | igual en todos | | |
| `HEARTBEAT_INTERVAL_MS` | Ping WebSocket a los clientes | `30000` | | |
| `HEARTBEAT_AUTH_MS` | Heartbeat HTTP al auth | `2000` | | |
| `PEER_DISCOVERY_MS` | Cada cuánto se pide `/peers` | `3000` | | |
| `PEER_PING_MS` | Ping/pong entre peers | `3000` | | |
| `PEER_SYNC_MS` | Envío de `positions_sync` | `1000` | | |
| `WORLD_WIDTH` / `WORLD_HEIGHT` · `MAP_FILE` · `PLAYER_RADIUS` · `PLAYER_SPEED` · `TICK_RATE` · `MAX_EXTRAS_BYTES` · `MAX_MSGS_PER_SEC` | Juego (Taller 5); **iguales** en los tres | `3840` / `3840` · `./map/virus-city.json` · `16` · `200` · `20` · `1024` · `60` | | |

Los tiempos son enteros ≥ 100 ms. Las plantillas versionadas son `coordinator/.env.coord-a.example`, `.env.coord-b.example`, `.env.coord-c.example` y `.env.example`.

**client/.env**

| Variable | Función | Local | Con ngrok |
|---|---|---|---|
| `PORT` | Puerto del client | `3000` | `3000` |
| `AUTH_URL` | URL del auth: login **y directorio** | `http://localhost:4000` | `https://<túnel del auth>` |
| `COORDINATOR_WS_URL` | **Opcional, ya no se usa para conectar** (el coordinador lo asigna el directorio). Puede quedar vacía | vacía | vacía |
| `GOOGLE_CLIENT_ID` | Igual que en el Taller 5 | | |

---

## 8. Cómo correr el clúster en local

Requisitos: los del Taller 5 (Node.js ≥ 22.13, npm, git). Comandos para Git Bash, desde la raíz del repositorio.

1. **Dependencias:**
   ```bash
   (cd auth-service && npm install) && (cd coordinator && npm install) && (cd client && npm install)
   ```
2. **Archivos de entorno:**
   ```bash
   cp auth-service/.env.example auth-service/.env
   cp coordinator/.env.coord-a.example coordinator/.env.coord-a
   cp coordinator/.env.coord-b.example coordinator/.env.coord-b
   cp coordinator/.env.coord-c.example coordinator/.env.coord-c
   cp coordinator/.env.example coordinator/.env      # solo para npm start / npm run smoke
   cp client/.env.example client/.env
   ```
3. **Dos secretos distintos**, cada uno copiado **igual** en `auth-service/.env` y en los cuatro `.env` del coordinator:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → CLUSTER_SECRET
   ```
   Y el `GOOGLE_CLIENT_ID` como en el Taller 5 (Parte II §9, paso 4).
4. **Cinco terminales**, en este orden:
   ```bash
   cd auth-service && npm start        # 1 · Auth service en puerto 4000 · directorio de coordinadores (TTL 6000 ms, reservas 3000 ms)
   cd coordinator && npm run start:a   # 2 · Coordinator coord-a en puerto 5001 … · Mesh de coord-a en el puerto 5101
   cd coordinator && npm run start:b   # 3 · coord-b (5002 / 5102)
   cd coordinator && npm run start:c   # 4 · coord-c (5003 / 5103)
   cd client && npm start              # 5 · Client en puerto 3000
   ```
   En pocos segundos cada coordinador escribe "Auth alcanzable (…)" y "Peer coord-x conectado (entrante/saliente)" por cada uno de los otros dos.
5. **Cuatro pestañas** con cuatro usuarios distintos. Las pestañas de un mismo origen y perfil comparten `localStorage` (y con él el token): si entras con otro usuario en la misma ventana, la pestaña anterior vuelve al login. Para tener cuatro sesiones combina ventana normal e incógnito con dos orígenes distintos:
   - normal: <http://localhost:3000> y <http://127.0.0.1:3000>;
   - incógnito: <http://localhost:3000> y <http://127.0.0.1:3000>.

   Abre también <http://localhost:3000/cluster.html>.
6. **Estado de un coordinador:** `curl -s http://localhost:5001/status` devuelve `{ coordinatorId, uptime, localPlayers, totalPlayers, peers, authReachable }`.

**Pruebas**

| Comando | Qué prueba |
|---|---|
| `cd auth-service && npm test` | Taller 5 más el directorio: validación, TTL, reservas, empates, purga y rutas con secreto. El resumen dice 39 (cuenta `test/helpers.js` como un archivo) |
| `cd coordinator && npm test` | 45 pruebas: juego del Taller 5, configuración por instancia, heartbeat y `/peers` contra un auth falso, y la lógica pura del mesh |
| `cd client && npm test` | 73 pruebas: las del Taller 5, el directorio y la reconexión (`directory.js`) y la vista del clúster (`cluster.js`) |
| `cd coordinator && npm run smoke:cluster` | Levanta **su propio** auth (4600) y coord-a/b/c/d (5601–5604 y 5701–5704) con secretos al azar y un mundo sin mapa. Corre C1–C13 (ver abajo) y cierra todo. No necesita nada corriendo |
| `cd coordinator && npm run smoke` | Regresión del Taller 5 con **un** coordinador: necesita el auth en 4000 y `npm start` (coord-a en 5001) corriendo; 26 verificaciones |

`smoke:cluster`, en resumen:
- **C1** mesh completo en < 10 s;
- **C2–C3** reparto con reservas;
- **C4–C6** jugadores, movimiento y color entre coordinadores;
- **C7** salida en < 500 ms;
- **C8** coordinador tardío con resync;
- **C9** sesión duplicada entre coordinadores;
- **C10** caída de un coordinador: cierre de sus clientes, limpieza en < 2 s, TTL y reconexión;
- **C11** el coordinador vuelve;
- **C12** seguridad;
- **C13** basura en el puerto del mesh.

C5 mueve hacia el centro del mundo en vez de a la derecha, para no chocar con el borde.

---

## 9. ngrok

Se exponen **cinco** túneles HTTP: client 3000, auth 4000 y los puertos **públicos** de los coordinadores 5001, 5002 y 5003. Los puertos de peers (5101–5103) **no** se exponen: el mesh va por `localhost` en la misma máquina.

La plantilla está en `ngrok.example.yml` (sin authtoken). Guarda tu authtoken una vez en la configuración por defecto y arranca todo junto con los dos `--config`. En Windows (cmd):

```bat
ngrok config add-authtoken <TU_AUTHTOKEN>
ngrok config check --config ngrok.example.yml
ngrok start --all --config "%LOCALAPPDATA%\ngrok\ngrok.yml" --config ngrok.example.yml
```

La plantilla tiene las rutas de macOS y Linux. `ngrok config check` sin argumentos dice dónde está tu archivo por defecto. También puedes copiarla como `ngrok.yml`, que está en `.gitignore`.

- **Límite del plan gratuito:** puede no permitir cinco túneles a la vez. **Verifícalo en tu panel de ngrok** antes de la sustentación. Si no alcanza, la demo puede usar dos coordinadores (client, auth, coord-a y coord-b) y dejar coord-c solo en local.
- **Después de abrir los túneles**, copia las URLs que muestra ngrok, sin barra final:
  - en cada `coordinator/.env.coord-x`: `PUBLIC_URL=wss://<túnel de ese coordinador>` (con **`wss://`**, porque la página llega por https). `PEER_URL` **se queda** en `ws://localhost:51xx`;
  - en `client/.env`: `AUTH_URL=https://<túnel del auth>`;
  - el `AUTH_URL` de los coordinadores puede quedarse en `http://localhost:4000` (están en la misma máquina que el auth).
- **Reinicia** los tres coordinadores (el `PUBLIC_URL` viaja en el heartbeat) y el client (`/config.js` se genera al arrancar).
- **Google Cloud:** agrega `https://<túnel del client>` en los orígenes autorizados del cliente OAuth (Parte II §10).
- Si `PUBLIC_URL` se queda en `ws://localhost:…`, la página por https muestra el error de contenido mixto de la sección 6, en lugar de fallar en silencio.
- **Página de aviso:** el cliente envía `ngrok-skip-browser-warning: true` en sus `fetch` (también a `/coordinator` y `/directory`).

---

## 10. Limitaciones conocidas

- **El directorio es un punto único de falla.** Vive en la memoria del auth: si el auth cae, nadie nuevo puede entrar ni pedir coordinador. Los coordinadores **siguen funcionando** con los jugadores ya conectados y el mesh existente. Al volver el auth, se rellena solo con el siguiente heartbeat (≤ 2 s).
- **El estado no persiste.** Las posiciones y la lista de jugadores están en memoria; si se apagan todos los coordinadores, el mundo empieza de cero.
- **Posición al reconectar a otro coordinador.** Si su coordinador murió, el jugador reaparece en una posición **al azar** al conectarse a otro. Los peers borraron sus datos con la caída, y la última posición que recuerda cada coordinador (`lastPositions`, del Taller 5) es solo de **sus** clientes.
- **Relojes de distintas máquinas.** El conflicto de sesión compara `connectedAtMs` de coordinadores distintos. En una sola máquina es el mismo reloj; en varias, un desfase mayor que el tiempo entre las dos conexiones puede elegir mal la ganadora (haría falta NTP o relojes lógicos). La hora del juego y la radio también salen del reloj del coordinador de cada cliente.
- **El mesh completo es O(n²).** n coordinadores abren n·(n−1)/2 conexiones, y cada cambio se envía n−1 veces. Para 3–10 coordinadores es lo más simple; para muchos haría falta un broker (pub/sub) o particionar el mundo por zonas.
- **Consistencia eventual.**
  - Un jugador remoto se mueve con su intención replicada y se corrige cada 1 s con `positions_sync`, así que puede haber diferencias de pocos píxeles entre coordinadores durante ese intervalo.
  - Al caer un peer, sus jugadores desaparecen de los demás hasta que se reconectan.
- **El auth registra cada heartbeat** (método, ruta y status) en su consola: con 3 coordinadores son 1,5 líneas por segundo.

---

## 11. Decisiones y extensiones justificadas

| Decisión | Por qué |
|---|---|
| `CLUSTER_SECRET` en `/heartbeat` y en el upgrade de peers | Sin él, cualquiera podría anunciar un coordinador falso o meterse al mesh y mover jugadores. Se compara con sha256 + `timingSafeEqual` |
| Reservas en `/coordinator` (3 s) | El heartbeat atrasa hasta 2 s la carga real; sin reservas, 4 clientes simultáneos irían al mismo coordinador |
| Resync al completar el handshake | Un coordinador que llega tarde (o vuelve) no tiene historia: necesita la foto actual de los jugadores, su intención y sus extras |
| `positions_sync` cada 1 s | La simulación replicada deriva (ticks desfasados, choques con otro `dt`); el dueño corrige con su posición autoritativa |
| Toma de sesión por `connectedAtMs` (empate: mayor id) | Las dos conexiones de una cuenta pueden llegar a coordinadores distintos casi a la vez; con una regla determinista los dos llegan a la misma conclusión sin coordinarse |
| Propiedad (`ownerId`) | Una sola fuente de verdad por jugador: evita que dos coordinadores se contradigan y limita el daño de un peer equivocado |
| El id menor inicia la conexión | Da una conexión por par sin negociación; los duplicados que igual ocurren (reinicios) se resuelven con 4010 |
| No desregistrarse al apagar | Para demostrar el TTL y porque una caída real (kill, corte de red) tampoco avisa |
| 500 mensajes/s y 256 KiB por conexión de peer | Un `positions_sync` con muchos jugadores pesa más que un mensaje de cliente, pero sigue acotado |
| `--env <archivo>` y scripts `start:a/b/c` | Tres instancias del mismo código sin variables en línea (funciona igual en Windows, macOS y Linux) |

---

## 12. Guía de sustentación (Taller 6)

**Antes de empezar:**
- las 5 terminales de la sección 8 corriendo;
- 4 pestañas con 4 usuarios distintos, en 4 contextos que no compartan `localStorage` (sección 8, paso 5);
- cuatro usuarios creados (por ejemplo `alice`, `bob`, `carol` y `dave`);
- una sexta terminal (Git Bash) para los `curl`.

**(1) Tres coordinadores y el mesh · 3 min**
1. Muestra las terminales 2–4: cada coordinador dice "Auth alcanzable" y "Peer … conectado" dos veces. coord-a dice "(saliente)" con b y c; coord-c dice "(entrante)" con a y b. Explica que **el id menor inicia**.
2. Pide el directorio:
   ```bash
   curl -s http://localhost:4000/peers
   curl -s http://localhost:4000/directory
   curl -s http://localhost:5002/status    # peers con coord-a y coord-c, authReachable: true
   ```
3. Explica el heartbeat (cada 2 s, con `CLUSTER_SECRET`) y el TTL de 6 s.

**(2) Cuatro clientes repartidos · 3 min**
1. Abre <http://localhost:3000/cluster.html> en una ventana aparte.
2. Entra con los 4 usuarios, uno por pestaña: la píldora dice "Tick: 20 Hz · Coordinador: …" y van quedando repartidos.
3. En `cluster.html` la columna Jugadores suma 4 y ningún coordinador tiene los 4. Explica las **reservas** (sección 2).
4. Enseña en la lista de jugadores que cada uno muestra su coordinador.

**(3) Alice y Bob en coordinadores distintos · 2 min**
1. Busca dos pestañas con coordinadores distintos (por ejemplo, Alice en coord-a y Bob en coord-b).
2. Mueve a Alice: Bob la ve moverse en vivo, aunque su coordinador es otro. Cambia el color o el personaje de Alice: Bob lo ve.
3. Explica el camino: intent → coord-a → `intent_replicate` → coord-b simula → `state` a Bob, más `positions_sync` cada 1 s.

**(4) Matar un coordinador · 4 min**
1. En la sexta terminal deja listo el medidor (cambia `coord-b` por el que vayas a matar):
   ```bash
   t0=$(date +%s%3N); while curl -s http://localhost:4000/peers | grep -q '"coord-b"'; do sleep 0.2; done; echo "coord-b salió de /peers a los $(( $(date +%s%3N) - t0 )) ms"
   ```
2. Pulsa Enter en el medidor y enseguida **Ctrl+C** en la terminal de coord-b.
3. En las pestañas que estaban en coord-b aparece "Conexión perdida con coord-b. Buscando otro coordinador… (intento 1)". En 1–2 s ya dicen "Coordinador: coord-a" o "coord-c" y siguen jugando (reaparecen en otra posición, ver sección 10).
4. coord-a y coord-c escriben "Peer coord-b desconectado · se quitaron N jugadores suyos".
5. En `cluster.html` coord-b se ve **"sin latir"** y desaparece. El medidor imprime entre ~4000 y ~6000 ms: el TTL de 6 s se cuenta desde el **último** heartbeat, que fue entre 0 y 2 s antes del Ctrl+C.
6. Vuelve a levantarlo con `npm run start:b`: en pocos segundos está otra vez en `/peers` y en `cluster.html`, el mesh se rearma y hace el resync.

**(5) Preguntas probables**

1. **¿Por qué una sola conexión por par y por qué inicia el id menor?** Dos conexiones entre los mismos peers duplicarían cada mensaje. Con "el menor inicia" cada par se conecta en un solo sentido sin negociar, y los duplicados por reinicios se cierran con 4010.
2. **¿Cómo evitan los bucles?** Nadie reenvía lo que recibe: el dueño envía directo a cada peer. Además se exige `origin` = peer de la conexión y se descarta el propio.
3. **¿Qué pasa si dos coordinadores aceptan al mismo usuario?** Gana la conexión más nueva (`connectedAtMs`; empate, id mayor). La otra se cierra con 4002 y ese jugador queda como remoto del ganador.
4. **¿Por qué el directorio no es un proxy?** Solo **asigna**: el cliente se conecta directo al coordinador. Así el auth no carga el tráfico del juego a 20 Hz ni agrega latencia, y si se cae, el juego en curso sigue.
5. **¿Qué pasa si se cae el auth?** No hay logins nuevos ni asignaciones. Los coordinadores siguen jugando y conservan el mesh, y el aviso sale una sola vez. Al volver, el directorio se rellena con los heartbeats en ≤ 2 s.
6. **¿Cómo evitan que 4 clientes vayan al mismo?** Con las reservas de 3 s: cada asignación cuenta de inmediato como carga, sin esperar el heartbeat.
7. **¿Qué pasa con un coordinador nuevo?** Se anuncia con su heartbeat, los demás lo encuentran en `/peers` en ≤ 3 s, y el handshake hace el resync. Empieza a recibir clientes porque es el de menor carga.
8. **¿Por qué O(n²)?** En un mesh completo cada par tiene una conexión: n·(n−1)/2. Para pocos coordinadores es simple y de baja latencia (un salto); para muchos convendría un broker o particionar el mundo.
9. **¿Para qué `positions_sync` si ya replican la intención?** Cada coordinador simula con su propio reloj, así que pequeñas diferencias de tiempo y de choques acumulan error. Cada segundo el dueño impone la posición real.
10. **¿Qué es balanceo de carga del lado del cliente?** El cliente pregunta a quién conectarse y se conecta directamente, sin un balanceador en medio. Si su coordinador falla, el propio cliente vuelve a preguntar y elige otro.

---

# Parte II · Taller 5

> Esta parte describe el juego del Taller 5 con **un** coordinador. Lo que cambió en el Taller 6: el coordinador lo asigna el directorio (`COORDINATOR_WS_URL` ya no se usa), `coordinator/.env` usa el puerto 5001 (como coord-a) y el clúster se corre y se expone como dice la Parte III (§8 y §9).

## 1. Arquitectura

```
                         ┌──────────────────────────────────────────────┐
                         │      Google Identity Services (GIS)          │
                         │  accounts.google.com/gsi/client (navegador)  │
                         └──────────────┬───────────────────────────────┘
                                        │ (B1) ID token (JWT de Google)
                                        ▼
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ NAVEGADOR  login.html ── play.html          localStorage: token, username     │
 │            window.lastState = último "state" del servidor                     │
 └──────┬──────────────────────┬─────────────────────────────┬─────────▲─────────┘
        │ (0) HTML, JS,        │ (A) /register, /login       │ (C) WSS │ (D) welcome,
        │     /config.js       │ (B2) /auth/google           │ intent, │     state (20 Hz),
        │                      │      ◄── { token, username }│ extras  │     players_update
        ▼                      ▼                             ▼         │
 ┌────────────────┐   ┌──────────────────────┐   ┌───────────────────────────────┐
 │ túnel ngrok    │   │ túnel ngrok          │   │ túnel ngrok                   │
 └───────┬────────┘   └──────────┬───────────┘   └──────────────┬────────────────┘
         ▼                       ▼                              ▼
 ┌────────────────┐   ┌──────────────────────┐   ┌───────────────────────────────┐
 │ client  :3000  │   │ auth-service  :4000  │   │ coordinator  :5001 (coord-a)  │
 │ Express        │   │ Express · bcryptjs   │   │ Express + ws                  │
 │ public/        │   │ google-auth-library  │   │ /connect?token=<JWT>          │
 │ /config.js     │   │ node:sqlite          │   │ Map userId → { username,      │
 │ (desde .env)   │   │ users.db (1 tabla)   │   │   provider, socket, x, y,     │
 └────────────────┘   └──────────┬───────────┘   │   intent, extras }            │
                                 │               │ game loop: tick() a 20 Hz     │
                                 │               │ map/virus-city.json: casillas │
                                 │               │   sólidas (choques)           │
                                 │               └──────────────┬────────────────┘
                                 └──────── JWT_SECRET ──────────┘
                     (el auth firma el JWT y el coordinator lo verifica; no se llaman entre sí)
```

### Flujos

**A. Registro e inicio de sesión local**
1. `POST /register { username, password }` → valida, guarda el hash de bcryptjs con `provider = 'local'` → `201 { userId, username }`.
2. `POST /login { username, password }` → `200 { token, username }`. El token es un JWT HS256 con `{ userId, username, provider: "local" }` más `iat` y `exp`.
3. El cliente guarda `token` y `username` en `localStorage` y abre `play.html`.

**B. Inicio de sesión con Google (Opción A, Google Identity Services)**
1. El botón de Google (dibujado por GIS en `login.html`) entrega al navegador un **ID token** (`credential`).
2. El cliente envía `POST /auth/google { idToken }`. El auth-service verifica el token con Google (firma, emisor, vencimiento y *audience*), exige `email_verified` y busca la cuenta por `sub`.
3. **Si la cuenta ya existe**: `200 { token, username }`.
4. **Si es el primer ingreso**: `409 { error: "username_required", hint }`. El cliente muestra el panel "Elige tu username" y reintenta con `{ idToken, username }` → `200` (o `409 username_taken` si el nombre está ocupado).
5. El JWT es el mismo formato que el local, con `provider: "google"`. El cliente lo guarda y abre `play.html`.

**C. Conexión WebSocket**
1. `play.html` abre `new WebSocket("{URL del coordinador}/connect?token=<JWT>")`. En el Taller 5 la URL era `COORDINATOR_WS_URL`; desde el Taller 6 es el `publicUrl` que devuelve `GET /coordinator` (Parte III §6).
2. El coordinator verifica el JWT **en el `upgrade`** (HS256, `userId`, `username`, `provider` ∈ {local, google} y `exp`). Si falla, completa el handshake y cierra con `4001 "invalid token"`.
3. Si es válido: aparece en una casilla libre del centro de la ciudad, recibe `welcome` y todos reciben `players_update`.

**D. Game loop (servidor autoritativo)**
1. El cliente envía solo **intenciones** (`{ type: "intent", intent: { dir: { x, y } } }`) y **extras** (`extras_update`). El handler de mensajes solo las **guarda**.
2. Cada tick (20 Hz) el servidor calcula `dt` real, mueve a todos con su intención normalizada, los frena contra las casillas sólidas del mapa (edificios, agua, árboles, vallas), los mantiene dentro del mundo y envía **un** mensaje `state` con todos los jugadores.
3. El cliente guarda ese mensaje en `window.lastState` y lo dibuja sobre la ciudad (con un suavizado solo visual).

---

## 2. Base de datos

Una sola tabla, con el esquema exacto de [auth-service/db.js](auth-service/db.js#L14):

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('local','google')),
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

Además hay un índice aparte, `users_username_nocase` (`UNIQUE` sobre `username COLLATE NOCASE`), para que "Oscar" y "oscar" sean el mismo nombre. No cambia el esquema de la tabla.

**Invariantes por provider** (se hacen cumplir en `createStatements()` de `db.js` y en `app.js`):

| provider | password_hash | google_sub | email |
|---|---|---|---|
| `local` | obligatorio (hash bcryptjs) | NULL | NULL |
| `google` | NULL | obligatorio (el `sub` de Google) | obligatorio |

**¿Por qué una sola tabla?**
- **Un username no se repite entre providers:** la restricción `UNIQUE` (y el índice sin mayúsculas) vale para todos. Si `alice` es local, nadie puede elegir `alice` con Google, y al revés.
- **Una sola identidad aguas abajo:** coordinador, puntajes o replicación futuros trabajan con un único `userId`. Con dos tablas habría que unir o duplicar esa lógica.

**Migración automática desde el Taller 4.** Al arrancar, `ensureSchema()` revisa `PRAGMA table_info('users')`:
- **Si no hay tabla:** la crea.
- **Si es la tabla del Taller 4 (sin `provider`):**
  1. copia el archivo a `users.db.bak` (o `users.db.<fecha>.bak` si ya existe uno);
  2. dentro de una transacción crea `users_new`, copia los usuarios con `provider = 'local'` conservando sus `id`, borra la tabla vieja y renombra la nueva;
  3. si algo falla, hace `ROLLBACK`;
  4. registra solo el conteo: `[db] migración aplicada: N usuarios conservados como provider=local`.
- **Si ya tiene `provider`:** no hace nada. Es idempotente.

Los `.bak` están en `.gitignore`.

---

## 3. Autenticación con Google

**Opción A: Google Identity Services, con el ID token en el navegador.**
- **No hay Client Secret ni redirect URI.** No hay secreto que guardar ni rutas de callback que proteger: menos superficie de ataque.
- **El navegador recibe el ID token directamente** (un JWT firmado por Google) y lo envía al auth-service, que lo verifica.
- **El `GOOGLE_CLIENT_ID` es público:** viaja en `/config.js` hacia el navegador.

**Validaciones y dónde se hacen**

| Validación | Dónde |
|---|---|
| Forma de JWT (3 segmentos base64url) antes de llamar a Google; así un token basura se rechaza sin ir a la red | [auth-service/google.js](auth-service/google.js#L14) `makeGoogleVerifier()` |
| Firma, emisor y vencimiento con los certificados de Google; `audience` = nuestro `GOOGLE_CLIENT_ID` | `client.verifyIdToken({ idToken, audience: clientId })` en `google.js` |
| **Defensa en profundidad:** además se compara `payload.aud === clientId` | `google.js` (línea 23) |
| `email_verified === true` | [auth-service/app.js](auth-service/app.js#L139) `POST /auth/google` |
| La llave de la cuenta es `sub` (`google_sub`), **nunca el email** (el email puede cambiar o reasignarse) | `findByGoogle(sub)` en `app.js` / `db.js` |
| Nunca se registran el idToken, el email, el sub ni `err.message` de la verificación (la librería puede incluir el token en sus mensajes) | `app.js`: solo el texto fijo `"verificación de ID token fallida"` |

**Respuestas de `POST /auth/google`**

| Código | Cuerpo | Cuándo |
|---|---|---|
| 200 | `{ "token": "eyJ…", "username": "bob_google" }` | Cuenta ya vinculada, o primer ingreso con un username válido y libre |
| 409 | `{ "error": "username_required", "hint": "Primer login con Google: elige un username." }` | Primer ingreso sin `username` |
| 409 | `{ "error": "username_taken" }` | El username elegido ya existe (en cualquier provider y con cualquier combinación de mayúsculas) |
| 401 | `{ "error": "invalid_id_token" }` | Token con formato inválido, firma, emisor o audience incorrectos, o vencido |
| 401 | `{ "error": "email_not_verified" }` | El correo de la cuenta de Google no está verificado |
| 400 | `{ "error": "idToken requerido" }` | Falta `idToken`, no es texto o está vacío |
| 400 | `{ "error": "username debe tener entre 3 y 32 caracteres y solo letras, números o guion bajo" }` | Username con formato inválido |
| 500 | `{ "error": "internal" }` | Error inesperado (se registra un texto fijo, sin detalles) |

---

## 4. API del auth-service

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `GET /health` | — | `200 { "status": "ok" }` |
| `POST /register` | `{ username, password }` | `201 { userId, username }` · `409 { error: "El nombre de usuario ya existe" }` · `400 { error }` |
| `POST /login` | `{ username, password }` | `200 { token, username }` · `401 { error: "Credenciales inválidas" }` (contraseña incorrecta, usuario inexistente **o usuario de Google**: el mismo cuerpo) · `400 { error: "username y password son obligatorios" }` |
| `POST /auth/google` | `{ idToken, username? }` | Ver la tabla de la sección 3 |

Otras respuestas comunes: `400 { error: "JSON inválido" }` · `413 { error: "Cuerpo demasiado grande" }` (más de 4 kB) · `404 { error: "Ruta no encontrada" }`.

**Ejemplos con curl** (Git Bash; con el auth-service en `localhost:4000`):

```bash
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"userId":"1","username":"alice"}  HTTP 201

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"ALICE","password":"secret123"}'
# {"error":"El nombre de usuario ya existe"}  HTTP 409

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/register -H "Content-Type: application/json" -d '{"username":"ab","password":"secret123"}'
# {"error":"username debe tener entre 3 y 32 caracteres y solo letras, números o guion bajo"}  HTTP 400

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"secret123"}'
# {"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…","username":"alice"}  HTTP 200

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"incorrecta"}'
# {"error":"Credenciales inválidas"}  HTTP 401
```

**`/auth/google` con curl.** El ID token lo emite Google en el navegador, así que no se puede fabricar. Para obtener uno real:
1. Inicia sesión con el botón de Google en `login.html` con DevTools abierto.
2. En la pestaña **Network**, abre la petición `auth/google` y copia `idToken` desde **Payload**. Vale alrededor de una hora y solo para tu `GOOGLE_CLIENT_ID`.

Con un token ficticio la respuesta es siempre 401:

```bash
curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/auth/google -H "Content-Type: application/json" -d '{"idToken":"abc"}'
# {"error":"invalid_id_token"}  HTTP 401

curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/auth/google -H "Content-Type: application/json" -d '{}'
# {"error":"idToken requerido"}  HTTP 400
```

---

## 5. Coordinador autoritativo

**El cliente nunca mueve al jugador.** Solo dice hacia dónde quiere ir; el servidor decide dónde está.

**Game loop** ([coordinator/index.js](coordinator/index.js#L295) `tick()` y lógica pura en [coordinator/game.js](coordinator/game.js#L187)):
1. **`dt` real:** se mide con `Date.now()` entre ticks y se acota a 0,25 s (`clampDt`). Así la velocidad no depende del tick rate, y una pausa del proceso no provoca un salto enorme.
2. **Movimiento normalizado:** `stepPlayers` divide la intención por `Math.hypot(x, y)`, así que la diagonal avanza lo mismo que un eje (200 px/s, no 283).
3. **Choques con el mapa:** con `MAP_FILE`, el jugador es una caja de `2·radio` y `moveAxis` lo mueve **un eje a la vez**. Si la caja entra en una casilla sólida, se pega al borde de esa casilla (y en diagonal se desliza por la pared). Avanza en pasos de media casilla, así que tampoco atraviesa paredes con un `dt` grande.
   - **Puertas de los locales (portales):** el mapa trae una lista de `portals` (rectángulos de casillas con un destino). Si el centro del jugador pisa uno, `stepPlayers` lo traslada al destino: la puerta del Burger Neón lleva dentro del local y la salida del local devuelve a la acera. Lo decide el servidor, igual que los choques.
4. **Límites del mundo:** cada jugador queda dentro de `[radio, ancho − radio]` × `[radio, alto − radio]`.
5. **Un broadcast por tick:** `snapshot(players)` se serializa **una vez** y se envía a todos. Los handlers de mensajes nunca hacen broadcast.
6. **20 Hz de verdad:** el loop se programa con una hora objetivo (`scheduleTick`), no con `setInterval`. En Windows `setInterval(50)` dispara cada ~60 ms (≈16,5 Hz).

**Protocolo**

Del servidor al cliente:
```json
{ "type": "welcome", "you": { "userId": "4", "username": "alice", "provider": "local" },
  "world": { "width": 3840, "height": 3840, "playerRadius": 16, "tickRate": 20 } }

{ "type": "state", "t": 1794174650735,
  "players": [ { "userId": "4", "username": "alice", "provider": "local", "x": 1708.01, "y": 1189.1,
                 "extras": { "character": "mensajero", "color": "#2563eb", "detail": "#facc15", "skin": "#8d5b3c" } },
               { "userId": "7", "username": "bob_google", "provider": "google", "x": 2096.12, "y": 1376.09, "extras": {} } ] }

{ "type": "players_update", "players": [ { "userId": "4", "username": "alice" }, { "userId": "7", "username": "bob_google" } ] }
```

Del cliente al servidor:
```json
{ "type": "intent", "intent": { "dir": { "x": 1, "y": -1 } } }
{ "type": "extras_update", "extras": { "character": "mensajero", "color": "#2563eb", "detail": "#facc15", "skin": "#8d5b3c" } }
```

**El mapa en el servidor.** `coordinator/map/virus-city.json` guarda la grilla de 80 × 80 casillas de 48 (1 = sólida), las casillas donde se puede aparecer y los portales. Las filas 0–59 son la ciudad y las 60–79, la **zona de interiores**, donde están el Burger Neón y el Supermercado rodeados de pared. Así los locales son parte del mismo mundo y la posición sigue siendo solo `(x, y)`: el protocolo no cambia, y cada cliente sabe en qué escenario está cada jugador por sus coordenadas (`sceneAt`). Lo genera `npm run map` (en `client/`) ejecutando **el mismo** trazado que dibuja el cliente (`layout.js` e `interiors.js`), y la prueba `client/test/map.test.mjs` falla si el archivo y el dibujo no coinciden. `parseMap()` valida el archivo al arrancar, el tamaño del mundo sale del mapa (3840 × 3840) y `randomSpawn()` elige una casilla libre del centro de la ciudad. Sin `MAP_FILE`, el mundo es el rectángulo vacío de `WORLD_WIDTH × WORLD_HEIGHT` (1200 × 800 por defecto).

**Validaciones y límites** ([game.js](coordinator/game.js#L125) e [index.js](coordinator/index.js#L242) `ws.on("message")`):
- **`intent`:** `x` e `y` deben ser `number` finitos; se reducen a −1/0/1 con `Math.sign` (`{9999, -5}` → `{1, -1}`). Strings, NaN, Infinity, arrays o falta de `dir` → se ignora.
- **`extras_update`:** objeto no nulo y no array, de **máximo 1024 bytes** serializado (`MAX_EXTRAS_BYTES`). Si trae `color`, debe cumplir `^#[0-9a-fA-F]{6}$` (si no, se ignora todo el mensaje) y se guarda en minúsculas. Se guarda una **copia** y **reemplaza** los extras anteriores.
- **`maxPayload` de 2048 bytes:** un mensaje mayor cierra el socket.
- **Máximo 60 mensajes por segundo y por socket** (`MAX_MSGS_PER_SEC`): el exceso se descarta en silencio.
- **Lo inválido** (JSON roto, tipos desconocidos) se ignora sin responder ni caer. Nada de lo recibido se registra en logs.
- **Socket vigente:** solo cuentan los mensajes del socket vigente del usuario.

**Otros puntos**
- **`provider` lo pone el servidor**, desde el JWT verificado; no es un extra que el cliente pueda falsificar.
- **Sesión duplicada** (Taller 4): si la misma cuenta abre otra conexión, la anterior se cierra con `4002 "replaced by new session"`. El `close` de la vieja no borra a la nueva, y la sesión nueva **sigue en la misma posición**.
- **Recargar no teletransporta:** al desconectarse, el coordinator guarda la última posición del `userId` (`lastPositions`, en memoria). Al volver a conectarse aparece ahí (`resumePosition` en `game.js`, que comprueba que siga siendo válida); solo la primera conexión aparece al azar. Así el cliente no puede elegir dónde aparecer recargando la página ni abriendo otra pestaña. Si el coordinator se reinicia, esas posiciones se pierden.
- **Heartbeat:** `ping` cada `HEARTBEAT_INTERVAL_MS`; quien no responde antes del siguiente ciclo se termina.
- **Expiración:** al conectar se programa el cierre `4001 "token expired"` para el `exp` del token.
- **`GET /health`:** responde `{ "status": "ok", "players": N, "tickRate": 20, "map": "virus-city" }` (`map: null` sin mapa).

---

## 6. Feature extra: personaje del jugador e insignia del provider

**Personaje.** En el panel "Tu personaje" de `play.html` (pestañas Personaje, Colores y Poder) cada jugador elige:
- un **personaje**: Heroína 11, Explorador Pop o Mensajero;
- su **color principal** (overol, chaqueta o sudadera): una de seis muestras o cualquiera con el selector;
- un **detalle** (pelo o gorra);
- su **tono de piel**;
- su **poder**, tomado del diseño original de cada personaje:
  - Heroína 11: aura telequinética, walkie-talkie o frasco de esporas;
  - Explorador Pop: escopeta, espada o frasco de esporas;
  - Mensajero: mochila cohete, aerosol o subfusil.

1. El cliente envía `{ type: "extras_update", extras: { character, color, detail, skin, power } }` (unos 110 bytes, lejos del límite de 1024).
2. El coordinator lo valida (`sanitizeExtras`: objeto, tamaño, `color` con formato `#rrggbb`) y lo guarda en `p.extras` (en `ws.on("message")` de [index.js](coordinator/index.js#L242)).
3. Desde ese tick, la apariencia viaja en **cada `state`** dentro de `extras`, y todos dibujan a ese jugador con ese personaje.

- **Es replicado:** el estado vive en el servidor y todos lo reciben en el mismo mensaje.
- **Es persistente durante la sesión:** sigue en `p.extras` hasta que el jugador se desconecta. Además el cliente lo guarda en `localStorage` (`playLook`) y lo reenvía al recibir `welcome`, así que se conserva al recargar.
- **No se confía en los extras de los demás:** el servidor solo valida `color`, así que `resolveLook()` ([characters/look.js](client/public/js/play/characters/look.js#L64)) revisa cada campo que llega en el `state`: el personaje debe ser uno de los tres y los colores deben ser `#rrggbb`. Lo que no sirve se reemplaza por una apariencia **por defecto estable**, derivada del `userId`, así que todos los clientes ven lo mismo aunque alguien no haya elegido nada.
- **Usar el poder (tecla Q o botón "Usar poder"):** el cliente envía los mismos extras con `powerOn: true` y, 700 ms después, sin él. Como `powerOn` viaja en el `state`, **todos** dibujan el efecto: el aura que crece, ondas de radio, esporas, perdigones, corte de espada, chorro de pintura, ráfaga o el salto con la mochila. Es **solo visual**: no cambia posiciones, no daña a nadie y no agrega mensajes al protocolo (hay un uso a la vez, muy por debajo del límite de 60 mensajes/s).
- **Compatible con el Taller 5 original:** `color` sigue siendo el color principal. Un cliente que solo envíe `{ color }` se ve con su color.

**Insignia del provider.** Cada jugador del `state` trae `provider`, que pone el servidor desde el JWT. El cliente dibuja a la derecha del nombre una **"G"** azul sobre blanco para Google o una **"L"** sobre gris para cuentas locales. Como sale del servidor, nadie puede hacerse pasar por usuario de Google enviando extras.

---

## 7. Cliente

- **`login.html`:** pestañas de iniciar sesión y crear cuenta, más el botón de Google ([js/google-login.js](client/public/js/google-login.js)).
  - Si `GOOGLE_CLIENT_ID` está vacío, el botón no aparece.
  - Si el script de Google no carga en 5 s, se muestra "No se pudo cargar el inicio de sesión con Google".
  - Sin One Tap.
  - Las respuestas de `/auth/google` se interpretan con la función pura `interpretGoogleResponse` de [js/google-flow.js](client/public/js/google-flow.js).
  - Tras el login, local o de Google, se va a **`play.html`**.
- **`play.html`** ([js/play/play.js](client/public/js/play/play.js#L79)): el mapa ocupa **toda la pantalla** y lo demás va superpuesto en paneles translúcidos:
  - arriba, una barra con conexión, zona, hora, usuario y "Cerrar sesión";
  - a la derecha, el minimapa y "Jugadores en línea";
  - abajo a la izquierda, el selector compacto "Tu personaje";
  - abajo a la derecha, el zoom.

  Los paneles se pliegan (en pantallas angostas empiezan plegados) y el estado plegado se recuerda en el navegador.
  - **Estado:** `window.lastState` guarda **el último mensaje `state` completo** del servidor. Es la única fuente de verdad: el cliente no calcula posiciones ni choques.
  - **Entrada:** WASD o flechas llenan un `Set` de teclas. `computeIntent` lo convierte en una dirección y se envía **solo cuando cambia**. Al perder el foco o esconder la pestaña se envía `{0, 0}`.
  - **Dibujo:** [js/play/render.js](client/public/js/play/render.js#L111) dibuja con un **suavizado solo visual**: `renderPos` se acerca a la posición del servidor con `1 − e^(−20·dt)` y salta si la diferencia supera 200. Si alguien edita `lastState` en DevTools, la vista lo refleja y el siguiente `state` lo corrige.
  - **Mapa de Virus City** ([js/play/map/](client/public/js/play/map/)):
    - el suelo se pinta en trozos de 16 × 16 casillas cacheados en canvas;
    - edificios, árboles y jugadores se ordenan por profundidad (lo de más abajo tapa a lo de arriba);
    - un árbol o edificio que tapa al jugador local se vuelve translúcido;
    - la cámara sigue al jugador local; el zoom (0,5× a 2×) y el minimapa son solo visuales.
  - **Día y noche:** la hora sale del `t` que manda el servidor en cada `state` ([map/clock.js](client/public/js/play/map/clock.js)), no del reloj del navegador. Todos ven la misma hora y la misma luz (farolas, ventanas y neones de noche); un día de juego dura 15 minutos reales.
  - **Ambiente local:** vecinos, un perro y coches recorren la ciudad. Son **decorado de cada cliente**: no viajan por la red, no chocan con nadie y no cambian ninguna posición de juego.
  - **Animación:** la dirección del personaje y el paso se deducen de cómo cambia su posición dibujada (`nextAnim` en [view.js](client/public/js/play/view.js)); no se envían por la red.
  - **Entradas señalizadas (como la referencia):** en el minimapa, cada puerta a la que se puede entrar es un cuadro amarillo con borde negro; en el mapa, la puerta tiene un cartel "ENTRAR · Burger Neón" (o Supermercado), un resplandor y una flecha en la acera. Dentro de cada local, la salida tiene un cartel "SALIDA" en el vidrio de la puerta.
  - **Locales (Burger Neón y Supermercado):** al entrar por la puerta, el servidor mueve al jugador a la zona de interiores y el cliente dibuja el local con sus muebles, luces, letrero de neón y vecinos. **Solo se ve a quienes están en el mismo escenario**: si alguien está en el Burger Neón, desde la calle no se le dibuja, pero la lista de jugadores dice dónde está. Dentro de un local no hay minimapa.
  - **Conversaciones (tecla E):** cerca de un vecino o de un cartel aparece "E Hablar / Mirar". Los diálogos son los de la referencia (vecinos de la ciudad, cajeros, cocinero, clientes, carteles, la rocola). Son **locales**: no viajan por la red. Mientras se conversa el jugador no camina (envía la intención `{0, 0}`) y el vecino se detiene a mirarlo. E avanza y Escape cierra.
  - **Efectos de sonido** (Web Audio, sintetizados, sin archivos): pasos distintos sobre hierba o piedra, puertas, campana al entrar a un local, el blip de los diálogos, la rocola del Burger Neón y un sonido por poder. Los poderes de los demás se oyen si están en el mismo escenario y más bajo cuanto más lejos.
  - **Radio Virus 86.6 FM:** tres canciones synthwave de los 80 generadas en el navegador ("Neón en cuarentena", "Avenida Central 1986", "Esporas en la niebla"), con estática y sintonía entre canciones. **Todos escuchan lo mismo**: la canción y el compás se calculan con la hora del servidor (el `t` del `state`, estimando el desfase con el reloj local con la muestra de menor latencia), así que no se transmite audio. Los botones **Radio** y **Efectos** silencian cada cosa y el navegador lo recuerda. El navegador solo deja sonar audio después del primer clic o tecla.
  - **Si el mundo del servidor no mide 3840 × 3840** (coordinator sin `MAP_FILE`), se dibuja la cuadrícula simple de antes, con los mismos personajes.
  - **Lista de jugadores:** para cada uno muestra un retrato de su personaje, el nombre ("(tú)" para el local), la zona de la ciudad donde está (Plaza Mayor, Avenida Central…) y su insignia. Se reconstruye solo cuando cambia algo visible.
  - **Aviso:** "Conexión inestable…" si pasan más de 3 s sin `state`.
- **Cierres:**
  - `4001` → "Tu sesión expiró o el token no es válido…";
  - `4002` → "Tu sesión se abrió en otra pestaña…";
  - cualquier otro → "Se perdió la conexión con el coordinador…".

  El mensaje se guarda en `sessionStorage` y se vuelve al login, sin reconexión automática.
- **Vigilancia del token:** si el token guardado cambia o se borra con la sesión abierta, la sesión se cae. Al cerrar, solo se borra el token si sigue siendo el de esa pestaña, y nunca con 4002, porque ese token ya es de la sesión nueva.
- **"Cerrar sesión":** borra `token` y `username`, cierra con `1000 "logout"` y vuelve al login.
- **`lobby.html`:** es **legado del Taller 4**. Sigue funcionando, pero ya nada enlaza a él.

---

## 8. Variables de entorno

Cada servicio tiene su `.env` (ignorado por git) y su `.env.example` (versionado, sin secretos reales).

**auth-service/.env**

| Variable | Función | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP (por defecto 4000) | `4000` |
| `JWT_SECRET` | Clave HS256 para firmar los JWT. Obligatoria, ≥ 32 caracteres, **idéntica** a la del coordinator | 64 caracteres hex |
| `JWT_EXPIRES_IN` | Vigencia del token (`1h`, `30s`…; solo dígitos = segundos). Por defecto `1h` | `1h` |
| `BCRYPT_ROUNDS` | Costo de bcryptjs, entre 10 y 31 (por defecto 10) | `10` |
| `DB_PATH` | Archivo SQLite, relativo a la carpeta del servicio (por defecto `./users.db`) | `./users.db` |
| `GOOGLE_CLIENT_ID` | Client ID de Google (obligatorio; debe terminar en `.apps.googleusercontent.com`; si contiene `localtest` se avisa que es de prueba) | `1234…-abc.apps.googleusercontent.com` |

**coordinator/.env**

| Variable | Función | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP + WebSocket (obligatorio desde el Taller 6; ver Parte III §7 para el resto de variables del clúster) | `5001` |
| `JWT_SECRET` | La misma clave del auth-service (≥ 32 caracteres) | igual que en auth |
| `HEARTBEAT_INTERVAL_MS` | Cada cuánto se hace ping a los sockets | `30000` |
| `WORLD_WIDTH` / `WORLD_HEIGHT` | Tamaño del mundo en unidades (por defecto 1200 × 800). Con `MAP_FILE` sale del mapa: si se definen, deben valer 3840 / 3840 o el coordinator no arranca | `3840` / `3840` |
| `MAP_FILE` | Mapa con casillas sólidas, relativo a la carpeta del coordinator. Vacío = mundo sin obstáculos | `./map/virus-city.json` |
| `PLAYER_RADIUS` | Mitad del lado de la caja del jugador (2·radio < lado menor del mundo; con mapa, menor que 24) | `16` |
| `PLAYER_SPEED` | Velocidad en unidades por segundo | `200` |
| `TICK_RATE` | Ticks por segundo del game loop (1–120) | `20` |
| `MAX_EXTRAS_BYTES` | Tamaño máximo de `extras` serializado | `1024` |
| `MAX_MSGS_PER_SEC` | Mensajes por segundo y por socket antes de descartar | `60` |
| `AUTH_URL` | URL del auth (directorio en el Taller 6; también la usa `npm run smoke`) | `http://localhost:4000` |
| `COORDINATOR_WS_URL` | *(opcional, solo como variable de entorno de `npm run smoke`; por defecto `ws://localhost:5001`)* | `ws://localhost:5001` |

**client/.env**

| Variable | Función | Local | Con ngrok |
|---|---|---|---|
| `PORT` | Puerto del client (obligatorio) | `3000` | `3000` |
| `AUTH_URL` | URL del auth-service, sin barra final | `http://localhost:4000` | `https://<túnel-4000>` |
| `COORDINATOR_WS_URL` | Taller 5: URL del coordinator. **Desde el Taller 6 es opcional y no se usa** (Parte III §6) | vacía | vacía |
| `GOOGLE_CLIENT_ID` | El mismo Client ID del auth-service (opcional: vacío = sin botón de Google) | `1234…-abc.apps.googleusercontent.com` | igual |

---

## 9. Cómo correr todo en local

**Requisitos:**
- **Node.js ≥ 22.13** (por `node:sqlite` sin flag; se probó con Node 24) y npm.
- git.
- Opcional: ngrok con cuenta.

Los comandos están escritos para Git Bash.

1. **Instala las dependencias** de cada servicio:
   ```bash
   cd auth-service && npm install && cd ..
   cd coordinator && npm install && cd ..
   cd client && npm install && cd ..
   ```
2. **Crea los `.env`** a partir de los ejemplos:
   ```bash
   cp auth-service/.env.example auth-service/.env
   cp coordinator/.env.example coordinator/.env
   cp client/.env.example client/.env
   ```
3. **Genera un secreto** y pon **el mismo valor** en `JWT_SECRET` de `auth-service/.env` y de `coordinator/.env` (desde el Taller 6 también hace falta `CLUSTER_SECRET`; ver Parte III §8):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Pon el Client ID de Google** (sección 10) en `GOOGLE_CLIENT_ID` de `auth-service/.env` y de `client/.env`. Para probar sin Google, en el auth basta un valor con el formato correcto, como `000000000000-localtest.apps.googleusercontent.com`.
5. **Arranca cada servicio** en su propia terminal, en este orden:
   ```bash
   cd auth-service && npm start    # Auth service en puerto 4000
   cd coordinator && npm start     # Coordinator coord-a en puerto 5001 (…) · game loop a 20 Hz
   cd client && npm start          # Client en puerto 3000
   ```
6. **Abre** <http://localhost:3000> en dos navegadores distintos (o uno en incógnito), entra con dos usuarios y muévete con WASD o las flechas.

**Pruebas**

| Comando | Qué prueba |
|---|---|
| `cd auth-service && npm test` | 20 pruebas: registro, login, Google con verificador falso, migración del Taller 4 y que los logs no filtren datos (el resumen dice 21 porque `node --test` también cuenta `test/helpers.js` como un archivo) |
| `cd coordinator && npm test` | 19 pruebas de la lógica pura del juego: movimiento, saneo, mapa, choques y portales (incluido un paseo al azar por el mapa real que nunca pisa una casilla sólida) |
| `cd client && npm test` | 63 pruebas: flujo de Google, intención, colores, personajes y poderes, cámara, reloj, zonas, interiores y portales, conversaciones, programa de la radio, que el mapa del servidor coincida con el del cliente y la interfaz de Viruscity |
| `cd coordinator && npm run smoke` | Con auth y coordinator levantados: S1–S11 (Taller 4) y G1–G14 (juego en vivo). Con mapa, G5–G7 eligen direcciones libres y G10 comprueba que el jugador se detiene contra la pared donde lo calcula el servidor. G13 y G14: reconectarse u otra pestaña no cambian la posición |
| `cd client && npm run map` | Regenera `coordinator/map/virus-city.json` si se cambia el trazado de la ciudad (`public/js/play/map/layout.js`) |

---

## 10. Google Cloud

1. **Crea un proyecto** en <https://console.cloud.google.com>.
2. **Configura la pantalla de consentimiento de OAuth** (en la consola nueva: *Google Auth Platform*):
   - tipo de usuario **External**;
   - nombre de la app y correo de soporte;
   - scopes **`openid`**, **`email`** y **`profile`**;
   - en **Usuarios de prueba** (*Audience → Test users*) agrega las cuentas de Gmail que usarás mientras la app esté en modo prueba.
3. **Crea el cliente OAuth:** *Credenciales → Crear credenciales → ID de cliente de OAuth*, de tipo **Aplicación web**.
   - **Orígenes de JavaScript autorizados:** `http://localhost`, `http://localhost:3000` y la URL **https** del túnel ngrok del client (por ejemplo `https://<túnel-3000>`).
   - **URI de redireccionamiento autorizados:** ninguno. La Opción A no los usa.
4. **Copia el Client ID** (termina en `.apps.googleusercontent.com`) y ponlo, **con el mismo valor**, en `GOOGLE_CLIENT_ID` de `auth-service/.env` y de `client/.env`. Reinicia los dos servicios. El Client Secret no se usa ni se guarda.
5. **Cuando cambie la URL de ngrok** del client: agrega el nuevo origen https en el cliente OAuth y espera unos minutos a que Google aplique el cambio. Si el botón falla con un error de origen, revisa este paso.
6. **Para agregar más personas** mientras la app está en modo prueba: añade su correo en *Usuarios de prueba*. Las demás cuentas verán un aviso de acceso bloqueado.

---

## 11. ngrok

**Desde el Taller 6 los túneles se abren con `ngrok.example.yml` como explica la Parte III §9** (client, auth y los tres coordinadores). En el Taller 5 había un solo coordinador y `COORDINATOR_WS_URL` en `client/.env`; ahora cada coordinador publica su `PUBLIC_URL=wss://…` en su `.env.coord-x` y el client solo necesita `AUTH_URL=https://<túnel del auth>`. Reinicia el client después de cambiarlo (`/config.js` se genera al arrancar) y agrega el origen `https://<túnel del client>` en Google Cloud (sección 10).

- **`wss://` y no `ws://`:** la página llega por HTTPS y los navegadores bloquean un WebSocket sin cifrar desde una página segura (*contenido mixto*).
- **Página de aviso de ngrok:** en el plan gratuito, la primera visita muestra un aviso; pulsa **"Visit Site"**. Los `fetch` del cliente envían `ngrok-skip-browser-warning: true` para que el aviso no reemplace las respuestas JSON.
- **El auth acepta cualquier origen** (CORS abierto, sin cookies) y el coordinator, cualquier conexión con un token válido.

---

## 12. Decisiones de diseño

- **Tabla única:** un solo `userId` por persona y usernames únicos entre providers (sección 2).
- **Opción A de Google:** sin secreto ni redirect URI. El servidor solo verifica un JWT firmado por Google contra los certificados públicos (sección 3).
- **401 genérico en `/login` para usuarios de Google:** se responde exactamente igual que con una contraseña incorrecta, y además se ejecuta un `bcrypt.compare` contra un hash ficticio para igualar tiempos. Así no se puede averiguar qué usernames existen ni de qué provider son (sin enumeración de usuarios).
- **Validación de `extras`, regla por regla:**
  - objeto, no null ni array;
  - ≤ 1024 bytes serializado;
  - `color` con formato `#rrggbb` (si no, se ignora todo el mensaje) y guardado en minúsculas;
  - se guarda una copia y reemplaza al anterior.
- **Límites anti-abuso:**
  - `maxPayload` de 2048 bytes;
  - 60 mensajes/s por socket;
  - `intent` reducido a −1/0/1;
  - body del auth de 4 kB;
  - idToken de hasta 4096 caracteres.
- **Choques en el servidor, con el mismo mapa que dibuja el cliente:** si el cliente decidiera los choques, un cliente modificado podría atravesar edificios. El trazado se escribe una sola vez (`layout.js`, puro y determinista); el cliente lo dibuja y `npm run map` exporta su grilla para el coordinator. Una prueba impide que se desincronicen. No se agregó ningún mensaje al protocolo: el mapa es un dato de configuración del servidor (`MAP_FILE`).
- **Interiores como zona del mismo mundo, con portales en el servidor:** entrar a un local cambia la posición, y la posición es del servidor. En vez de agregar un campo `scene` al protocolo, los locales viven debajo de la ciudad y las puertas son portales de la grilla. El cliente deduce el escenario por las coordenadas y solo dibuja a los del mismo escenario.
- **Radio sincronizada sin enviar audio:** la música es una partitura determinista que cada navegador sintetiza. La hora del servidor decide qué suena, así que todos oyen lo mismo sin gastar ancho de banda.
- **Ambiente local fuera de la red:** vecinos, perro y coches son decorado de cada cliente. No chocan ni empujan, porque cualquier cosa que cambie posiciones de juego tendría que vivir en el servidor. Por la misma razón se dejaron fuera los interiores y los diálogos de la referencia.
- **Hora del juego desde el servidor:** el reloj de día y noche usa el `t` del `state`, no `Date.now()` del navegador, así que todos ven la misma luz aunque sus relojes difieran.
- **Apariencia en `extras` validada en los dos lados:** el servidor limita tamaño y formato de `color` y el cliente revisa el resto (`resolveLook`). Un extra raro de otro jugador nunca rompe el dibujo.
- **`state` sin `socket` ni `intent`:** `snapshot()` publica solo `userId`, `username`, `provider`, `x`, `y` (redondeadas a 2 decimales) y `extras`. La intención de los demás no se revela y el objeto interno nunca sale del servidor.
- **bcryptjs y `node:sqlite`:** sin dependencias nativas, así que la instalación no compila nada y no hace falta Visual Studio en Windows. El costo es que hace falta Node ≥ 22.13 (o 22.5 con `--experimental-sqlite`).
- **Username de 3–32 caracteres (`^[a-zA-Z0-9_]+$`):** se guarda y se muestra con las mayúsculas con que se registró. La **unicidad y el login no distinguen mayúsculas** ("Oscar" = "oscar"), un cambio pedido durante el desarrollo para evitar cuentas casi idénticas.
- **JWT con `provider`:** el coordinator sabe el origen de la cuenta sin consultar la base, y lo publica en el `state`.
- **No se registran tokens, idTokens, emails ni contraseñas:**
  - los logs HTTP solo tienen fecha, método, ruta sin query y status;
  - los errores de Google y los 500 registran textos fijos;
  - las pruebas automáticas lo verifican (L1 del auth).

---

## 13. Errores típicos y dónde se evitan

> Lista reconstruida a partir de las decisiones fijas del Taller 5 (CLAUDE.md); compárala con la del enunciado.

| # | Error típico | Dónde se evita |
|---|---|---|
| 1 | El cliente calcula o envía su posición | [client/public/js/play/play.js](client/public/js/play/play.js#L189) `pushIntent()` solo envía la dirección; el coordinator ignora cualquier otro tipo de mensaje |
| 2 | Mover jugadores o hacer broadcast en el handler de mensajes | [coordinator/index.js](coordinator/index.js#L242) `ws.on("message")` solo guarda `p.intent` / `p.extras`; mover y difundir es cosa de `tick()` |
| 3 | Velocidad que depende del tick rate (sin `dt`) | `tick()` usa `clampDt(now − lastTick)` y [game.js](coordinator/game.js#L187) `stepPlayers(players, dt, cfg, map)` |
| 4 | La diagonal es más rápida | `stepPlayers()`: dirección dividida por `Math.hypot(x, y)` |
| 5 | Confiar en el intent (NaN, Infinity, 9999, strings) | [game.js](coordinator/game.js#L125) `sanitizeIntent()`: `Number.isFinite` + `Math.sign` |
| 6 | Extras sin límites (tamaño, tipo, color arbitrario, flood) | [game.js](coordinator/game.js#L135) `sanitizeExtras()`, `maxPayload: 2048` y `MAX_MSGS_PER_SEC` en `index.js` |
| 7 | El jugador sale del mundo (o atraviesa edificios) | `stepPlayers()`: límites `[R, W − R]` y `[R, H − R]`; con mapa, [game.js](coordinator/game.js#L159) `moveAxis()` lo frena contra las casillas sólidas |
| 8 | Usar el email como llave de la cuenta de Google | [auth-service/app.js](auth-service/app.js#L139) `/auth/google`: `findByGoogle(sub)`; `google_sub` es `UNIQUE` |
| 9 | No verificar `audience` ni `email_verified` | [auth-service/google.js](auth-service/google.js#L14) (`verifyIdToken` con `audience` + comparación de `aud`) y `app.js` (`email_verified !== true` → 401) |
| 10 | Dos tablas o username duplicado entre providers | [auth-service/db.js](auth-service/db.js#L14) tabla única + índice `users_username_nocase`; `findByUsername` en `/register` y `/auth/google` |
| 11 | Registrar tokens, idTokens, emails o `err.message` de Google | `app.js`: log de peticiones sin body ni query y textos fijos en los errores; prueba L1 en `auth-service/test/auth.test.js` |

---

## 14. Guía de sustentación

Antes de empezar: los tres servicios corriendo (local o con ngrok), `GOOGLE_CLIENT_ID` real configurado y dos navegadores distintos (o uno en incógnito) en el client.

**(a) Juego con dos pestañas y el extra de personaje · 3 min**
1. Entra con un usuario en cada navegador: los dos aparecen en el mapa y en "Jugadores en línea (2)".
2. Muévete con WASD en uno: el otro ve el movimiento en vivo. Muévete en diagonal y explica que va a la misma velocidad. Camina contra un edificio o el estanque: el servidor te frena, y en diagonal te deslizas por la pared.
3. En "Tu personaje" cambia de personaje, color, pelo o gorra y piel: el otro lo ve al instante en el mapa y en la lista. Recarga: la apariencia se mantiene.
4. En la pestaña Poder elige uno y pulsa **Q**: el efecto se ve en las dos pestañas, porque viaja en los extras del `state`. Explica que es solo visual.
5. Señala el reloj del HUD: las dos pestañas muestran la misma hora, porque sale del `t` del servidor.
6. Entra al Burger Neón por su puerta (Zona Comercial, frente a la Avenida Central): el otro jugador deja de verte en el mapa, pero la lista dice "Burger Neón". Habla con un vecino con **E** y prueba la rocola.
7. Muestra la radio: las dos pestañas dicen la misma canción. Silencia la radio o los efectos con sus botones.

**(b) Los dos providers · 3 min**
1. Registra `alice` con contraseña y entra.
2. En el otro navegador entra con Google: en el primer ingreso aparece "Elige tu username"; escribe `bob_google`. Los dos se ven, y la insignia muestra **L** para alice y **G** para bob_google.
3. Muestra que alice no puede usar Google para su cuenta: si en el primer ingreso con Google se elige `alice` (o `ALICE`), la respuesta es `409 username_taken`.
4. Muestra que bob_google no puede usar `/login`: da el mismo 401 que una contraseña incorrecta.
   ```bash
   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"bob_google","password":"cualquiera"}'
   # {"error":"Credenciales inválidas"}  HTTP 401
   curl -s -w "  HTTP %{http_code}\n" -X POST http://localhost:4000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"incorrecta"}'
   # {"error":"Credenciales inválidas"}  HTTP 401
   ```

**(c) El servidor es la autoridad · 2 min**
En la consola de DevTools de una pestaña ejecuta:

```js
const yo = lastState.players.find(p => p.username === localStorage.getItem('username'));
setInterval(() => { const j = lastState.players.find(p => p.username === localStorage.getItem('username')); if (j) { j.x = 100; j.y = 100; } }, 5);
```

Esa pestaña te dibuja en (100, 100), en el bosque de la esquina (la cámara te sigue hasta allí), porque edita su copia local de `lastState`. **En la otra pestaña no pasa nada**: el servidor sigue con tu posición real. Al recargar (o al detener el intervalo), el siguiente `state` del servidor corrige la vista.

**(c2) Intentar hacer trampa desde el navegador (opcional, 3–4 min)**

Abre dos navegadores: A es el tramposo y B el observador. En A abre DevTools (F12) → **Consola**. Si Chrome o Edge piden escribir `allow pasting`, escríbelo antes de pegar. Lo que el servidor decide se ve en la pantalla de B, y también en su consola con:

```js
setInterval(() => console.log(lastState.players.map(p => `${p.username} ${p.provider} (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(" | ")), 1000);
```

**1. Tomar el WebSocket de la página.** Es lo que haría un tramposo para mandarle al servidor lo que quiera. Después de pegar esto, pulsa una flecha un instante para que la página envíe algo y quede capturado:

```js
const _send = WebSocket.prototype.send;
WebSocket.prototype.send = function (d) { window.ws = this; return _send.call(this, d); };
const enviar = (m) => ws.send(JSON.stringify(m));
```

**2. Posición.** Mensajes inventados y coordenadas metidas en el intent o en los extras: **no pasa nada**. El servidor solo entiende `intent` (una dirección) y `extras_update`, y la posición la calcula él.

```js
enviar({ type: "teleport", x: 100, y: 100 });
enviar({ type: "move", x: 100, y: 100 });
enviar({ type: "state", players: [{ username: localStorage.username, x: 100, y: 100 }] });
enviar({ type: "intent", intent: { dir: { x: 0, y: 0 } }, x: 100, y: 100 });
```

Editar `lastState` (el snippet de la demo (c)) solo cambia el dibujo en la pantalla del tramposo. Recargar la página (F5) tampoco sirve: el servidor recuerda la posición y aparece en el mismo lugar.

**3. Velocidad.** Una dirección enorme, una ráfaga de mensajes o pedir más velocidad en los extras: siempre va a 200 px/s.

```js
enviar({ type: "extras_update", extras: { speed: 5000 } });
enviar({ type: "intent", intent: { dir: { x: 9999, y: 0 } } });       // se reduce a 1 con Math.sign
for (let i = 0; i < 1000; i++) enviar({ type: "intent", intent: { dir: { x: 1, y: 0 } } }); // más de 60/s se descartan
setTimeout(() => enviar({ type: "intent", intent: { dir: { x: 0, y: 0 } } }), 1000);
```

Explica por qué: el servidor mueve una vez por tick con `PLAYER_SPEED · dt` y la dirección normalizada; el número de mensajes no importa.

**4. Tamaño.** Pedir una caja diminuta para colarse por las paredes, o un personaje gigante:

```js
enviar({ type: "extras_update", extras: { radius: 1, size: 20, scale: 10 } });
```

Camina contra un edificio: se detiene en el mismo punto de siempre, porque la caja de choque es `PLAYER_RADIUS` del servidor. En la pantalla de B se ve del tamaño normal, porque el cliente solo acepta personaje, colores y poder (`resolveLook`).

**5. Identidad.** Fingir ser de Google o cambiar el nombre:

```js
enviar({ type: "extras_update", extras: { provider: "google", username: "admin" } }); // la insignia sigue en L

// Token falsificado: se cambia el contenido del JWT sin conocer el secreto
const [h, p, s] = localStorage.token.split(".");
const datos = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
datos.username = "admin"; datos.provider = "google";
const falso = h + "." + btoa(JSON.stringify(datos)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + "." + s;
const w = new WebSocket(ws.url.split("/connect")[0] + "/connect?token=" + encodeURIComponent(falso)); // mismo coordinador que la pestaña
w.onclose = (e) => console.log("cerrado", e.code, e.reason); // 4001 invalid token: la firma no coincide
```

**6. Abuso (déjalo para el final: saca al tramposo de la partida).**

```js
enviar({ type: "extras_update", extras: { pad: "x".repeat(1500) } }); // > 1024 bytes de extras: se ignora
enviar({ type: "extras_update", extras: { pad: "x".repeat(5000) } }); // > 2048 bytes: el servidor cierra el socket (1009)
```

**Lo que un tramposo SÍ puede hacer** (y conviene decirlo):
- Todo lo que es solo de su pantalla: dibujarse en otro lugar, cambiar el zoom, ver los vecinos y coches decorativos, los diálogos y los sonidos.
- Leer `lastState` completo: ahí están las posiciones de **todos**, incluidos los que están dentro de un local, que la interfaz oculta. El protocolo del taller manda el estado completo a todos. Para ocultarlo de verdad, el servidor tendría que filtrar el `state` de cada jugador según el escenario (gestión de interés).

Probado con dos jugadores en Edge: los 12 intentos quedaron bloqueados, medidos con la posición que el servidor le manda al otro jugador.

**(d) Tour del código · 4 min**

| Punto | Archivo y función |
|---|---|
| Game loop | [coordinator/index.js](coordinator/index.js#L295) `tick()` (y `scheduleTick()`); movimiento en [game.js](coordinator/game.js#L187) `stepPlayers()` |
| Choques con el mapa | [coordinator/game.js](coordinator/game.js#L159) `moveAxis()` y `boxBlocked()`; el mapa se carga con `parseMap()` desde `MAP_FILE` |
| Validación de inputs | [coordinator/game.js](coordinator/game.js#L125) `sanitizeIntent()` y `sanitizeExtras()`; en el cliente, `resolveLook()` para los extras de los demás |
| Verificación del ID token | [auth-service/google.js](auth-service/google.js#L14) `makeGoogleVerifier()` y [auth-service/app.js](auth-service/app.js#L139) `POST /auth/google` |
| Dónde se guardan los extras | [coordinator/index.js](coordinator/index.js#L242) `ws.on("message")` → `p.extras`; salen en `snapshot()` dentro de cada `state` |

**(e) Preguntas probables**
1. **¿Por qué el cliente no mueve al jugador?**
   Porque el servidor es la autoridad: si el cliente decidiera su posición, podría hacer trampa (teletransportarse, ir más rápido). El cliente solo manda intenciones y dibuja lo que dice el servidor.
2. **¿Por qué usar `dt`?**
   Los ticks no duran exactamente 50 ms. Multiplicar por el tiempo real hace que la velocidad sea siempre 200 px/s, sin importar el tick rate ni los retrasos.
3. **¿Por qué normalizar la dirección?**
   Sin normalizar, `(1, 1)` mide √2 ≈ 1,41 y la diagonal sería un 41 % más rápida. Con `Math.hypot` todas las direcciones avanzan igual.
4. **¿Por qué `sub` y no el email?**
   `sub` es el identificador estable y único de la cuenta de Google. El email puede cambiar o reasignarse, y usarlo como llave permitiría apropiarse de cuentas.
5. **¿Qué pasa si no se verifica el `audience`?**
   Se aceptaría un ID token emitido para *otra* aplicación: cualquiera con un token de otro sitio que use Google podría entrar como esa persona.
6. **¿Por qué una sola tabla?**
   Para que un username sea único entre providers y cada persona tenga un solo `userId` para el coordinador, los puntajes o la replicación.
7. **¿Por qué el broadcast va en el tick y no en cada mensaje?**
   Así se envía un mensaje por tick con el estado completo y consistente. Si se difundiera por mensaje, el tráfico dependería de cuántas teclas pulsa cada uno y el estado llegaría a medias.
8. **¿Qué pasa si alguien manda extras de 10 MB?**
   El servidor ni siquiera lo lee: un mensaje de más de 2048 bytes (`maxPayload`) cierra ese socket. Uno de menos de 2048 pero con extras de más de 1024 bytes se ignora, y más de 60 mensajes por segundo se descartan.
9. **¿Por qué los choques con los edificios los calcula el servidor y no el cliente?**
   Por la misma razón que la posición: si el cliente decidiera los choques, uno modificado podría atravesar paredes. El servidor tiene la grilla del mapa (`MAP_FILE`), generada desde el mismo trazado que dibuja el cliente, y una prueba verifica que coinciden.
10. **¿Cómo escuchan todos la misma radio si no se envía audio?**
   La música es una partitura fija que cada navegador sintetiza. Qué canción y qué compás suenan se calcula con la hora del servidor (el `t` de cada `state`), igual que el reloj del día.

---

# Estructura del repositorio

```
.
├── .gitignore · CLAUDE.md · README.md · ngrok.example.yml
├── auth-service/
│   ├── .env.example · .env.auth-a/b/c.example · .npmrc · package.json · package-lock.json
│   ├── index.js        # arranque: configuración, base, nodo de replicación + mesh, cierre ordenado
│   ├── config.js       # configuración (también multi-nodo con AUTH_NODES y --env)
│   ├── app.js          # createApp(): /health, /register, /login, /auth/google, /status, /peers y el directorio (/heartbeat, /coordinator, /coordinator-peers, /directory)
│   ├── oplog.js        # oplog, meta y utilidades de almacenamiento replicable (Taller 7)
│   ├── replication/    # election.js (núcleo puro), node.js (nodo), mesh.js + mesh-messages.js (WebSocket), standalone.js, mutex.js
│   ├── scripts/auth-cluster-smoke.js   # npm run smoke:auth-cluster (A1-A13)
│   ├── directory.js    # directorio de coordinadores: TTL, reservas, selección (Taller 6)
│   ├── db.js           # esquema de la tabla única, migración desde el Taller 4, consultas
│   ├── google.js       # makeGoogleVerifier(): verifica el ID token con audience
│   └── test/           # node:test (auth, Google, migración, configuración, oplog, elección con simulador, replicación, mesh)
├── coordinator/
│   ├── .env.example · .env.coord-a.example · .env.coord-b.example · .env.coord-c.example
│   ├── package.json · package-lock.json
│   ├── index.js        # upgrade con JWT, sesiones, mensajes, game loop, heartbeat, /status
│   ├── config.js       # configuración por instancia (--env <archivo>)
│   ├── directory-client.js  # heartbeat a todos los auth (AUTH_URLS) y GET /coordinator-peers
│   ├── mesh.js         # lógica pura del mesh (propiedad, conflictos, resync)
│   ├── peers.js        # red del mesh: servidor de peers, conexiones salientes, ping, positions_sync
│   ├── game.js         # lógica pura: config, mapa y choques, spawn, sanitizeIntent/Extras, stepPlayers, snapshot
│   ├── city.js · missions.js · match.js · arbiter.js   # Viruscity: ciudad, misiones, reducer de la partida y árbitro
│   ├── map/virus-city.json     # grilla de casillas sólidas y de aparición (npm run map en client/)
│   ├── test/           # node:test de game.js, config, directory-client, mesh y la partida (ciudad, misiones, reducer, árbitro)
│   └── scripts/smoke-test.js · cluster-smoke.js · full-smoke.js · viruscity-smoke.js   # npm run smoke · smoke:cluster (C1-C13) · smoke:full (F1-F8) · smoke:viruscity
└── client/
    ├── .env.example · package.json · package-lock.json
    ├── server.js       # Express estático + /config.js (AUTH_URLS, AUTH_URL, COORDINATOR_WS_URL opcional, GOOGLE_CLIENT_ID)
    ├── scripts/export-map.mjs  # exporta la grilla del mapa para el coordinator (npm run map)
    ├── public/
    │   ├── login.html · play.html · cluster.html · lobby.html (legado) · game.html (vista previa de diseño)
    │   ├── css/        # tokens, base, components, login, google-login, play, lobby, game, vc (partida de Viruscity)
    │   ├── img/        # logo.svg, favicon.svg
    │   └── js/
    │       ├── auth-fetch.js · auth-node.js   # window.authFetch con failover e indicador "Auth: …" (Taller 7)
    │       ├── auth/failover.js                # lógica pura del failover entre auth-services
    │       ├── login.js · login-ui.js · google-login.js · google-flow.js
    │       ├── lobby.js · game-shell.js
    │       ├── cluster.js      # tabla del directorio (cluster.html)
│       ├── play/   # play.js, directory.js, render.js, view.js, intent.js, colors.js, look-panel.js, players-panel.js
    │       │   ├── map/        # ciudad: layout (puro), props, edificios, suelo, vecinos y coches, reloj, zonas
    │       │   └── characters/ # Heroína, Explorador, Mensajero y look.js (apariencia validada)
    │       ├── vc/     # partida de Viruscity: view, clock, actions, city-render, hud, mission y minigames/
    │       └── ui/     # módulos de la interfaz de Viruscity (vista previa de diseño)
    └── test/           # node:test (Google, juego, personajes, mapa, interfaz)
```

Y `gateway/` (Taller 7): `index.js` (proxy HTTP y WebSocket), `match.js` (enrutamiento puro), `.env.example` y `test/`.

Solo existen en tu equipo (ignorados por git): `*/.env`, `auth-service/.env.auth-*`, `auth-service/users-*.db`, `coordinator/.env.coord-a`/`-b`/`-c`, `ngrok.yml`, `*/node_modules/`, `auth-service/users.db` y sus copias `*.bak`.

---

# Interfaz de Viruscity

La capa visual del cliente: login, sala de espera y una pantalla de juego de diseño (`game.html`). Es HTML, CSS y JS plano con módulos ES, sin CDN, fuentes web ni imágenes remotas. La única dependencia externa es el script de Google en `login.html` (Taller 5).

### Dirección de arte y tokens

**Ciudad de noche con neón biológico.** Los títulos van en fuente monoespaciada, en mayúsculas y con espaciado amplio; el cuerpo, en la fuente del sistema. Los bordes son de 1 px, las esquinas redondeadas y las sombras suaves. El brillo cian se reserva para el foco y los elementos principales.

`client/public/css/tokens.css` es la **única fuente** de colores, espacios, radios, sombras, tipografía y tiempos de animación. Los demás CSS usan `var(--…)`, y el canvas lee los mismos tokens con `getComputedStyle`.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#0b1020` | Fondo de la página y del mapa |
| `--bg-elev` | `#101733` | Superficies elevadas (barra superior, pestañas) |
| `--panel` | `#121a33` | Tarjetas y paneles |
| `--panel-2` | `#18223f` | Campos, filas de jugador, edificios |
| `--border` | `#2a3560` | Bordes de 1 px |
| `--text` | `#e6e9f5` | Texto principal y anillo del jugador local |
| `--muted` | `#8f9bc4` | Etiquetas, ayudas y texto secundario |
| `--accent` | `#4dd2ff` | **Cian**: acciones, foco, estado sano, mensajes correctos |
| `--accent-ink` | `#06121c` | Texto sobre colores llenos (botones, chips) |
| `--infected` | `#7cff6b` | **Verde**: infectado (solo el estado propio) |
| `--danger` | `#ff4d6d` | **Rojo**: errores y peligro |
| `--cure` | `#ffd166` | **Dorado**: cura, progreso y tareas hechas |

El resto de tokens:
- **Espacios:** de `--space-1` (4 px) a `--space-7` (48 px).
- **Radios:** `--radius-s`, `--radius-m` y `--radius-l`.
- **Sombras:** `--shadow-1` y `--shadow-glow`.
- **Tipografía:** `--font-ui`, `--font-mono` y los tamaños de `--fs-s` a `--fs-hero`.
- **Movimiento:** `--ease`, `--t-fast` y `--t-med`.

### Contrato de datos de la interfaz

Los módulos de `js/ui/` **no conocen el WebSocket**: solo reciben datos planos por parámetros.

```js
scene = {
  world: { width, height },
  playerRadius: number,
  me: { userId } | null,
  status: "healthy" | "infected" | null,   // SOLO el estado del jugador local
  players: [{ userId, username, x, y, color?, badge? }],
}
```

| Módulo | Funciones |
|---|---|
| `scene-renderer.js` | `createSceneRenderer(canvas)` → `{ resize(), draw(scene, nowMs) }` · `computeCamera(me, viewW, viewH, world)` |
| `hud.js` | `createHud(root)` → `setMe`, `setCure`, `setPlayerCount`, `setTasks`, `setHint`, `setInfectCooldown`, `setConnection`, `showRoleIntro`, `toast` |
| `end-overlay.js` | `showEndOverlay(root, { winner, reason, players, youWon }, { onBack })` → `{ close() }` |
| `lobby-view.js` | `createLobbyView(root)` → `setUser`, `setStatus`, `setPlayers`, `showNotice` |
| `toast.js` / `modal.js` | `createToaster(contenedor).show(texto, { kind })` · `createModal().open({ title, content, onClose, dismissible })` |

### Vista previa (solo diseño)

Mientras `UI.PREVIEW_ENABLED` sea `true` en `js/ui/ui-config.js`, estas URLs muestran datos de ejemplo sin red ni token:

| URL | Qué muestra |
|---|---|
| `/lobby.html?preview=1` | Jugadores que entran uno a uno, barra hacia 4, una salida y un reingreso |
| `/game.html?preview=1` | Ciudad con 6 edificios, 6 jugadores, HUD completo y panel de controles (tecla **H**) |
| `/game.html?preview=infected` | El jugador local infectado |
| `/game.html?preview=end` | La pantalla de fin de partida |

### Accesibilidad

- **Contraste AA** de los tokens, comprobado con `client/test/contrast.test.mjs`.
- **Foco visible** en todo elemento interactivo.
- **Formularios:** cada campo tiene su `<label>`.
- **Botones:** los de solo icono llevan `aria-label` y todos miden al menos 44 px.
- **Avisos:** `aria-live` en los avisos.
- **Diálogos:** usan `role="dialog"` y devuelven el foco al cerrar.
- **`prefers-reduced-motion`:** respetado en partículas, virus animado y entradas.
- **Texto dinámico:** siempre con `textContent` o `fillText`.
- **Pantallas pequeñas:** funciona desde 360 px.
- **Limitación conocida:** algunas iniciales de avatar en tonos azules y violetas tienen poco contraste (el avatar es decorativo).

### Virus animado del login

El hero del login muestra el logo como un virus "blando" que rebota, basado en `virus_city_loading_screen.html`:
- **Movimiento:** se aplasta y se estira, sus antenas oscilan y suelta esporas.
- **Salto:** con clic, toque, Enter o Espacio da un salto potente.
- **Movimiento reducido:** queda quieto.

### Integración pendiente

- **`game.html` sigue siendo una vista previa de diseño** (ciudad abstracta con HUD de tareas y cura). La partida real de Viruscity vive en `play.html` con su propio HUD (`js/vc/`, ver la sección [Viruscity](#viruscity)), alimentado por los mensajes `game` y `event` del servidor.
- **Antes de la entrega:** poner `UI.PREVIEW_ENABLED = false` en [ui-config.js](client/public/js/ui/ui-config.js#L6).

---

# Parte I · Taller 4 (resumen)

La Parte I construyó la identidad y la base del coordinator. Sigue vigente:

- **JWT verificado en el `upgrade` y cierre 4001 tras el handshake:** el navegador no puede leer el status HTTP de un upgrade rechazado (solo ve un 1006), pero sí el código de cierre `4001 "invalid token"`.
- **Sesión duplicada con 4002:** se queda la conexión nueva. El `close` de la vieja solo borra al jugador si `players.get(userId)?.socket === ws`, para no borrar a la nueva.
- **bcrypt con rounds configurables (mínimo 10) y `JWT_EXPIRES_IN` configurable** (`30s` para demostrar la expiración).
- **401 genérico y hash ficticio en el login.**
- **Heartbeat y cierre por expiración** del token con el socket abierto.
- **Estado del coordinator en memoria:** se pierde al reiniciar y no escala a varios coordinadores, que es el objetivo de las siguientes partes.
- **`/config.js` desde `.env`:** ninguna URL escrita en el cliente.
- **`textContent` contra XSS.**

**Lo que cambió en el Taller 5**
- El auth-service pasó de better-sqlite3 + bcrypt a `node:sqlite` + bcryptjs, con una tabla única y `provider` en el JWT.
- Los usernames pasaron de 3–30 a 3–32 caracteres.
- El body del auth bajó de 10 kB a 4 kB.
- El `maxPayload` del coordinator subió de 1024 a 2048 bytes.
- Tras el login se va a `play.html` y no a `lobby.html`.
- Los tokens emitidos antes del Taller 5 (sin `provider`) se rechazan con 4001.

### Decisiones tomadas durante el desarrollo

- **Origen del código:** los archivos del código base estaban copiados en la raíz (commit `3182f36 inicial`); se movieron a una copia local de solo lectura.
- **Configuración común:** dotenv con `{ quiet: true }`; `DB_PATH` relativo a la carpeta del servicio; `PORT` validado; el log de peticiones va antes de `express.json()` para registrar también los 400/413 de JSON roto.
- **`/login` no recorta el username:** solo exige texto no vacío de hasta 1000 caracteres; el cliente lo envía recortado.
- **Contraseñas:** la longitud de 6–72 se mide en caracteres; bcrypt trunca a 72 bytes.
- **`auth-service/.npmrc` (`ignore-scripts=true`):** nació para evitar la compilación de better-sqlite3 en una instalación limpia. Desde el Taller 5 no hay dependencias nativas y ya no es necesario, pero no estorba.
- **Coordinator:**
  - los mensajes son planos (`{ type, … }`);
  - el log HTTP no incluye la query (lleva el token);
  - el socket del upgrade tiene manejador de `error`;
  - el apagado cierra con 1001 y fuerza la salida a los 5 s.
- **Usernames sin distinguir mayúsculas:** "Oscar", "osCar" y "OSCAR" son la misma cuenta. Lo garantiza un índice `COLLATE NOCASE`, y el login devuelve el nombre tal como se registró.
- **Token corrupto con la sesión abierta:** el lobby y `play.html` revisan el token guardado cada segundo y con el evento `storage`. Si cambia o desaparece, la sesión se cae.
- **Pruebas en Windows:** los procesos se levantan y se detienen por PID. `netstat` en Git Bash puede devolver PIDs con `\r`.

---

## Créditos

Basado en el código de referencia **SSD-CommsWS** (<https://github.com/Draklif/SSD-CommsWS>).

El mapa de la ciudad y dos personajes (Heroína 11 y Explorador Pop, con sus poderes) se adaptaron de referencias visuales del equipo (`virus_city_map.html` y dos demos de personajes Funko). Se pasaron a módulos ES sin CDN ni fuentes externas. Se quitaron los interiores y los diálogos, y las colisiones pasaron al servidor. El Mensajero es un diseño original; sus herramientas (mochila cohete, aerosol y subfusil) se tomaron de una tercera demo.

- **Reutilizado:**
  - la estructura de `coordinator/index.js` (HTTP + WebSocket en el mismo puerto);
  - `send()` con chequeo de `readyState` y la idea de `broadcast()`;
  - el patrón `app.listen(PORT, (err) => …)` de Express 5;
  - los estilos de `dashboard/style.css` en la primera versión del cliente (luego reemplazados por la interfaz de Viruscity);
  - el atajo `$` y el indicador de estado del WebSocket del dashboard.
- **Cambiado o agregado:**
  - autenticación completa (local y Google) con tabla única;
  - verificación del token en el `upgrade` con códigos 4001/4002;
  - `Map` de jugadores con game loop autoritativo, intención y extras;
  - heartbeat y cierre por expiración;
  - cliente de juego en canvas con `textContent`/`fillText`;
  - configuración con dotenv y un `package.json` por servicio;
  - se eliminaron roles, workers, pulsos de aplicación, dashboards de depuración y CORS abierto en el coordinator.
