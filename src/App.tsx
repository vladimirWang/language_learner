import { useRef, useState } from "react";
import MapScreen from "./components/MapScreen";
import LevelPlay from "./components/LevelPlay";
import { COURSES } from "./game/courses";
import {
  emptyProgress,
  loadProgress,
  saveProgress,
  type Progress,
} from "./game/progress";

export default function App() {
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [freshIndex, setFreshIndex] = useState<number | null>(null);
  const [pendingFresh, setPendingFresh] = useState<number | null>(null);
  const freshTimer = useRef<number | null>(null);

  const handleComplete = (index: number, stars: number) => {
    const lastIndex = COURSES.length - 1;
    const newlyUnlocked = index < lastIndex && progress.unlocked <= index;
    const next: Progress = {
      unlocked:
        index >= lastIndex ? progress.unlocked : Math.max(progress.unlocked, index + 1),
      stars: {
        ...progress.stars,
        [COURSES[index].id]: Math.max(progress.stars[COURSES[index].id] ?? 0, stars),
      },
    };
    setProgress(next);
    saveProgress(next);
    if (newlyUnlocked) setPendingFresh(index + 1);
  };

  const goMap = () => {
    setActiveIndex(null);
    if (pendingFresh !== null) {
      if (freshTimer.current) window.clearTimeout(freshTimer.current);
      setFreshIndex(pendingFresh);
      setPendingFresh(null);
      freshTimer.current = window.setTimeout(() => setFreshIndex(null), 2600);
    }
  };

  const goNext = (index: number) => {
    setPendingFresh(null);
    setActiveIndex(index);
  };

  const resetProgress = () => {
    if (!window.confirm("要清除所有关卡进度和星星，从第一关重新开始吗？")) return;
    const empty = emptyProgress();
    setProgress(empty);
    saveProgress(empty);
    setPendingFresh(null);
    setFreshIndex(null);
  };

  return (
    <div className="app">
      {activeIndex === null ? (
        <MapScreen
          progress={progress}
          freshIndex={freshIndex}
          onSelect={setActiveIndex}
          onReset={resetProgress}
        />
      ) : (
        <LevelPlay
          key={activeIndex}
          index={activeIndex}
          onExit={goMap}
          onComplete={handleComplete}
          onNext={goNext}
        />
      )}
    </div>
  );
}
