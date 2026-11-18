// 关卡配置：从管理后台后端拉取，按难度分组展示与解锁。

const API_BASE = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env
  ?.VITE_API_BASE ?? "http://127.0.0.1:8080"

export type Difficulty = "A1" | "A2" | "B1" | "B2"

export const DIFFICULTIES: Difficulty[] = ["A1", "A2", "B1", "B2"]

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  A1: "入门",
  A2: "初级",
  B1: "中级",
  B2: "中高级",
}

export interface LevelExam {
  exam_id: string
  item_type: "listening" | "speaking"
  name?: string
  lang: string
  source_url: string
  sort_order: number
  created_at: string
}

export interface Level {
  id: number
  name: string
  lang: string
  difficulty: Difficulty
  description: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface LevelDetail {
  level: Level
  exams: LevelExam[]
}

interface LevelsResponse {
  levels: Level[]
}

interface LevelDetailResponse {
  level: Level
  exams: LevelExam[]
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } })
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
  return (await res.json()) as T
}

/** 拉取全部已生效的关卡（client 端只展示生效的关卡） */
export function fetchLevels(): Promise<Level[]> {
  return request<LevelsResponse>("/api/levels?active_only=true").then((r) => r.levels)
}

/** 拉取单个关卡详情（含关联内容；口语话题展开为逐题，便于闯关） */
export function fetchLevelDetail(id: number): Promise<LevelDetail> {
  return request<LevelDetailResponse>(`/api/levels/${id}?expand_speaking=1`)
}

/** 按难度分组关卡 */
export function groupByDifficulty(levels: Level[]): Record<Difficulty, Level[]> {
  const groups: Record<Difficulty, Level[]> = { A1: [], A2: [], B1: [], B2: [] }
  for (const lv of levels) {
    const d = (DIFFICULTIES.includes(lv.difficulty) ? lv.difficulty : "A1") as Difficulty
    groups[d].push(lv)
  }
  return groups
}
