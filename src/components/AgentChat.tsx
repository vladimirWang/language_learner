import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  QUICK_ACTIONS,
  describeRequest,
  parseQuizIntent,
  type ChatMessage,
  type QuizBatch,
  type QuizRequest,
} from "../game/agent";
import AgentQuiz from "./AgentQuiz";
import MaterialUpdate from "./MaterialUpdate";
import { ArrowLeftIcon, SparkleIcon } from "./icons";

type Props = {
  onExit: () => void;
};

let messageSeq = 0;
const nextId = () => `agent-msg-${(messageSeq += 1)}`;

const GREETING =
  "你好，我是德语学习 Agent。我不靠模型编答案：题目和答案键都来自本地真值库（ground_truth.db）。\n" +
  "可以直接点下面的按钮，也可以打字，例如「给我出一些 A1 难度的语法题」「再来 5 道」。";

const HELP =
  "我可以出这些题：\n" +
  "· A1 / A2 语法题：定冠词、名词复数、动词支配格、物主代词、动词变位\n" +
  "· A1 / A2 单词题：德语 ↔ 中文四选一\n" +
  "说法示例：「给我出一些 A2 难度的单词题」「再来 5 道」";

export default function AgentChat({ onExit }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), role: "agent", kind: "text", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastRequest, setLastRequest] = useState<QuizRequest | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);

  const pushText = (role: "user" | "agent", text: string, variant?: "error") => {
    setMessages((prev) => [...prev, { id: nextId(), role, kind: "text", text, variant }]);
  };

  const runQuiz = async (request: QuizRequest) => {
    if (!isTauri()) {
      pushText(
        "agent",
        "浏览器预览里无法读取本地真值库，请用 Word Adventure 桌面应用打开 Agent 页面。",
        "error",
      );
      return;
    }

    setBusy(true);
    try {
      const batch = await invoke<QuizBatch>("generate_quiz", { request });
      setLastRequest(request);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "agent", kind: "text", text: batch.message },
        { id: nextId(), role: "agent", kind: "quiz", batch },
      ]);
    } catch (error) {
      const reason =
        typeof error === "string" ? error : error instanceof Error ? error.message : "";
      pushText("agent", reason ? `出题失败：${reason}` : "出题失败，请稍后重试。", "error");
    } finally {
      setBusy(false);
    }
  };

  const send = (text: string, explicit?: QuizRequest) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const request = explicit ?? parseQuizIntent(trimmed, lastRequest);
    pushText("user", trimmed);
    setInput("");

    if (!request) {
      pushText("agent", HELP);
      return;
    }
    void runQuiz(request);
  };

  const askQuick = (request: QuizRequest) => {
    send(describeRequest(request), request);
  };

  return (
    <div className="agent-screen">
      <header className="agent-header">
        <button className="back-btn" onClick={onExit}>
          <ArrowLeftIcon size={18} />
          地图
        </button>
        <div className="agent-brand">
          <span className="agent-avatar" aria-hidden="true">
            <SparkleIcon size={20} color="#fff" />
          </span>
          <div>
            <h1>德语学习 Agent</h1>
            <p>本地真值库出题 · 离线可用 · 答案有据可查</p>
          </div>
        </div>
        <span className="agent-lang-chip">仅德语 · A1 / A2</span>
        <MaterialUpdate />
      </header>

      <div className="agent-body">
        <div className="agent-log" ref={logRef}>
          {messages.map((message) =>
            message.kind === "text" ? (
              <div
                key={message.id}
                className={`agent-row ${message.role} ${message.variant === "error" ? "error" : ""}`}
              >
                {message.role === "agent" && (
                  <span className="agent-mini-avatar" aria-hidden="true">
                    A
                  </span>
                )}
                <div className={`agent-bubble ${message.role}`}>{message.text}</div>
              </div>
            ) : (
              <div key={message.id} className="agent-row agent quiz">
                <div className="agent-quiz-wrap">
                  <AgentQuiz
                    batch={message.batch}
                    onRepeat={() => {
                      const request = lastRequest ?? {
                        level: message.batch.level,
                        kind: message.batch.kind,
                        count: message.batch.questions.length || 5,
                      };
                      askQuick(request);
                    }}
                  />
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className="agent-row agent">
              <span className="agent-mini-avatar" aria-hidden="true">
                A
              </span>
              <div className="agent-bubble agent typing">正在真值库里出题…</div>
            </div>
          )}
        </div>

        <div className="agent-composer">
          <div className="agent-quick">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                className="agent-quick-btn"
                onClick={() => askQuick(action.request)}
                disabled={busy}
              >
                <strong>{action.label}</strong>
                <span>{action.hint}</span>
              </button>
            ))}
          </div>

          <form
            className="agent-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <input
              className="agent-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：给我出一些 A1 难度的语法题 / 再来 5 道"
              disabled={busy}
              maxLength={120}
              autoComplete="off"
            />
            <button
              className="btn primary"
              type="submit"
              disabled={busy || !input.trim()}
            >
              发送
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
