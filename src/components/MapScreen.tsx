import { useEffect, useMemo } from "react"
import type { Level } from "../game/levels"
import { DIFFICULTIES, DIFFICULTY_LABELS, groupByDifficulty, type Difficulty } from "../game/levels"
import {
  isDifficultyCompleted,
  isDifficultyUnlocked,
  isLevelCompleted,
  isLevelPlayable,
  totalStars,
  type Progress,
} from "../game/progress"
import MaterialUpdate from "./MaterialUpdate"
import { CheckIcon, LockIcon, SparkleIcon } from "./icons"
import { sfx } from "../game/audio"

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  A1: "#4FBF58",
  A2: "#2F86D6",
  B1: "#FF8A3D",
  B2: "#F2588E",
}

type Props = {
  levels: Level[]
  progress: Progress
  loading?: boolean
  onSelectLevel: (level: Level) => void
  onRefresh?: () => void
  onOpenAgent: () => void
  onReset: () => void
}

export default function MapScreen({
  levels,
  progress,
  loading,
  onSelectLevel,
  onRefresh,
  onOpenAgent,
  onReset,
}: Props) {
  const groups = useMemo(() => groupByDifficulty(levels), [levels])
  const stars = totalStars(progress)
  const totalLevels = levels.length

  // 进入地图时滚动到顶部
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" })
  }, [])

  const handleSelect = (level: Level) => {
    if (!isLevelPlayable(progress, levels, level)) return
    sfx.tap()
    onSelectLevel(level)
  }

  return (
    <div className="map-screen">
      <header className="map-header">
        <div className="brand">
          <h1 className="brand-title">综合练习</h1>
          <p className="brand-sub">听力 + 口语闯关，完成低难度全部关卡解锁下一难度</p>
        </div>
        <div className="header-actions">
          {onRefresh && (
            <button
              className="agent-entry"
              onClick={onRefresh}
              disabled={loading}
              title="刷新关卡配置"
              style={{ opacity: loading ? 0.5 : 1 }}
            >
              {loading ? "刷新中…" : "🔄 刷新"}
            </button>
          )}
          <MaterialUpdate />
          <button className="agent-entry" onClick={onOpenAgent}>
            <SparkleIcon size={16} color="#fff" />
            Agent 练习
          </button>
          <div className="star-pill" title="已收集的星星">
            <span className="star-glyph">★</span>
            <span>
              {stars} <i>/ {totalLevels * 3}</i>
            </span>
          </div>
          <button className="reset-btn" onClick={onReset}>
            重置进度
          </button>
        </div>
      </header>

      <div className="map-viewport">
        <div className="map-canvas" style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 60px" }}>
          {DIFFICULTIES.map((diff) => {
            const diffLevels = groups[diff]
            const unlocked = isDifficultyUnlocked(progress, levels, diff)
            const completed = isDifficultyCompleted(progress, levels, diff)
            const color = DIFFICULTY_COLORS[diff]

            return (
              <section key={diff} className={`difficulty-section ${unlocked ? "" : "locked"}`}>
                <div className="difficulty-header" style={{ borderColor: color }}>
                  <div className="difficulty-title" style={{ color }}>
                    <span className="diff-badge" style={{ background: color }}>
                      {diff}
                    </span>
                    <span className="diff-name">{DIFFICULTY_LABELS[diff]}</span>
                    {completed && (
                      <span className="diff-done">
                        <CheckIcon size={14} /> 全部完成
                      </span>
                    )}
                  </div>
                  {!unlocked && (
                    <div className="difficulty-lock">
                      <LockIcon size={18} />
                      <span>完成 {DIFFICULTIES[DIFFICULTIES.indexOf(diff) - 1]} 全部关卡后解锁</span>
                    </div>
                  )}
                </div>

                {diffLevels.length === 0 ? (
                  <div className="difficulty-empty">
                    <p style={{ color: "#999", fontSize: 14 }}>该难度暂无关卡，请在管理后台配置</p>
                  </div>
                ) : (
                  <div className="level-grid">
                    {diffLevels.map((lv) => {
                      const done = isLevelCompleted(progress, lv.id)
                      const playable = isLevelPlayable(progress, levels, lv)
                      const earned = progress.stars[String(lv.id)] ?? 0
                      return (
                        <button
                          key={lv.id}
                          className={`level-card ${done ? "completed" : ""} ${playable ? "" : "locked"}`}
                          style={{ ["--accent" as string]: color }}
                          onClick={() => handleSelect(lv)}
                          disabled={!playable}
                        >
                          <div className="level-card-body">
                            <div className="level-card-name">{lv.name}</div>
                            {lv.description && (
                              <div className="level-card-desc">{lv.description}</div>
                            )}
                          </div>
                          <div className="level-card-footer">
                            {done ? (
                              <span className="level-stars">
                                {[1, 2, 3].map((n) => (
                                  <span key={n} className={n <= earned ? "star on" : "star"}>
                                    {n <= earned ? "★" : "☆"}
                                  </span>
                                ))}
                              </span>
                            ) : playable ? (
                              <span className="level-go">开始 →</span>
                            ) : (
                              <span className="level-lock-text">
                                <LockIcon size={14} /> 未解锁
                              </span>
                            )}
                          </div>
                          {done && (
                            <span className="level-check">
                              <CheckIcon size={16} />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
