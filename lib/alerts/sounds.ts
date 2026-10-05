import type { AlertSound } from "@/lib/preferences";

interface Tone {
  frequency: number;
  start: number;
  duration: number;
  type: OscillatorType;
}

const patterns: Record<Exclude<AlertSound, "none">, Tone[]> = {
  chime: [
    { frequency: 880, start: 0, duration: 0.35, type: "sine" },
    { frequency: 1318.5, start: 0.14, duration: 0.5, type: "sine" },
  ],
  ping: [{ frequency: 1567.98, start: 0, duration: 0.3, type: "sine" }],
  bell: [
    { frequency: 659.25, start: 0, duration: 1.1, type: "triangle" },
    { frequency: 1318.5, start: 0, duration: 0.7, type: "sine" },
    { frequency: 1976, start: 0, duration: 0.4, type: "sine" },
  ],
  pulse: [
    { frequency: 740, start: 0, duration: 0.12, type: "square" },
    { frequency: 740, start: 0.18, duration: 0.12, type: "square" },
    { frequency: 740, start: 0.36, duration: 0.12, type: "square" },
  ],
  rise: [
    { frequency: 659.25, start: 0, duration: 0.18, type: "sine" },
    { frequency: 880, start: 0.12, duration: 0.18, type: "sine" },
    { frequency: 1174.66, start: 0.24, duration: 0.35, type: "sine" },
  ],
  fall: [
    { frequency: 1174.66, start: 0, duration: 0.18, type: "sine" },
    { frequency: 880, start: 0.12, duration: 0.18, type: "sine" },
    { frequency: 587.33, start: 0.24, duration: 0.4, type: "sine" },
  ],
};

let context: AudioContext | null = null;

export function playAlertSound(sound: AlertSound, volume: number) {
  if (sound === "none" || volume <= 0 || typeof window === "undefined") return;

  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime;
    const peak = (Math.min(100, volume) / 100) * (sound === "pulse" ? 0.12 : 0.3);

    for (const tone of patterns[sound]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.value = tone.frequency;
      gain.gain.setValueAtTime(0.0001, now + tone.start);
      gain.gain.exponentialRampToValueAtTime(peak, now + tone.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + tone.start);
      oscillator.stop(now + tone.start + tone.duration + 0.05);
    }
  } catch {}
}
