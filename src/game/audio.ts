let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  startAt: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.05,
) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime + startAt;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sfx = {
  tap() {
    tone(660, 0, 0.08, "triangle", 0.035);
  },
  correct() {
    tone(659.25, 0, 0.16, "triangle", 0.05);
    tone(830.61, 0.1, 0.22, "triangle", 0.05);
  },
  wrong() {
    tone(196, 0, 0.16, "sawtooth", 0.03);
    tone(164.81, 0.09, 0.22, "sawtooth", 0.03);
  },
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, i * 0.11, 0.32, "triangle", 0.05),
    );
  },
};

/** 朗读英文单词，使用系统语音；不支持时静默降级 */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.78;
    utterance.pitch = 1.12;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(
        (v) =>
          /^en[-_](US|GB)/i.test(v.lang) &&
          /Samantha|Google|Microsoft|Serena/i.test(v.name),
      ) ?? voices.find((v) => /^en[-_]/i.test(v.lang));
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  } catch {
    // 忽略语音失败
  }
}
