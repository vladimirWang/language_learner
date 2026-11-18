import { useEffect, useRef, useState, type CSSProperties } from "react";
import { transcribeSpeakingAudio } from "../game/speaking";

const MODE_KEY = "speaking.input.mode";
/** 单次录音上限，避免音频过长导致上传与识别过慢。 */
const MAX_RECORD_SEC = 60;

type Mode = "text" | "voice";

type Recorder = {
  /** 停止录音并返回 WAV 音频；没有采集到数据时返回 null。 */
  stop: () => Promise<Blob | null>;
  /** 放弃本次录音，不产生音频。 */
  cancel: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  /** 录音语种（如 de），用于约束语音识别结果的语言 */
  lang?: string;
};

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** 把浮点采样编码为 16bit 单声道 WAV，服务端语音识别可直接使用。 */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

async function startRecorder(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前环境不支持麦克风录音");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("当前环境不支持音频处理");
  }
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: 16000 });
  } catch {
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* 用户手势内通常会成功，失败则继续尝试录音 */
    }
  }
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
    } catch {
      /* 已断开 */
    }
    try {
      source.disconnect();
    } catch {
      /* 已断开 */
    }
    stream.getTracks().forEach((track) => track.stop());
    void ctx.close().catch(() => undefined);
  };

  return {
    stop: async () => {
      const sampleRate = ctx.sampleRate;
      cleanup();
      if (chunks.length === 0) return null;
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return encodeWav(merged, sampleRate);
    },
    cancel: cleanup,
  };
}

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "麦克风权限被拒绝，请在系统设置中允许本应用使用麦克风";
    }
    if (error.name === "NotFoundError") {
      return "未检测到麦克风设备";
    }
  }
  return error instanceof Error ? error.message : "无法启动录音";
}

function formatSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/**
 * 口语回答输入框：可在文字输入与语音输入之间实时切换。
 * 语音模式下先录音、再转写，识别结果写入同一个输入框，允许修改后提交。
 */
export default function VoiceAnswerInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  rows = 3,
  placeholder,
  lang = "de",
}: Props) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "voice" ? "voice" : "text";
    } catch {
      return "text";
    }
  });
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<Recorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stopTimers = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  };

  const finishRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    stopTimers();
    setRecording(false);
    setElapsed(0);
    let blob: Blob | null = null;
    try {
      blob = await recorder.stop();
    } catch {
      blob = null;
    }
    if (!blob) {
      setError("没有录到声音，请重试");
      return;
    }
    setTranscribing(true);
    setError(null);
    try {
      const text = await transcribeSpeakingAudio(blob, lang);
      if (!text) {
        setError("没有识别到语音，请再说一次");
        return;
      }
      const current = valueRef.current.trim();
      onChange(current ? `${current} ${text}` : text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "语音识别失败");
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async () => {
    if (disabled || transcribing || recording) return;
    setError(null);
    setElapsed(0);
    // 停止正在朗读的考官语音，避免被麦克风录进去。
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    try {
      const recorder = await startRecorder();
      recorderRef.current = recorder;
      setRecording(true);
      tickRef.current = window.setInterval(() => setElapsed((sec) => sec + 1), 1000);
      autoStopRef.current = window.setTimeout(() => {
        void finishRecording();
      }, MAX_RECORD_SEC * 1000);
    } catch (e) {
      setError(micErrorMessage(e));
    }
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (recorderRef.current) {
      // 切换输入方式时放弃进行中的录音，避免突然填入识别结果。
      recorderRef.current.cancel();
      recorderRef.current = null;
      stopTimers();
      setRecording(false);
      setElapsed(0);
    }
    setError(null);
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* 隐私模式下不可写，忽略 */
    }
  };

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
    },
    [],
  );

  const tabStyle = (active: boolean): CSSProperties => ({
    border: "none",
    borderRadius: 999,
    padding: "5px 14px",
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    background: active ? "#fff" : "transparent",
    color: active ? "#5b4a36" : "#8a7d6b",
    boxShadow: active ? "0 1px 4px rgba(160,125,85,.25)" : "none",
    fontFamily: "inherit",
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: "#F1EADF", borderRadius: 999, padding: 3 }}>
          <button style={tabStyle(mode === "text")} onClick={() => switchMode("text")} disabled={disabled}>
            ⌨ 文字输入
          </button>
          <button style={tabStyle(mode === "voice")} onClick={() => switchMode("voice")} disabled={disabled}>
            🎤 语音输入
          </button>
        </div>
        {mode === "text" && (
          <span style={{ fontSize: 12, color: "#a99a86" }}>回车提交，Shift+回车换行</span>
        )}
      </div>

      {mode === "voice" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className="btn primary"
            onClick={() => {
              if (recording) void finishRecording();
              else void startRecording();
            }}
            disabled={disabled || transcribing}
            style={
              recording
                ? { background: "#C0392B", borderColor: "#C0392B", color: "#fff" }
                : undefined
            }
          >
            {recording ? "■ 停止并识别" : transcribing ? "识别中…" : "🎤 按下开始说话"}
          </button>
          {recording && (
            <span style={{ color: "#C0392B", fontSize: 13 }}>● 录音中 {formatSec(elapsed)}</span>
          )}
          {transcribing && <span style={{ color: "#8a7d6b", fontSize: 13 }}>正在识别语音…</span>}
          {!recording && !transcribing && (
            <span style={{ color: "#a99a86", fontSize: 12 }}>
              最长 {MAX_RECORD_SEC} 秒，识别结果可修改后再提交
            </span>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 8, color: "#C0392B", fontSize: 13 }}>{error}</div>}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={
          mode === "voice"
            ? "语音识别结果会填到这里，可直接修改…"
            : placeholder ?? "用德语输入你的回答，回车提交，Shift+回车换行…"
        }
        disabled={disabled || transcribing}
        rows={rows}
        style={{
          width: "100%",
          marginTop: 10,
          padding: 12,
          borderRadius: 10,
          border: "1px solid #e6dccb",
          fontFamily: "inherit",
          fontSize: 15,
          resize: "vertical",
          background: disabled ? "#FAF7F0" : "#fff",
        }}
      />
    </div>
  );
}
