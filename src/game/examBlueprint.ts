import type { ExamAid, ExamPartMode, SpeakingLevel } from "./speaking";

export interface ExamPartBlueprint {
  key: "part1_intro" | "part2_presentation" | "part3_discussion";
  title: string;
  mode: ExamPartMode;
  durationSec: number;
  /** 除首问外允许的追问次数；0 表示答完即进入下一题 */
  maxFollowups: number;
  role: "examiner" | "partner";
  aid?: ExamAid;
}

/**
 * B1/B2 的口试部分元数据：标题、时长与追问上限。
 * 题目仍取自题库（管理台可维护）。
 * A1/A2 的考试结构与题目全部来自数据库（speaking_exam_parts / speaking_items）。
 */
export const EXAM_BLUEPRINTS: Partial<Record<SpeakingLevel, ExamPartBlueprint[]>> = {
  B1: [
    {
      key: "part1_intro",
      title: "自我介绍与问答",
      mode: "intro",
      durationSec: 240,
      maxFollowups: 2,
      role: "examiner",
    },
    {
      key: "part2_presentation",
      title: "主题陈述",
      mode: "presentation",
      durationSec: 300,
      maxFollowups: 2,
      role: "examiner",
    },
    {
      key: "part3_discussion",
      title: "双人讨论",
      mode: "discussion",
      durationSec: 300,
      maxFollowups: 2,
      role: "partner",
    },
  ],
  B2: [
    {
      key: "part1_intro",
      title: "自我介绍与问答",
      mode: "intro",
      durationSec: 240,
      maxFollowups: 2,
      role: "examiner",
    },
    {
      key: "part2_presentation",
      title: "主题陈述",
      mode: "presentation",
      durationSec: 300,
      maxFollowups: 2,
      role: "examiner",
    },
    {
      key: "part3_discussion",
      title: "双人讨论",
      mode: "discussion",
      durationSec: 300,
      maxFollowups: 2,
      role: "partner",
    },
  ],
};

/** A1/A2 采用歌德官方固定流程，结构由数据库配置驱动。 */
export function isOfficialExam(level: SpeakingLevel): boolean {
  return level === "A1" || level === "A2";
}
