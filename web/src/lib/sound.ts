// Alert tones generated with the Web Audio API (no audio asset needed).

export type AlertSoundKind = "take_profit" | "stop_loss";

let ctx: AudioContext | null = null;
let primed = false;

function getCtx(): AudioContext | null {
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/**
 * Browsers keep AudioContext suspended until a user gesture. Call once on
 * app mount: the first click/keypress unlocks audio for later beeps.
 */
export function primeAudio(): void {
  if (primed) return;
  primed = true;
  const unlock = () => {
    const ac = getCtx();
    if (ac && ac.state === "suspended") void ac.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function playNotes(notes: Array<[start: number, freq: number, dur: number]>, volume: number) {
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    void ac.resume().catch(() => {});
    if (ac.state === "suspended") return; // still locked: wait for a user gesture
  }
  const t0 = ac.currentTime;
  for (const [start, freq, dur] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur - 0.02);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur);
  }
}

/**
 * Distinct tones so the two alarms are recognizable without looking:
 * - take_profit: bright rising two-tone ("ding-ding", good news)
 * - stop_loss:   urgent descending three-tone (lower, more insistent)
 */
export function playAlertSound(kind: AlertSoundKind): void {
  if (kind === "take_profit") {
    playNotes(
      [
        [0, 880, 0.18],
        [0.18, 1245, 0.18],
      ],
      0.3
    );
  } else {
    playNotes(
      [
        [0, 988, 0.14],
        [0.15, 784, 0.14],
        [0.3, 622, 0.22],
      ],
      0.35
    );
  }
}
