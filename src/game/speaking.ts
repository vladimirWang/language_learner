// 口语题库：由后端下发，client 端按等级以脚本模式练习。

const API_BASE = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env
  ?.VITE_API_BASE ?? "http://127.0.0.1:8080"

export type SpeakingLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2"

export const SPEAKING_LEVELS: SpeakingLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"]

export interface SpeakingItem {
  item_key: string
  lang: string
  level: SpeakingLevel
  exam_part: string
  topic: string
  role: string
  prompt_de: string
  prompt_zh: string
  expected_points: string
  ref_answer: string
  error_note: string
  sort_order: number
  active: boolean
}

interface SpeakingItemsResponse {
  items: SpeakingItem[]
}

export interface SpeakingFeedback {
  /** 已覆盖的要点 */
  covered: string[]
  /** 未覆盖的要点 */
  missing: string[]
  /** 回答是否明显过短 */
  tooShort: boolean
  /** 是否句首大写 */
  startsUpper: boolean
  /** 是否有句末标点 */
  endsPunct: boolean
  /** 是否与当前话题和要点毫无重合（疑似跑题） */
  offTopic: boolean
}

/** 各部分的建议时长（秒）；到时自动推进到下一部分。 */
export const PART_TIME_LIMIT_SEC: Record<string, number> = {
  part1_intro: 240,
  part2_presentation: 180,
  part3_discussion: 240,
}

const TOPIC_STOPWORDS = new Set([
  "aber", "alle", "auch", "beim", "bitte", "dann", "dass", "dein", "dem", "den",
  "der", "die", "dies", "doch", "dort", "eine", "einen", "einer", "eines", "eure",
  "für", "geht", "gern", "gerne", "habe", "haben", "hast", "ihre", "immer", "kann",
  "kein", "keine", "können", "mich", "mir", "mit", "nach", "nicht", "noch", "oder",
  "ohne", "schon", "sehr", "sein", "sich", "sie", "sind", "über", "und", "unter",
  "viel", "vom", "von", "was", "wenn", "wer", "wie", "wird", "wir", "wohl", "zum",
  "zur",
])

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-zäöüß]{4,}/g) ?? []
  return new Set(words.filter((w) => !TOPIC_STOPWORDS.has(w)))
}

/** 脚本模式的轻量批改：只做要点覆盖与基本书写规范检查，不作为评分。 */
export function evaluateAnswer(item: SpeakingItem, answer: string): SpeakingFeedback {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const points = parsePoints(item.expected_points)
  const covered = points.filter((p) => lower.includes(p.toLowerCase()))
  const missing = points.filter((p) => !lower.includes(p.toLowerCase()))

  const answerWords = contentWords(text)
  const topicWords = contentWords(
    `${item.topic} ${item.prompt_de} ${points.join(" ")}`,
  )
  let overlap = 0
  for (const word of answerWords) {
    if (topicWords.has(word)) overlap += 1
  }
  const offTopic = answerWords.size >= 4 && overlap === 0

  return {
    covered,
    missing,
    tooShort: text.length < 8,
    startsUpper: !!text && text[0] === text[0].toUpperCase(),
    endsPunct: /[.!?]$/.test(text),
    offTopic,
  }
}

/** 用系统语音朗读德语；不支持时静默降级。 */
export function speakGerman(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = "de-DE"
    utterance.rate = 0.95
    window.speechSynthesis.speak(utterance)
  } catch {
    // 忽略：TTS 不可用不影响练习
  }
}

const PART_LABELS: Record<string, string> = {
  part1_intro: "第一部分 · 自我介绍与问答",
  part2_presentation: "第二部分 · 主题陈述",
  part3_discussion: "第三部分 · 双人讨论",
}

export function partLabel(part: string): string {
  return PART_LABELS[part] ?? part
}

/** 解析 expected_points JSON；格式异常时返回空数组而不是抛错。 */
export function parsePoints(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

export function fetchSpeakingItems(params?: {
  lang?: string
  level?: string
}): Promise<SpeakingItem[]> {
  const query = new URLSearchParams()
  query.set("lang", params?.lang ?? "de")
  if (params?.level) query.set("level", params.level)
  return fetch(`${API_BASE}/api/speaking/items?${query.toString()}`, {
    headers: { Accept: "application/json" },
  }).then(async (res) => {
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body?.error) msg = body.error
      } catch {
        // ignore
      }
      throw new Error(msg)
    }
    const body = (await res.json()) as SpeakingItemsResponse
    return body.items ?? []
  })
}

// ---------------------------------------------------------------------------
// 本地练习记录（仅存本地，不上传）
// ---------------------------------------------------------------------------

const STORAGE_KEY = "speaking.progress.v1"

export interface SpeakingProgress {
  /** 已完成练习的 item_key 集合 */
  completed: string[]
}

export function loadSpeakingProgress(): SpeakingProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { completed: [] }
    const parsed = JSON.parse(raw) as Partial<SpeakingProgress>
    return { completed: Array.isArray(parsed.completed) ? parsed.completed : [] }
  } catch {
    return { completed: [] }
  }
}

export function saveSpeakingProgress(progress: SpeakingProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 本地存储不可用时忽略
  }
}

// ---------------------------------------------------------------------------
// 受控追问 / 搭档回应（后端优先 LLM，异常回退模板）
// ---------------------------------------------------------------------------

export interface SpeakingTurn {
  role: "user" | "examiner" | "partner"
  text: string
}

export interface SpeakingReplyParams {
  level: string
  examPart: string
  topic: string
  role: "examiner" | "partner"
  history: SpeakingTurn[]
  followupCount: number
  promptDE: string
}

export interface SpeakingReplyResult {
  reply: string
  source: "llm" | "template"
}

/** 请求下一句考官追问或搭档回应；失败时返回空串由调用方兜底。 */
export async function fetchSpeakingReply(
  params: SpeakingReplyParams,
): Promise<SpeakingReplyResult> {
  try {
    const res = await fetch(`${API_BASE}/api/speaking/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        lang: "de",
        level: params.level,
        exam_part: params.examPart,
        topic: params.topic,
        role: params.role,
        history: params.history,
        followup_count: params.followupCount,
        prompt_de: params.promptDE,
      }),
    })
    if (!res.ok) return { reply: "", source: "template" }
    const body = (await res.json()) as { reply?: string; source?: string }
    return {
      reply: (body.reply ?? "").trim(),
      source: body.source === "llm" ? "llm" : "template",
    }
  } catch {
    return { reply: "", source: "template" }
  }
}

// ---------------------------------------------------------------------------
// 会话报告（仅存本地，不上传）
// ---------------------------------------------------------------------------

const SESSION_KEY = "speaking.sessions.v1"

export interface SpeakingItemResult {
  item_key: string
  prompt_de: string
  covered: string[]
  missing: string[]
  turns: number
  avg_response_ms: number
}

export interface SpeakingSessionReport {
  id: string
  level: string
  started_at: string
  ended_at: string
  duration_sec: number
  parts: string[]
  turn_count: number
  items_total: number
  items_completed: number
  points_total: number
  points_covered: number
  missing_points: string[]
  suggested_review: string
  /** 流利度：平均/最长响应耗时（毫秒）、重复词占比与估算语速（词/分钟） */
  avg_response_ms: number
  max_response_ms: number
  repetition_ratio: number
  words_per_min: number
  /** 逐题反馈 */
  items: SpeakingItemResult[]
}

export function loadSpeakingSessions(): SpeakingSessionReport[] {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SpeakingSessionReport[]) : []
  } catch {
    return []
  }
}

export function saveSpeakingSession(report: SpeakingSessionReport): void {
  try {
    const list = [report, ...loadSpeakingSessions()].slice(0, 20)
    localStorage.setItem(SESSION_KEY, JSON.stringify(list))
  } catch {
    // 本地存储不可用时忽略
  }
}

// ---------------------------------------------------------------------------
// 错题沉淀：记录反复遗漏的要点，供下次练习前复习
// ---------------------------------------------------------------------------

const ERROR_KEY = "speaking.errors.v1"

export interface SpeakingErrorEntry {
  item_key: string
  level: string
  topic: string
  prompt_de: string
  missing_points: string[]
  created_at: string
}

export function loadSpeakingErrors(): SpeakingErrorEntry[] {
  try {
    const raw = localStorage.getItem(ERROR_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SpeakingErrorEntry[]) : []
  } catch {
    return []
  }
}

/** 追加一条错题记录（同题覆盖旧记录），最多保留 100 条。 */
export function saveSpeakingError(entry: SpeakingErrorEntry): void {
  try {
    const list = [entry, ...loadSpeakingErrors().filter((e) => e.item_key !== entry.item_key)]
    localStorage.setItem(ERROR_KEY, JSON.stringify(list.slice(0, 100)))
  } catch {
    // 本地存储不可用时忽略
  }
}

/** 汇总历史遗漏要点，按出现次数从高到低返回。 */
export function topMissingPoints(limit = 5): { point: string; count: number }[] {
  const counter = new Map<string, number>()
  for (const entry of loadSpeakingErrors()) {
    for (const point of entry.missing_points) {
      counter.set(point, (counter.get(point) ?? 0) + 1)
    }
  }
  return [...counter.entries()]
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// 报告导出（Markdown）
// ---------------------------------------------------------------------------

export function reportToMarkdown(report: SpeakingSessionReport): string {
  const coverage =
    report.points_total > 0
      ? Math.round((report.points_covered / report.points_total) * 100)
      : 0;
  const lines = [
    `# 口语练习报告（${report.level}）`,
    "",
    `- 开始时间：${new Date(report.started_at).toLocaleString("zh-CN")}`,
    `- 结束时间：${new Date(report.ended_at).toLocaleString("zh-CN")}`,
    `- 练习时长：${report.duration_sec} 秒`,
    `- 回答轮次：${report.turn_count}`,
    `- 完成题目：${report.items_completed}/${report.items_total}`,
    `- 要点覆盖率：${coverage}%（${report.points_covered}/${report.points_total}）`,
    `- 平均响应耗时：${(report.avg_response_ms / 1000).toFixed(1)} 秒`,
    `- 最长响应耗时：${(report.max_response_ms / 1000).toFixed(1)} 秒`,
    `- 重复词占比：${Math.round(report.repetition_ratio * 100)}%`,
    `- 估算语速：${report.words_per_min ?? 0} 词/分钟`,
    "",
  ];
  const itemResults = report.items ?? [];
  if (itemResults.length > 0) {
    lines.push("## 逐题反馈", "");
    for (const item of itemResults) {
      const covered = item.covered.length;
      const total = covered + item.missing.length;
      lines.push(`### ${item.prompt_de}`);
      lines.push("");
      lines.push(`- 要点覆盖：${covered}/${total}`);
      if (item.missing.length > 0) {
        lines.push(`- 遗漏：${item.missing.join(" / ")}`);
      }
      lines.push(`- 回答轮次：${item.turns}`);
      lines.push("");
    }
  }
  if (report.missing_points.length > 0) {
    lines.push("## 高频遗漏要点", "", ...report.missing_points.map((p) => `- ${p}`), "");
  }
  lines.push("## 建议", "", report.suggested_review, "");
  lines.push("> 机器批改仅用于练习辅助，不能替代歌德官方人工口试。");
  return lines.join("\n");
}
