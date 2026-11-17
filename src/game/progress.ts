import type { Difficulty, Level } from "./levels"
import { DIFFICULTIES } from "./levels"

const STORAGE_KEY = "word-adventure-progress-v3"

export type Progress = {
  /** 已完成的关卡 ID 集合（level.id 字符串） */
  completed: Record<string, boolean>
  /** 每关获得的星星数（1~3） */
  stars: Record<string, number>
}

export const emptyProgress = (): Progress => ({ completed: {}, stars: {} })

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress()
    const parsed = JSON.parse(raw) as Partial<Progress>
    return {
      completed: parsed.completed && typeof parsed.completed === "object" ? parsed.completed : {},
      stars: parsed.stars && typeof parsed.stars === "object" ? parsed.stars : {},
    }
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 本地存储不可用时静默降级
  }
}

/** 标记关卡完成，返回新的 Progress */
export function markLevelCompleted(progress: Progress, levelId: number, stars = 1): Progress {
  const key = String(levelId)
  return {
    completed: { ...progress.completed, [key]: true },
    stars: { ...progress.stars, [key]: Math.max(progress.stars[key] ?? 0, stars) },
  }
}

export function isLevelCompleted(progress: Progress, levelId: number): boolean {
  return !!progress.completed[String(levelId)]
}

export function totalStars(progress: Progress): number {
  return Object.values(progress.stars).reduce((sum, n) => sum + n, 0)
}

/** 某难度的所有关卡是否都已完成 */
export function isDifficultyCompleted(
  progress: Progress,
  levels: Level[],
  difficulty: Difficulty,
): boolean {
  const diffLevels = levels.filter((lv) => lv.difficulty === difficulty)
  // 没有关卡不算完成，避免空难度误显示"全部完成"
  if (diffLevels.length === 0) return false
  return diffLevels.every((lv) => isLevelCompleted(progress, lv.id))
}

/**
 * 某难度是否解锁：
 * - A1 始终解锁
 * - 更高级别需要前一难度的所有关卡都完成
 */
export function isDifficultyUnlocked(
  progress: Progress,
  levels: Level[],
  difficulty: Difficulty,
): boolean {
  const idx = DIFFICULTIES.indexOf(difficulty)
  if (idx <= 0) return true
  const prev = DIFFICULTIES[idx - 1]
  return isDifficultyCompleted(progress, levels, prev)
}

/** 某关卡是否可玩（所属难度已解锁） */
export function isLevelPlayable(
  progress: Progress,
  levels: Level[],
  level: Level,
): boolean {
  return isDifficultyUnlocked(progress, levels, level.difficulty)
}
