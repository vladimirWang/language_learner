import { useEffect, useState } from "react";
import MapScreen from "./components/MapScreen";
import AgentChat from "./components/AgentChat";
import ListeningExamView from "./components/ListeningExamView";
import {
  emptyProgress,
  loadProgress,
  markLevelCompleted,
  saveProgress,
  type Progress,
} from "./game/progress";
import { fetchLevelDetail, fetchLevels, type Level, type LevelDetail } from "./game/levels";

type View = "map" | "agent" | "listening" | "level";

export default function App() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);
  const [levelsError, setLevelsError] = useState<string | null>(null);

  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [view, setView] = useState<View>("map");
  const [activeLevel, setActiveLevel] = useState<Level | null>(null);
  const [activeDetail, setActiveDetail] = useState<LevelDetail | null>(null);

  // 拉取关卡配置（启动时 + 手动刷新时调用）
  const loadLevels = () => {
    setLevelsLoading(true);
    setLevelsError(null);
    fetchLevels()
      .then((list) => setLevels(list))
      .catch((e) => setLevelsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLevelsLoading(false));
  };

  useEffect(() => {
    loadLevels();
  }, []);

  // 点击地图上的关卡 → 拉取详情并进入
  const handleSelectLevel = async (level: Level) => {
    try {
      const detail = await fetchLevelDetail(level.id);
      setActiveLevel(level);
      setActiveDetail(detail);
      setView("level");
    } catch (e) {
      alert("加载关卡失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  // 关卡所有 exam 完成 → 标记关卡完成，返回地图
  const handleLevelComplete = () => {
    if (!activeLevel) return;
    const next = markLevelCompleted(progress, activeLevel.id, 3);
    setProgress(next);
    saveProgress(next);
    setActiveLevel(null);
    setActiveDetail(null);
    setView("map");
  };

  const goMap = () => {
    setActiveLevel(null);
    setActiveDetail(null);
    setView("map");
  };

  const resetProgress = () => {
    if (!window.confirm("要清除所有关卡进度和星星，重新开始吗？")) return;
    const empty = emptyProgress();
    setProgress(empty);
    saveProgress(empty);
  };

  return (
    <div className="app">
      {view === "level" && activeLevel && activeDetail ? (
        <ListeningExamView
          level={activeLevel}
          exams={activeDetail.exams}
          onExit={goMap}
          onLevelComplete={handleLevelComplete}
        />
      ) : view === "listening" ? (
        <ListeningExamView onExit={() => setView("map")} />
      ) : view === "agent" ? (
        <AgentChat onExit={() => setView("map")} />
      ) : (
        <MapScreen
          levels={levels}
          progress={progress}
          loading={levelsLoading}
          onSelectLevel={handleSelectLevel}
          onRefresh={loadLevels}
          onOpenAgent={() => setView("agent")}
          onOpenListening={() => setView("listening")}
          onReset={resetProgress}
        />
      )}

      {levelsLoading && (
        <div style={{ position: "fixed", bottom: 16, left: 16, background: "rgba(0,0,0,.7)", color: "#fff", padding: "8px 14px", borderRadius: 8, fontSize: 13 }}>
          正在加载关卡配置…
        </div>
      )}
      {levelsError && (
        <div style={{ position: "fixed", bottom: 16, left: 16, background: "rgba(192,57,43,.9)", color: "#fff", padding: "8px 14px", borderRadius: 8, fontSize: 13 }}>
          关卡配置加载失败：{levelsError}
        </div>
      )}
    </div>
  );
}
