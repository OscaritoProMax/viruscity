# Plan de la fase final: examen final de Sistemas Distribuidos

Comparo lo que pide `SSD_EXAMEN_FINAL.pdf` con lo que ya tiene Viruscity y propongo cómo cerrar lo que falta.

## 1. Qué pide el examen

**Restricciones (se mantienen de los talleres):**
- Servidor autoritativo.
- Solo `ws`, `express` y `node:sqlite`: sin Redis, Kafka ni librerías de consenso.
- JWT con secreto compartido, sin sesiones en memoria en el auth.
- **Sin proxy reverso delante del sistema**: el cliente conoce la lista de servidores.
- Sin sticky sessions.

Cualquier excepción se justifica en el README.

**Entregables, en orden de importancia:**
1. Los 4 talleres integrados en **un solo repositorio coherente**, que funcione en local **y por túnel**.
2. **Dos tracks** de extensión, uno principal y uno secundario, completamente integrados.
3. Un **juego con adaptación profunda**: estado de juego replicado entre coordinadores y condiciones de victoria.
4. Un **README profesional** que un ingeniero externo entienda en menos de 10 minutos.

**Sustentación:**

| Parte | Tiempo |
|---|---|
| Demos críticas: login con Google, autoridad del servidor, failover de coordinador y de auth, más las de los 2 tracks | 5 min |
| Demo del juego | 3 min |
| Cada integrante explica una pieza | 5 min |
| Preguntas | 4 min |
| Cierre (qué harían distinto, limitaciones) | 3 min |

## 2. Qué ya cumplimos

| Requisito | Estado | Evidencia o qué falta |
|---|---|---|
| Servidor autoritativo | ✔ | Intenciones, game loop a 20 Hz y choques en el servidor (Taller 5) |
| Sin Redis, Kafka ni consenso | ✔ | La elección estilo Raft y la replicación están escritas a mano (Taller 7) |
| JWT compartido, sin sesiones en el auth | ✔ | El coordinador valida el JWT sin consultar al auth |
| Sin sticky sessions | ✔ | Cualquier coordinador sirve a cualquier jugador; al caer uno, el cliente pide otro al directorio |
| El cliente conoce la lista de servidores | ✔ | `AUTH_URLS` con failover en el cliente; los coordinadores salen del directorio |
| **Sin proxy reverso** | ⚠ | El **gateway** del Taller 7 es un proxy por prefijo, y solo existe para el túnel: ngrok gratis da pocos endpoints y el sistema necesita 7 URLs públicas. Se puede justificar o reemplazar (decisión D2) |
| 1 · Talleres 4–7 integrados | ◐ | La rama `viruscity` ya tiene los 4 talleres y el juego. Falta: fusionar `misiones-jugables`, llevarlo a `main`, poner la vista previa en `false`, subirlo a GitHub y **probarlo completo por el túnel** |
| 2 · Dos tracks | ✘ | **No hay ninguno implementado.** Es lo principal que falta (sección 3) |
| 3 · Juego profundo | ✔✔ | Viruscity tiene roles ocultos, contagio, 12 misiones con minijuegos dentro de edificios, cura, victoria, espectadores y gracia de reconexión, con **un árbitro replicado entre coordinadores**. Supera lo pedido; cuando termine M4–M5 quedan 12 minijuegos jugables |
| 4 · README profesional | ◐ | Es muy completo (~1900 líneas), pero está ordenado **por taller**, no "para entender en 10 minutos". Hay que reestructurarlo (sección 4) |
| Commits incrementales | ✔ | Cientos de commits pequeños, con prefijos |
| Sistema por ngrok en la sustentación | ◐ | El gateway funciona. Falta ensayar con el dominio de ngrok, Google (orígenes autorizados) y los 7 servicios de la rama final |

## 3. Los tracks: análisis y recomendación

| Track | Encaje con lo que ya tenemos | Esfuerzo | Riesgo | Para la demo |
|---|---|---|---|---|
| **2.1 Persistencia del estado** | Muy alto: ya guardamos la última posición en memoria (`lastPositions`), el mesh replica posiciones (`positions_sync`) y usamos `node:sqlite` | Medio | Bajo | Clara: alice en x = 400, matar los 3 coordinadores, reiniciarlos y alice vuelve a x ≈ 400 |
| 2.2 Observabilidad | Medio: tenemos `/status`, `/health` y `cluster.html`; faltan métricas, percentiles, trazas y lag con relojes desfasados | Medio-alto | Medio | Muy visual: un dashboard en vivo con el líder y los coordinadores |
| 2.3 Seguridad | Parcial: ya hay límites de mensajes WS. Faltan límites en el login, **refresh tokens replicados** (cambia el oplog) y auditoría | Alto | Medio-alto | Ataque de fuerza bruta en vivo |
| 2.4 Sharding | Bajo: choca con el árbitro único y la réplica completa del mundo | Muy alto | Alto | — |
| **2.5 Espectador** | Alto: ya existen espectadores *dentro* de la partida y el estado del mundo no lleva roles, así que no se filtra información | Bajo-medio | Bajo | Clara: una pestaña sin login ve la partida; un `intent` desde DevTools se ignora |
| 2.6 Chat distribuido | Alto: el **árbitro** puede dar un orden total a los mensajes, como ya hace con los eventos | Medio | Bajo | Tres clientes en tres coordinadores, mismo orden |

**Recomendación:**
- **Principal: 2.1 Persistencia.** Es la que más se apoya en lo que ya existe. Sus preguntas difíciles se responden con argumentos sólidos:
  - un **número de versión por jugador**, que incrementa su coordinador dueño, con desempate por id;
  - tiempos del mismo reloj del dueño, para que el desfase entre máquinas no importe;
  - un límite de antigüedad para descartar estados viejos.

  Además se extiende al juego: **persistir la partida de Viruscity**, para que la cura y los roles sobrevivan al reinicio de los 3 coordinadores. Eso lo hace un track principal "profundo".
- **Secundario: 2.5 Espectador.** Es corto, encaja con el juego (ver la partida sin jugar, sin conocer roles) y tiene una demo inmediata.
- **Alternativa al secundario: 2.6 Chat.** Tiene un argumento técnico muy bueno: el orden total lo da el árbitro, igual que los eventos.

### Diseño resumido del track principal (2.1)

- Cada coordinador guarda en su propia `node:sqlite` (`coord-a.db`, …), cada `PERSIST_MS` (2 s), la tabla `players(userId, username, x, y, extras, version, updatedAt, ownerId)`, solo de los jugadores que conoce.
- **Al arrancar**, carga esa tabla. Cuando un jugador vuelve, aparece donde estaba en lugar de en un punto al azar; se reutiliza `resumePosition`, que comprueba que la casilla esté libre.
- **Al entrar al mesh**, los coordinadores intercambian un `world_snapshot` y cada jugador queda con la versión más alta (*last-writer-wins* por versión, no por reloj). Así se responde "¿cuál gana si dos tienen estados distintos?".
- **Estados viejos:** una entrada más antigua que `PERSIST_MAX_AGE_MS` (por ejemplo 10 min) se descarta. El README explica el caso de "el otro coordinador murió hace 5 minutos".
- **Extra de Viruscity:** el árbitro persiste el estado de la partida (`match`, ya serializable y validado). Si reinician los 3 coordinadores, la partida sigue con su cura, misiones y roles. La gracia de reconexión ya existe.
- **Pruebas:** lógica pura (reconciliación y antigüedad) con `node:test`, más un smoke `smoke:persistencia` que mata y reinicia los 3 coordinadores y comprueba que alice vuelve a x ≈ 400 y la partida sigue.

### Diseño resumido del track secundario (2.5)

- `GET /spectate` (WebSocket **sin token**) en el coordinador recibe el `state` y la vista pública de la partida (fase, cura, misiones; **nunca roles**). Cualquier mensaje que envíe se ignora, y si inunda, se desconecta.
- Límite `MAX_SPECTATORS` por coordinador, y los espectadores reciben el estado **a 10 Hz** en lugar de 20. Así se responde a "1000 espectadores": se limita y se baja la frecuencia. `connectedPlayers` no los cuenta para el reparto de carga.
- `spectate.html`: la ciudad sin controles, un letrero "MODO ESPECTADOR" y una cámara que sigue a un jugador elegible o se mueve libre.

## 4. README profesional (reestructura)

El README actual se conserva **como anexos por taller**, y arriba van ~10 minutos de lectura:
1. **Qué es** (un párrafo y una captura).
2. **Arquitectura en un diagrama**: auth ×3 con líder, coordinadores ×3 en mesh con árbitro, client, gateway opcional.
3. **Flujos clave**: login → directorio → WebSocket; movimiento autoritativo; escritura replicada; partida.
4. **Decisiones** con su porqué, en una tabla: mayoría en las escrituras, árbitro único, estado blando del directorio, el gateway como excepción justificada, persistencia por versión…
5. **Modos de falla conocidos**, en una tabla: qué pasa si cae X.
6. **Cómo levantar todo**: local en 7 terminales y por túnel, con un script.
7. **Tracks** y el juego (con enlaces a sus anexos).
8. **Limitaciones y qué haríamos distinto.**

## 5. Fases propuestas hasta la entrega

| Fase | Contenido | Esfuerzo aproximado |
|---|---|---|
| **F0** | Terminar las misiones jugables: M3 (casi lista), M4 (4 minijuegos y la integración) y M5 (sonido, ajuste y partida de prueba) | ~2 sesiones |
| **F1 · Integración** | Fusionar `misiones-jugables` en `viruscity` y luego en `main`; `PREVIEW_ENABLED = false`; limpieza (.gitignore, archivos sueltos); auditoría completa (instalación limpia y todos los smokes) | corta |
| **F2 · Track principal** (persistencia) | Lo descrito en la sección 3, con pruebas y smoke | ~1–2 sesiones |
| **F3 · Track secundario** (espectador o chat) | Lo descrito en la sección 3 | ~1 sesión |
| **F4 · Despliegue por túnel** | Script para levantar todo; ngrok con **dominio fijo**; Google con ese origen; smoke **a través del túnel** | corta |
| **F5 · README profesional** | La reestructura de la sección 4 | ~1 sesión |
| **F6 · Sustentación** | Guion de demos con tiempos; checklist del día (suspensión del equipo, dominio, datos); el plan de estudio actualizado con los tracks; ensayo completo | ~1 sesión |
| **F7 · Entrega** | Push de todas las ramas, PR o fusión a `main`, etiqueta `v1.0` | corta |

## 6. Decisiones que necesito de ti

- **D1 · Tracks.** ¿Persistencia (principal) + Espectador (secundario), como recomiendo? ¿O prefieres Chat, u Observabilidad, como secundario?
- **D2 · Proxy reverso.** El examen prohíbe un proxy delante del sistema, salvo justificación.
  - **(a)** Mantener el gateway **solo para el túnel** y justificarlo en el README. Es lo que recomiendo: ngrok gratis limita los endpoints, el gateway no balancea, el cliente sigue teniendo la lista de servidores y en local no se usa.
  - **(b)** Plan de pago de ngrok, con 7 túneles y sin gateway.
  - **(c)** Otro túnel que permita varios endpoints gratis, por ejemplo `cloudflared`. El examen dice "ngrok", así que lo veo menos recomendable.
- **D3 · Integrantes.** ¿Presentas solo o en grupo? Si es en grupo, ¿cuántos son? En la sustentación "cada integrante explica una pieza distinta", y reparto el guion y el plan de estudio según eso.
- **D4 · Fecha de la sustentación**, para ordenar las fases y saber si hacemos M4–M5 completas antes de los tracks o después.
- **D5 · ¿Persistimos también la partida de Viruscity** en el track principal, para que sobreviva al reinicio de los 3 coordinadores? Recomiendo que sí: suma profundidad con poco riesgo, porque el estado ya es serializable.
- **D6 · Rama de entrega.** ¿`main` es la que ve el profesor? Propongo fusionar todo en `main` con un PR y etiquetar `v1.0`.

## 7. Riesgos a vigilar

- **Suspensión del PC** durante la sustentación (ya nos dejó elecciones extra en las pruebas): desactivarla y tener el cargador conectado.
- **Dominio de ngrok:** si cambia, Google deja de funcionar hasta registrar el nuevo origen. Con el dominio fijo gratuito de ngrok no cambia.
- **Datos de demo:** cuentas y bases de los 3 auth coherentes (copiar `users.db` a los tres antes de arrancar).
- **Tiempo:** si la fecha es cercana, priorizo F1 → F2 → F4 → F5 → F6 y dejo M4–M5 o el track secundario recortados y documentados.
