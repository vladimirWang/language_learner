// 德专四级（PGG）结构化试题：试卷、客观题、听写、写作与原文素材。

const API_BASE = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env
  ?.VITE_API_BASE ?? "http://127.0.0.1:8080"

export type ExamSection = "hoeren" | "lesen" | "grammar" | "diktat" | "writing" | "unknown"

export const EXAM_SECTION_LABELS: Record<string, string> = {
  hoeren: "听力理解",
  lesen: "阅读理解",
  grammar: "语法与词汇",
  diktat: "听写",
  writing: "书面表达",
  unknown: "未分类",
}

/** 客观题题型（可自动判分）。 */
export const OBJECTIVE_SECTIONS: ExamSection[] = ["hoeren", "lesen", "grammar"]

export const EXAM_SECTION_ORDER: ExamSection[] = [
  "hoeren",
  "lesen",
  "grammar",
  "diktat",
  "writing",
]

export interface ExamPaper {
  paper_id: string
  exam_system: string
  level: string
  year: number
  title: string
  source_note: string
  question_count: number
  sections: string[]
  source_job_id: string
}

export interface ExamQuestion {
  paper_id: string
  exam_system: string
  section: string
  q_no: string
  stem: string
  options: string[]
  level: string
}

export interface ExamDiktat {
  paper_id: string
  full_text: string
  word_count: number
  audio_ref?: string
}

export interface ExamWriting {
  paper_id: string
  prompt: string
  word_limit?: number
  material_ref?: string
}

export interface ExamMaterial {
  page_no: number
  paper_id?: string
  section: string
  raw_text: string
}

export interface ExamAnswerResult {
  is_correct: boolean | null
  correct_answer: string | null
  message?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  })
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

/** 拉取已解析的 PGG 试卷列表。 */
export function fetchExamPapers(): Promise<ExamPaper[]> {
  return request<{ papers: ExamPaper[] }>("/api/exam/papers?system=pgg").then((r) => r.papers)
}

/** 拉取某套卷某题型的客观题（不含答案）。 */
export function fetchExamQuestions(paperId: string, section: string): Promise<ExamQuestion[]> {
  const query = new URLSearchParams({ section })
  return request<{ questions: ExamQuestion[] }>(
    `/api/exam/paper/${encodeURIComponent(paperId)}/questions?${query.toString()}`,
  ).then((r) => r.questions)
}

/** 拉取某套卷的听写原文。 */
export function fetchExamDiktat(paperId: string): Promise<ExamDiktat[]> {
  return request<{ diktat: ExamDiktat[] }>(
    `/api/exam/paper/${encodeURIComponent(paperId)}/diktat`,
  ).then((r) => r.diktat)
}

/** 拉取某套卷的写作题干。 */
export function fetchExamWriting(paperId: string): Promise<ExamWriting[]> {
  return request<{ writing: ExamWriting[] }>(
    `/api/exam/paper/${encodeURIComponent(paperId)}/writing`,
  ).then((r) => r.writing)
}

/** 拉取某套卷某题型的原文素材，供讲解定位。 */
export function fetchExamMaterial(paperId: string, section: string): Promise<ExamMaterial[]> {
  const query = new URLSearchParams({ paper_id: paperId, section })
  return request<{ materials: ExamMaterial[] }>(`/api/exam/material?${query.toString()}`).then(
    (r) => r.materials,
  )
}

/** 提交客观题答案，由服务端查真值库判分。 */
export function submitExamAnswer(
  paperId: string,
  section: string,
  qNo: string,
  answer: string,
): Promise<ExamAnswerResult> {
  return request<ExamAnswerResult>("/api/exam/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_id: paperId, section, q_no: qNo, answer }),
  })
}
