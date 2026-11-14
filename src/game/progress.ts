const STORAGE_KEY = "word-adventure-progress-v2";

export type Progress = {
  /** 已解锁的最高关卡下标（从 0 开始） */
  unlocked: number;
  /** 每关获得的星星数（1~3） */
  stars: Record<string, number>;
};

export const emptyProgress = (): Progress => ({ unlocked: 0, stars: {} });

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      unlocked: typeof parsed.unlocked === "number" ? parsed.unlocked : 0,
      stars: parsed.stars && typeof parsed.stars === "object" ? parsed.stars : {},
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // 本地存储不可用时静默降级，游戏本身仍可继续
  }
}

export function totalStars(progress: Progress): number {
  return Object.values(progress.stars).reduce((sum, n) => sum + n, 0);
}
