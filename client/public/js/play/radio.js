// "Radio Virus 86.6 FM": música synthwave de los 80, generada en el navegador y SINCRONIZADA.
//
// La radio no transmite audio por la red. Todos los clientes tocan la misma partitura, y qué canción y
// qué compás suenan se calcula con la hora del SERVIDOR (el `t` de cada state, como el reloj del día).
// Así todos los jugadores escuchan lo mismo al mismo tiempo (con la diferencia de su latencia).
//
// Funciones puras (se prueban en Node): PLAYLIST, programAt(serverT), estimateOffset(samples).
// createRadio(audio) → { update(serverNow), program(serverNow) }  (usa Web Audio)

export const STATION = "Radio Virus 86.6 FM";
const BARS = 24; // compases por canción
const STEPS = 16; // semicorcheas por compás
export const GAP_MS = 3 * 1000; // entre canciones: estática e identificación de la emisora

// Canciones en tonalidades menores, con progresiones típicas del synthwave. root: nota MIDI de la tónica.
// chords: grado de cada compás (semitonos sobre la tónica + tipo). lead: motivo de 16 semicorcheas (null = silencio).
export const PLAYLIST = [
    {
        title: "Neón en cuarentena",
        bpm: 104,
        root: 57, // La menor
        chords: [[0, "m"], [-4, "M"], [3, "M"], [-2, "M"]], // Am F C G
        lead: [12, null, 15, null, 19, null, 17, 15, 12, null, 10, null, 12, null, null, null],
    },
    {
        title: "Avenida Central 1986",
        bpm: 112,
        root: 50, // Re menor
        chords: [[0, "m"], [5, "m"], [-4, "M"], [-5, "M"]], // Dm Gm Bb A
        lead: [7, 10, 12, null, 12, 10, 7, null, 5, 7, null, 3, 2, null, 0, null],
    },
    {
        title: "Esporas en la niebla",
        bpm: 88,
        root: 52, // Mi menor, con un acorde inquietante de segunda menor
        chords: [[0, "m"], [1, "M"], [0, "m"], [-2, "M"]], // Em F Em D
        lead: [12, null, null, 11, 12, null, 15, null, 13, null, 12, null, null, null, 7, null],
    },
];

const stepMs = (song) => 60000 / song.bpm / 4;
export const songMs = (song) => stepMs(song) * STEPS * BARS;
const CYCLE_MS = PLAYLIST.reduce((sum, s) => sum + songMs(s) + GAP_MS, 0);

// Qué suena en un instante del servidor: { index, song, offsetMs (desde el inicio de la canción) } o
// { gap: true, gapOffsetMs } durante la pausa entre canciones.
export function programAt(serverT) {
    let t = ((serverT % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    for (let index = 0; index < PLAYLIST.length; index++) {
        const song = PLAYLIST[index];
        const len = songMs(song);
        if (t < len) return { index, song, offsetMs: t, songStartT: serverT - t };
        t -= len;
        if (t < GAP_MS) return { gap: true, index, gapOffsetMs: t, next: PLAYLIST[(index + 1) % PLAYLIST.length] };
        t -= GAP_MS;
    }
    return { gap: true, index: 0, gapOffsetMs: 0, next: PLAYLIST[0] };
}

// Diferencia reloj del servidor − reloj local. Cada state da una muestra (t − Date.now() al llegar),
// que es la diferencia real menos la latencia de ese mensaje: la más alta es la de menor latencia.
export function estimateOffset(samples) {
    return samples.length ? Math.max(...samples) : 0;
}

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const triad = (root, kind) => [root, root + (kind === "m" ? 3 : 4), root + 7];

export function createRadio(audio) {
    let scheduledUntil = -Infinity; // hora del servidor hasta la que ya se programaron notas
    let lastGapStart = null; // inicio (hora del servidor) de la última pausa con sintonía
    const LOOKAHEAD_MS = 220;
    const MIN_ADVANCE_MS = 0.5; // cada vuelta del programador avanza al menos esto
    const MAX_STEPS_PER_UPDATE = 64; // en 220 ms caben ~4 semicorcheas: 64 es un tope de seguridad

    // Una nota del sintetizador en el bus de la radio
    function note(when, freq, dur, type, vol, filterFreq = null) {
        const ctx = audio.context();
        const bus = audio.radioBus();
        if (!ctx || !bus) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, when);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(vol, when + Math.min(0.02, dur / 4));
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        let out = o;
        if (filterFreq) {
            const f = ctx.createBiquadFilter();
            f.type = "lowpass";
            f.frequency.value = filterFreq;
            o.connect(f);
            out = f;
        }
        out.connect(g);
        g.connect(bus);
        o.start(when);
        o.stop(when + dur + 0.05);
    }

    function kick(when) {
        const ctx = audio.context();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(140, when);
        o.frequency.exponentialRampToValueAtTime(40, when + 0.15);
        g.gain.setValueAtTime(0.5, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        o.connect(g);
        g.connect(audio.radioBus());
        o.start(when);
        o.stop(when + 0.25);
    }

    // Programa la semicorchea `step` (0..BARS*STEPS-1) de la canción en el instante `when` (AudioContext)
    function playStep(song, step, when) {
        const bar = Math.floor(step / STEPS);
        const s = step % STEPS;
        const [deg, kind] = song.chords[bar % song.chords.length];
        const root = song.root + deg;
        const chord = triad(root, kind);
        const sdur = stepMs(song) / 1000;
        const section = bar < 4 ? "intro" : bar >= BARS - 2 ? "outro" : "full";
        const noise = (dur, vol, filter, freq) => audio.noise(dur, vol, filter, freq, Math.max(0, when - audio.context().currentTime), audio.radioBus());

        // Colchón (pad) al empezar cada compás
        if (s === 0) for (const m of chord) note(when, midiToFreq(m), sdur * STEPS, "sawtooth", 0.025, 1400);
        // Arpegio en semicorcheas
        if (section !== "outro") note(when, midiToFreq(chord[s % 3] + 12 + (s % 6 === 5 ? 12 : 0)), sdur * 0.9, "square", 0.018, 2600);
        if (section === "intro") return;
        // Bajo en corcheas (con saltos de octava)
        if (s % 2 === 0) note(when, midiToFreq(root - 12 + [0, 0, 12, 0, 0, 12, 0, 7][s / 2]), sdur * 1.8, "sawtooth", 0.06, 700);
        // Batería: bombo, caja y charles
        if (s === 0 || s === 8 || (s === 10 && bar % 2)) kick(when);
        if (s === 4 || s === 12) noise(0.18, 0.12, "bandpass", 1800);
        if (s % 2 === 1) noise(0.04, 0.035, "highpass", 7000);
        // Melodía en la segunda mitad de cada bloque de 8 compases
        if (section === "full" && bar % 8 >= 4) {
            const m = song.lead[s];
            if (m !== null) note(when, midiToFreq(song.root + m + 12), sdur * 1.6, "triangle", 0.05);
        }
    }

    // Llamar en cada cuadro con la hora estimada del servidor
    function update(serverNow) {
        const ctx = audio.context();
        if (!audio.ready() || audio.isRadioMuted()) {
            scheduledUntil = serverNow; // al volver, empieza desde "ahora" (sin ráfaga de notas atrasadas)
            return;
        }
        if (scheduledUntil < serverNow - 100) scheduledUntil = serverNow;
        const until = serverNow + LOOKAHEAD_MS;
        // Recorre las semicorcheas que caen en (scheduledUntil, until].
        // OJO: la hora del servidor ronda 1,8·10^12 ms y a esa escala el redondeo puede dejar a programAt
        // un pelo antes de un límite (fin de canción o de pausa). Por eso CADA vuelta avanza al menos
        // MIN_ADVANCE_MS, los saltos de límite caen 1 ms después de él, y hay un tope de vueltas por
        // cuadro: el bucle nunca puede quedarse girando y congelar la página.
        let guard = 0;
        while (scheduledUntil < until && guard++ < MAX_STEPS_PER_UPDATE) {
            const p = programAt(scheduledUntil);
            if (p.gap) {
                // Pausa entre canciones: estática de radio y la sintonía de la emisora (una vez)
                const gapStart = Math.round(scheduledUntil - p.gapOffsetMs);
                if (gapStart !== lastGapStart) {
                    lastGapStart = gapStart;
                    const when = ctx.currentTime + Math.max(0, (scheduledUntil - serverNow) / 1000);
                    audio.noise(1.2, 0.05, "bandpass", 2000, Math.max(0, when - ctx.currentTime), audio.radioBus());
                    [69, 72, 76, 81].forEach((m, i) => note(when + 1.3 + i * 0.16, midiToFreq(m), 0.3, "triangle", 0.05));
                }
                // Fin de la pausa: 1 ms después del límite (la canción siguiente toma ese ms como su paso 0)
                scheduledUntil = Math.max(scheduledUntil + MIN_ADVANCE_MS, scheduledUntil + (GAP_MS - p.gapOffsetMs) + 1);
                continue;
            }
            const sm = stepMs(p.song);
            // Al empezar una canción (primeros 2 ms) se toca el paso 0 aunque el redondeo diga otra cosa
            const step = p.offsetMs < 2 ? 0 : Math.ceil(p.offsetMs / sm - 1e-6);
            const stepT = p.songStartT + step * sm;
            if (step >= BARS * STEPS) {
                // Fin de la canción: 1 ms después del límite empieza la pausa
                scheduledUntil = Math.max(scheduledUntil + MIN_ADVANCE_MS, p.songStartT + songMs(p.song) + 1);
                continue;
            }
            if (stepT > until) break;
            const when = ctx.currentTime + Math.max(0, (stepT - serverNow) / 1000);
            playStep(p.song, step, when);
            scheduledUntil = Math.max(scheduledUntil + MIN_ADVANCE_MS, stepT + 0.5); // siguiente semicorchea
        }
    }

    return {
        update,
        program: (serverNow) => programAt(serverNow),
    };
}
