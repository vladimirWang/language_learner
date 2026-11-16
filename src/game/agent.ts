export type QuizLevel = "A1" | "A2";
export type QuizKind = "vocab" | "grammar";

export type QuizRequest = {
  level: QuizLevel;
  kind: QuizKind;
  count: number;
};

export type QuizQuestion = {
  id: string;
  topic: string;
  prompt: string;
  hint?: string | null;
  options: string[];
  answerIndex: number;
  explanation: string;
};

export type QuizBatch = {
  level: QuizLevel;
  kind: QuizKind;
  message: string;
  questions: QuizQuestion[];
};

export type ChatMessage =
  | {
      id: string;
      role: "user" | "agent";
      kind: "text";
      text: string;
      variant?: "error";
    }
  | {
      id: string;
      role: "agent";
      kind: "quiz";
      batch: QuizBatch;
    };

export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 10;

export const QUICK_ACTIONS: { request: QuizRequest; label: string; hint: string }[] = [
  {
    request: { level: "A1", kind: "grammar", count: DEFAULT_COUNT },
    label: "A1 语法题",
    hint: "冠词 · 复数 · 物主代词",
  },
  {
    request: { level: "A1", kind: "vocab", count: DEFAULT_COUNT },
    label: "A1 单词题",
    hint: "看中文选德语 / 看德语选中文",
  },
  {
    request: { level: "A2", kind: "grammar", count: DEFAULT_COUNT },
    label: "A2 语法题",
    hint: "支配格 · 动词变位",
  },
  {
    request: { level: "A2", kind: "vocab", count: DEFAULT_COUNT },
    label: "A2 单词题",
    hint: "核心词义四选一",
  },
];

/**
 * 本地规则路由：从一句话里解析出题参数，不调用任何模型。
 * 同时支持「再来 5 道」这类基于上一轮的追加请求。
 */
export function parseQuizIntent(
  text: string,
  last: QuizRequest | null,
): QuizRequest | null {
  const raw = text.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const repeat = /再来|再出|继续|换一组|more|again/.test(lower);
  const levelMatch = lower.match(/a\s*1|a\s*2/);
  const kind: QuizKind | null = /语法|grammar/.test(lower)
    ? "grammar"
    : /单词|词汇|生词|vocab|word/.test(lower)
      ? "vocab"
      : null;
  const countMatch = raw.match(/(\d+)\s*[道个题]/) ?? raw.match(/(?:来|出)\s*(\d+)/);
  const count = countMatch
    ? Math.min(MAX_COUNT, Math.max(1, Number(countMatch[1])))
    : null;

  if (repeat && last) {
    return { ...last, count: count ?? last.count };
  }

  if (!levelMatch && !kind) return null;

  const level = levelMatch
    ? (levelMatch[0].replace(/\s+/g, "").toUpperCase() as QuizLevel)
    : last?.level ?? "A1";

  return {
    level,
    kind: kind ?? last?.kind ?? "grammar",
    count: count ?? last?.count ?? DEFAULT_COUNT,
  };
}

export function describeRequest(request: QuizRequest): string {
  const kind = request.kind === "grammar" ? "语法" : "单词";
  return `给我出一些 ${request.level} 难度的${kind}题（${request.count} 道）`;
}
