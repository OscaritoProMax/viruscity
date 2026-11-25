# Guía de sustentación (un solo presentador)

Formato del examen, unos 20 minutos:

| Bloque | Tiempo |
|---|---|
| Demo del sistema | 5 min |
| Gameplay | 3 min |
| Explicar piezas | 5 min |
| Preguntas | 4 min |
| Cierre | 3 min |

Como presentas solo, el docente te puede pedir **cualquier** pieza: prepara las 5 del bloque C.

---

## 0. Antes de entrar (30 min antes)

- [ ] **Desactivar la suspensión del PC** (Configuración → Sistema → Energía → "Nunca"). Si el equipo se duerme, se cae todo.
- [ ] `git pull` en `main` y `npm ci` en `auth-service`, `coordinator` y `client` (solo si cambió algo).
- [ ] Unificar los datos, si aún no está hecho: copiar `auth-service/users.db` como `users-a.db`, `users-b.db` y `users-c.db`, **con los auth apagados**.
- [ ] Túneles:
  - con `tunel/tunel.env` lleno, doble clic en **`iniciar-ngrok.cmd`**: configura los `.env` y abre los 7 servicios y los 7 túneles;
  - abrir `https://rebalance-spotted-appraisal.ngrok-free.dev` (el client) y aceptar el aviso de ngrok;
  - si te piden pruebas **locales**: cierra todas las ventanas y usa **`iniciar-servicios.cmd`**.
- [ ] Comprobar:
  - en `https://<client>/cluster.html` deben aparecer los 3 coordinadores;
  - en el login, el indicador "Auth: auth-x (líder)".
- [ ] **Partida con un solo presentador:** hacen falta 3 jugadores (`MIN_PLAYERS_TO_START=3`). Ten 3 cuentas (`alice`, `bob`, `carol`) en 3 ventanas: normal, InPrivate y otro navegador. Si prefieres 2 jugadores, pon `MIN_PLAYERS_TO_START=2` en los 3 `.env.coord-*` antes de levantar.
- [ ] Pestañas listas:
  1. juego de alice;
  2. juego de bob;
  3. `spectate.html` en InPrivate;
  4. `cluster.html`;
  5. una terminal en `coordinator/`.

## A. Demo del sistema (5 min): las 4 críticas y los 2 tracks

Di primero en una frase qué demuestras y luego hazlo.

1. **Login con Google (30 s).** "Google me da un ID token; el auth lo verifica con el `audience` y me emite NUESTRO JWT." Entra con Google y muestra la insignia **G** en la lista de jugadores.
2. **Autoridad del servidor (45 s).** En DevTools de alice pega el snippet "Tomar el WebSocket" del README (Taller 5, demo c2):
   - `enviar({ type: "teleport", x: 100, y: 100 })` → no pasa nada;
   - `enviar({ type: "intent", intent: { dir: { x: 9999, y: 0 } } })` → va a la velocidad normal.

   Frase: "el cliente solo manda una dirección; el servidor la reduce a su signo y mueve a 200 px/s".
3. **Failover de coordinador (45 s).** Mira en la pastilla a qué coordinador está alice (por ejemplo coord-b). Cierra esa ventana. En 1–3 s alice está en otro coordinador, **en el mismo lugar**. En `cluster.html`, coord-b desaparece a los ~6 s (TTL).
4. **Failover de auth (60 s).** El indicador dice cuál es el líder. Cierra su ventana. Mientras tanto, alice **sigue jugando**: "el JWT se verifica sin el auth". Unos 8 s después registra un usuario nuevo: funciona, y el indicador muestra el auth nuevo, líder con un término mayor.
5. **Track 2.1, persistencia (60 s).**
   - Lleva a alice a un lugar reconocible. En su consola: `lastState.players.find(p => p.username === "alice")` → anota x, y.
   - Cierra las **3** ventanas de coordinadores.
   - Vuelve a levantarlas (`npm run start:a`, `b`, `c`) **antes de ~50 s**: el cliente reintenta unas 20 veces, cada 1–3 s.
   - Alice reaparece en el mismo x, y.
   - Frase: "cada coordinador guarda cada 2 s en su propia SQLite; al volver, el world_snapshot reconcilia por versión".
   - Respaldo si algo falla: `npm run smoke:persistencia` (P1–P8 en verde).
6. **Track 2.5, espectador (30 s).**
   - La pestaña InPrivate en `spectate.html` muestra el **MODO ESPECTADOR**: ve moverse a alice y no tiene controles.
   - En su DevTools: `vcSpectator.send({ type: "intent", intent: { dir: { x: 1, y: 0 } } })` → no pasa nada.
   - Abre `https://<coord-x>/status` y muestra `spectators.ignoredMessages`.

## B. Gameplay (3 min)

- **Qué es:** sanos contra un infectado oculto. Los sanos fabrican la cura haciendo misiones **dentro de los edificios** (minijuegos). El infectado contagia con F.
- **Gana:**
  - los sanos, con la cura al 100 %;
  - el infectado, si contagia a todos o si se acaba el tiempo;
  - si el infectado se desconecta del todo, los sanos.
- **En vivo:**
  - con 3 jugadores la cuenta regresiva arranca sola;
  - la pantalla de rol;
  - entrar al Hospital, pulsar E en la consola y hacer el minijuego (las muestras o la lámpara UV);
  - la cura sube para todos.
- **Cómo es autoritativo:**
  - el **árbitro** (el coordinador de id menor) valida rango, enfriamiento y tiempo mínimo de cada misión (`MISSION_MIN_MS`): si el minijuego se "resuelve" en 1 s, el servidor responde `too_fast`;
  - los roles **nunca** viajan a los clientes hasta el final; la alerta pública no lleva nombres;
  - el espectador lo demuestra: ve la partida sin conocer roles.

## C. Las 5 piezas (1 minuto cada una, ensayadas)

1. **Auth replicado (Taller 7):** elección estilo Raft (término, voto persistido antes de votar, log al día, *jitter*). Escritura: el líder pide la mayoría ANTES de aplicar; si no la consigue, `write_abort` y deshace. Puerta de lectura: nunca emite un token con la base atrasada. Es CP.
2. **Directorio y reconexión (Taller 6):** estado blando con TTL de 6 s y reservas de 3 s para repartir ráfagas. Heartbeat a los 3 auth. El cliente pide **otro** coordinador cuando se cae el suyo (no hay sticky sessions). Además recuerda los que le fallaron y los excluye (`/coordinator?exclude=coord-a,coord-b`): si cae a y b no responde, pasa a c en unos 3 s, sin esperar a que el TTL los saque del directorio.
3. **Malla de coordinadores:** una conexión por par (la abre el id menor). Cada jugador tiene un dueño y solo el dueño habla de él. Al conectar se hace un resync, y cada 1 s `positions_sync` por la deriva de `dt`. Sesión duplicada: gana la más nueva (`connectedAtMs`, luego el id).
4. **Partida distribuida:** reductor puro (`match.js`) con reloj y azar inyectados. Árbitro único que replica `game_state` con `rev` y `eid`. Handover cuando aparece un id menor; relevo cuando cae.
5. **Tracks:**
   - **Persistencia:** versión por jugador que sube solo el dueño, lo vivo gana, 10 min de antigüedad máxima.
   - **Espectador:** fuera del juego, límite por coordinador, 10 Hz, contrapresión.

## D. Preguntas probables (respuestas cortas)

- **¿Por qué la versión y no la hora para reconciliar?** Los relojes de las máquinas pueden estar desfasados; con la hora ganaría siempre el reloj adelantado. La versión la incrementa solo el dueño.
- **¿Y si un coordinador murió hace 5 minutos con un estado viejo?** Mientras tanto, el jugador siguió en otro coordinador que subió la versión, así que lo viejo pierde. Si el jugador está conectado ahora, lo vivo gana. Con más de 10 minutos ni se recupera.
- **¿1000 espectadores?** Hay un límite por coordinador (4003, y el cliente va a otro), una serialización por envío, 10 Hz y se saltan cuadros si alguien va lento. Para más haría falta un nivel de retransmisores (*fan-out*). Un coordinador "de espectadores" rompería la regla de que todos son iguales.
- **¿Por qué caen login y registro con 2 auth caídos, si el juego sigue?** Elegimos consistencia (CP): sin mayoría no hay escrituras seguras. El juego no necesita al auth porque el JWT se verifica localmente.
- **¿Dos líderes a la vez?** No en el mismo término: cada nodo vota una vez por término y hace falta la mayoría. Un líder aislado pierde el *lease* y se baja.
- **¿Por qué un árbitro y no que cada coordinador decida?** Un solo orden de eventos: evita dos infecciones simultáneas contradictorias o la misma misión hecha dos veces. El costo es un salto de red para las acciones de los jugadores de otros coordinadores.
- **¿Proxy reverso?** No hay: 7 túneles directos. El gateway del Taller 7 existe solo como alternativa para una sola cuenta de ngrok.
- **¿Qué ve un tramposo?** Puede editar su dibujo (`lastState`) y elegir su apariencia. No puede moverse más rápido, atravesar paredes, cambiar su identidad ni ver roles.
- **¿Y si se caen todos los servicios?** El cliente tiene un tiempo de gracia (`RECONNECT_GRACE_MS`, 45 s) con cuenta atrás en pantalla. Si un coordinador vuelve a tiempo, reconecta y el jugador sigue donde estaba (persistencia). Si no, vuelve al login con "Se cayeron los servicios del juego". La gracia se mide por tiempo y no por intentos porque, con los auth caídos, cada intento tarda hasta 12 s en fallar.
- **¿Y si un jugador se sale a mitad de partida?** Conserva su rol 60 s (`RECONNECT_GRACE_MS` del coordinador). Si vuelve, sigue en la partida; si no, abandona. Todos ven un aviso sin su nombre ni su rol, para no revelar información oculta. El abandono decide la partida según quién queda: si se fue el infectado, ganan los jugadores; si se fueron los últimos sanos, ganan los infectados; si no queda nadie, se cancela. Lo decide el árbitro en el reductor puro (`match.js`), así que todos los coordinadores ven el mismo resultado.

## E. Cierre (3 min): qué haríamos distinto y limitaciones

- **Raft completo:** compactación del log y cambio de membresía. Hoy los 3 nodos son fijos.
- **Particiones de la malla:** puede haber dos árbitros y al unirse gana la partida más nueva. Mejor sería exigir mayoría de coordinadores para empezar una partida.
- **Despliegue en varias máquinas:** todo se configura por URL, así que es cambiar los `.env`. Hoy un solo equipo es un punto único de falla.
- **Persistencia replicada** en vez de reconciliar bases independientes, y retransmisores para espectadores.
- **Lo que aprendimos:** separar el núcleo puro de la capa de red permitió probar elección, partida y reconciliación con reloj falso, sin levantar procesos.
