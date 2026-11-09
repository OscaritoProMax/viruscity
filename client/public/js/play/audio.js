// Sonido del juego con Web Audio (todo sintetizado: sin archivos ni dependencias).
//
// createAudio() → {
//   unlock(), ready(), context(), radioBus(),
//   sfx: { blip, chime, door, jukebox, step(surface), power(name, volume) },
//   isSfxMuted(), setSfxMuted(b), isRadioMuted(), setRadioMuted(b)
// }
// Los navegadores no dejan sonar audio hasta que la persona interactúa: unlock() se llama en el primer
// clic o tecla. Las preferencias de silencio se recuerdan en este navegador.
// Efectos adaptados de la referencia virus_city_map.html (pasos, blip, campana, puerta, rocola).

const SFX_VOLUME = 0.8;
const RADIO_VOLUME = 0.45;
const STEP_EVERY_S = 0.3; // un paso cada 0,3 s mientras se camina

function readPref(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
function writePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // sin almacenamiento: la preferencia dura solo esta visita
    }
}

export function createAudio() {
    let ctx = null;
    let sfxBus = null;
    let radio = null;
    let noiseBuffer = null;
    let lastStep = 0;
    let sfxMuted = readPref("playSfxMuted") === "1";
    let radioMuted = readPref("playRadioMuted") === "1";

    function unlock() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
            const master = ctx.createGain();
            master.gain.value = 0.9;
            master.connect(ctx.destination);
            sfxBus = ctx.createGain();
            sfxBus.gain.value = sfxMuted ? 0 : SFX_VOLUME;
            sfxBus.connect(master);
            // La radio pasa por un filtro de banda: suena "de radio", algo cálida y estrecha
            radio = ctx.createGain();
            radio.gain.value = radioMuted ? 0 : RADIO_VOLUME;
            const tone = ctx.createBiquadFilter();
            tone.type = "lowpass";
            tone.frequency.value = 5200;
            radio.connect(tone);
            tone.connect(master);
            // Ruido blanco reutilizable (1 s)
            noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
    }

    const ready = () => Boolean(ctx) && ctx.state === "running";

    // Tono con envolvente rápida; glide: frecuencia final (barrido)
    function tone(freq, dur, type = "square", vol = 0.05, when = 0, bus = sfxBus, glide = null) {
        if (!ready() || !bus) return;
        const t = ctx.currentTime + when;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    // Ráfaga de ruido filtrado (golpes, siseos, explosiones)
    function noise(dur, vol, filter = "lowpass", freq = 1200, when = 0, bus = sfxBus, freqEnd = null) {
        if (!ready() || !bus) return;
        const t = ctx.currentTime + when;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = filter;
        f.frequency.setValueAtTime(freq, t);
        if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f);
        f.connect(g);
        g.connect(bus);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    }

    const sfx = {
        blip: () => tone(660, 0.05, "square", 0.035),
        chime: () => [784, 988, 1175].forEach((f, i) => tone(f, 0.18, "triangle", 0.06, i * 0.09)),
        door: () => {
            tone(180, 0.12, "sine", 0.08);
            tone(120, 0.18, "sine", 0.08, 0.08);
        },
        // Melodía synth-pop de la rocola del Burger Neón (de la referencia)
        jukebox() {
            const seq = [392, 494, 587, 494, 440, 523, 659, 523, 392, 494, 587, 740, 659, 587, 494, 392];
            seq.forEach((f, i) => {
                tone(f, 0.2, "sawtooth", 0.035, i * 0.2);
                tone(f / 2, 0.2, "square", 0.02, i * 0.2);
            });
            for (let i = 0; i < 16; i += 2) tone(98, 0.1, "triangle", 0.07, i * 0.2);
        },
        // Pasos: suaves sobre hierba o tierra, más secos sobre piedra o baldosa
        step(surface) {
            if (!ready()) return;
            const now = ctx.currentTime;
            if (now - lastStep < STEP_EVERY_S) return;
            lastStep = now;
            const hard = surface !== "soft";
            const f = hard ? 260 + Math.random() * 40 : 130 + Math.random() * 30;
            tone(f, 0.08, hard ? "triangle" : "sine", 0.07, 0, sfxBus, 35);
        },
        // Sonido de cada poder; volume de 0 a 1 (los de otros jugadores bajan con la distancia)
        power(name, volume = 1) {
            const v = Math.max(0, Math.min(1, volume));
            if (v <= 0.01) return;
            switch (name) {
                case "aura":
                    tone(220, 0.6, "sine", 0.08 * v, 0, sfxBus, 880);
                    tone(330, 0.6, "triangle", 0.04 * v, 0.05, sfxBus, 1320);
                    break;
                case "walkie":
                    noise(0.25, 0.06 * v, "bandpass", 2400);
                    tone(1200, 0.08, "square", 0.03 * v, 0.25);
                    tone(900, 0.08, "square", 0.03 * v, 0.35);
                    break;
                case "vial":
                    for (let i = 0; i < 5; i++) tone(500 + i * 120, 0.08, "sine", 0.05 * v, i * 0.06, sfxBus, 900 + i * 150);
                    break;
                case "shotgun":
                    noise(0.35, 0.22 * v, "lowpass", 1800, 0, sfxBus, 200);
                    tone(90, 0.25, "sine", 0.15 * v, 0, sfxBus, 40);
                    break;
                case "sword":
                    noise(0.25, 0.12 * v, "bandpass", 600, 0, sfxBus, 4000);
                    tone(1500, 0.15, "triangle", 0.03 * v, 0.08);
                    break;
                case "spray":
                    noise(0.6, 0.08 * v, "highpass", 3000);
                    break;
                case "smg":
                    for (let i = 0; i < 5; i++) noise(0.07, 0.14 * v, "lowpass", 2400, i * 0.09, sfxBus, 300);
                    break;
                case "jetpack":
                    noise(0.7, 0.12 * v, "lowpass", 300, 0, sfxBus, 1400);
                    tone(80, 0.7, "sawtooth", 0.04 * v, 0, sfxBus, 160);
                    break;
                default:
                    break;
            }
        },
    };

    return {
        unlock,
        ready,
        context: () => ctx,
        radioBus: () => radio,
        noise,
        sfx,
        isSfxMuted: () => sfxMuted,
        setSfxMuted(muted) {
            sfxMuted = muted;
            writePref("playSfxMuted", muted ? "1" : "0");
            if (sfxBus) sfxBus.gain.setTargetAtTime(muted ? 0 : SFX_VOLUME, ctx.currentTime, 0.05);
        },
        isRadioMuted: () => radioMuted,
        setRadioMuted(muted) {
            radioMuted = muted;
            writePref("playRadioMuted", muted ? "1" : "0");
            if (radio) radio.gain.setTargetAtTime(muted ? 0 : RADIO_VOLUME, ctx.currentTime, 0.05);
        },
    };
}
