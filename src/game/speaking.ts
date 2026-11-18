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

/** 脚本模式的轻量批改：只做要点覆盖与基本书写规范检查，不作为评分。 */
export function evaluateAnswer(item: SpeakingItem, answer: string): SpeakingFeedback {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const points = parsePoints(item.expected_points)
  const covered = points.filter((p) => lower.includes(p.toLowerCase()))
  const missing = points.filter((p) => !lower.includes(p.toLowerCase()))
  return {
    covered,
    missing,
    tooShort: text.length < 8,
    startsUpper: !!text && text[0] === text[0].toUpperCase(),
    endsPunct: /[.!?]$/.test(text),
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

/** 请求下一句考官追问或搭档回应；失败时返回空串由调用方兜底。 */
export async function fetchSpeakingReply(params: SpeakingReplyParams): Promise<string> {
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
        history: params.history.slice(-8),
        followup_count: params.followupCount,
        prompt_de: params.promptDE,
      }),
    })
    if (!res.ok) return ""
    const body = (await res.json()) as { reply?: string }
    return (body.reply ?? "").trim()
  } catch {
    return ""
  }
}

// ---------------------------------------------------------------------------
// 会话报告（仅存本地，不上传）
// ---------------------------------------------------------------------------

const SESSION_KEY = "speaking.sessions.v1"

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
