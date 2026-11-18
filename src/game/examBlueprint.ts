import type { SpeakingLevel } from "./speaking";

/** 考试辅助材料：关键词、题卡、思维导图、双人日程。 */
export type ExamAid =
  | { kind: "chips"; label: string; items: string[] }
  | { kind: "cards"; label: string; cards: { title: string; hint: string }[] }
  | { kind: "mindmap"; label: string; center: string; branches: string[] }
  | { kind: "schedule"; label: string; groups: { name: string; slots: string[] }[] }
  | { kind: "topic"; label: string; text: string };

export interface BlueprintPrompt {
  de: string;
  zh: string;
  topic: string;
}

export interface ExamPartBlueprint {
  key: "part1_intro" | "part2_presentation" | "part3_discussion";
  title: string;
  /** 交互形态：自我介绍 / 问答 / 请求 / 自述 / 规划 / 陈述 / 讨论 */
  mode: "intro" | "qa" | "request" | "monologue" | "planning" | "presentation" | "discussion";
  durationSec: number;
  /** 除首问外允许的追问次数；0 表示答完即进入下一题 */
  maxFollowups: number;
  role: "examiner" | "partner";
  prompts?: BlueprintPrompt[];
  aid?: ExamAid;
}

/**
 * 歌德口语考试蓝图。
 * A1/A2 依据官方考试形式内置固定流程与题卡；B1/B2 仅定义部分标题与时长，
 * 题目仍取自题库（管理台可维护）。
 */
export const EXAM_BLUEPRINTS: Partial<Record<SpeakingLevel, ExamPartBlueprint[]>> = {
  A1: [
    {
      key: "part1_intro",
      title: "自我介绍",
      mode: "intro",
      durationSec: 150,
      maxFollowups: 0,
      role: "examiner",
      aid: {
        kind: "chips",
        label: "按关键词依次作答",
        items: ["Name", "Alter", "Land", "Wohnort", "Sprache", "Beruf", "Hobby"],
      },
      prompts: [
        { de: "Wie heißen Sie?", zh: "你叫什么名字？", topic: "Person" },
        { de: "Wie alt sind Sie?", zh: "你多大了？", topic: "Person" },
        { de: "Woher kommen Sie?", zh: "你来自哪里？", topic: "Person" },
        { de: "Wo wohnen Sie?", zh: "你住在哪里？", topic: "Person" },
        { de: "Welche Sprachen sprechen Sie?", zh: "你说哪些语言？", topic: "Person" },
        { de: "Was sind Sie von Beruf?", zh: "你的职业是什么？", topic: "Person" },
        { de: "Was machen Sie gern in Ihrer Freizeit?", zh: "你空闲时喜欢做什么？", topic: "Freizeit" },
      ],
    },
    {
      key: "part2_presentation",
      title: "日常问答",
      mode: "qa",
      durationSec: 180,
      maxFollowups: 1,
      role: "examiner",
      aid: {
        kind: "cards",
        label: "抽一张卡，围绕卡片简短问答",
        cards: [
          { title: "Essen", hint: "吃什么、是否自己做饭" },
          { title: "Einkaufen", hint: "在哪里买、常买什么" },
          { title: "Wochenende", hint: "周末做什么" },
          { title: "Familie", hint: "家庭成员、是否有兄弟姐妹" },
        ],
      },
      prompts: [
        { de: "Was essen Sie gern?", zh: "你喜欢吃什么？", topic: "Essen" },
        { de: "Wo kaufen Sie ein?", zh: "你在哪里购物？", topic: "Einkaufen" },
        { de: "Was machen Sie am Wochenende?", zh: "你周末做什么？", topic: "Freizeit" },
        { de: "Haben Sie Geschwister?", zh: "你有兄弟姐妹吗？", topic: "Familie" },
      ],
    },
    {
      key: "part3_discussion",
      title: "请求互动",
      mode: "request",
      durationSec: 150,
      maxFollowups: 0,
      role: "examiner",
      aid: {
        kind: "cards",
        label: "根据情景提出请求",
        cards: [
          { title: "Buch", hint: "请考官把书递给你" },
          { title: "Kino", hint: "约考官周六去看电影" },
          { title: "Wort", hint: "没听懂某个词，请对方再说一遍" },
        ],
      },
      prompts: [
        { de: "Sie möchten mein Buch haben. Bitten Sie mich!", zh: "你想要我的书，请礼貌地提出请求。", topic: "Bitten" },
        { de: "Sie möchten am Samstag ins Kino gehen. Fragen Sie mich!", zh: "你想周六去看电影，请问问考官。", topic: "Bitten" },
        { de: "Sie verstehen ein Wort nicht. Fragen Sie mich!", zh: "你没听懂一个词，请对方再说一遍。", topic: "Bitten" },
      ],
    },
  ],
  A2: [
    {
      key: "part1_intro",
      title: "个人信息问答",
      mode: "qa",
      durationSec: 240,
      maxFollowups: 1,
      role: "partner",
      aid: {
        kind: "cards",
        label: "双方轮流抽取关键词卡提问",
        cards: [
          { title: "Geburtstag", hint: "生日在什么时候" },
          { title: "Wohnort", hint: "住在哪里、住得怎么样" },
          { title: "Hobby", hint: "爱好、多久做一次" },
          { title: "Beruf", hint: "职业、工作内容" },
        ],
      },
      prompts: [
        { de: "Wann haben Sie Geburtstag?", zh: "你的生日是什么时候？", topic: "Person" },
        { de: "Wo wohnen Sie, und wie gefällt es Ihnen dort?", zh: "你住在哪里？那里怎么样？", topic: "Wohnen" },
        { de: "Was ist Ihr Hobby, und wie oft machen Sie das?", zh: "你的爱好是什么？多久做一次？", topic: "Freizeit" },
        { de: "Was machen Sie beruflich?", zh: "你做什么工作？", topic: "Beruf" },
      ],
    },
    {
      key: "part2_presentation",
      title: "生活简短自述",
      mode: "monologue",
      durationSec: 180,
      maxFollowups: 1,
      role: "examiner",
      aid: {
        kind: "mindmap",
        label: "围绕思维导图说 3–5 句话，不需要长篇演讲",
        center: "Geld",
        branches: ["Kleidung", "Lebensmittel", "Miete", "Sparen", "Reisen"],
      },
      prompts: [
        {
          de: "Erzählen Sie bitte kurz: Was machen Sie mit Ihrem Geld?",
          zh: "请简短说说：你怎么花你的钱？",
          topic: "Geld",
        },
      ],
    },
    {
      key: "part3_discussion",
      title: "共同规划活动",
      mode: "planning",
      durationSec: 240,
      maxFollowups: 3,
      role: "partner",
      aid: {
        kind: "schedule",
        label: "根据两人的日程，商量时间和地点",
        groups: [
          { name: "Sie", slots: ["10:00 Deutschkurs", "13:00 Mittagessen", "15:00 frei"] },
          { name: "Partner", slots: ["09:00 Arbeit", "12:00 frei", "14:00 Termin"] },
        ],
      },
      prompts: [
        {
          de: "Wir möchten am Samstag einen Ausflug machen. Haben Sie Zeit?",
          zh: "我们周六想出去郊游，你有时间吗？",
          topic: "Planen",
        },
      ],
    },
  ],
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

/** 该等级的考试是否完全由内置蓝图驱动（不依赖题库）。 */
export function usesBuiltinExam(level: SpeakingLevel): boolean {
  return level === "A1" || level === "A2";
}
