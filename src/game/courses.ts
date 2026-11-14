import helloThumb from "../assets/thumbs/hello.png";
import appleThumb from "../assets/thumbs/apple.png";
import bananaThumb from "../assets/thumbs/banana.png";
import milkThumb from "../assets/thumbs/milk.png";
import standUpThumb from "../assets/thumbs/stand-up.png";
import sitDownThumb from "../assets/thumbs/sit-down.png";
import handsUpThumb from "../assets/thumbs/hands-up.png";
import handsDownThumb from "../assets/thumbs/hands-down.png";
import oneMoreTimeThumb from "../assets/thumbs/one-more-time.png";
import { ACCENTS } from "./theme";

export type DialoguePair = { prompt: string; reply: string };
export type ShortPhrase = { text: string; image?: string };

export type Course = {
  /** 课程文件名（不含扩展名），同时作为关卡名 */
  id: string;
  name: string;
  /** 地图节点上显示的名字 */
  title: string;
  dialogues: DialoguePair[];
  phrases: ShortPhrase[];
  thumb: string;
  accent: string;
};

export type DialogueQuestion = {
  id: string;
  kind: "dialogue";
  /** 展示给学生的那一句 */
  shown: string;
  /** 需要学生输入的答案（必须是另一句） */
  answer: string;
  ask: "reply" | "question";
};

export type PhraseQuestion = {
  id: string;
  kind: "phrase";
  text: string;
  image?: string;
  options: string[];
};

export type Question = DialogueQuestion | PhraseQuestion;

const THUMBS = [
  helloThumb,
  appleThumb,
  bananaThumb,
  milkThumb,
  standUpThumb,
  sitDownThumb,
  handsUpThumb,
  handsDownThumb,
];

const PHRASE_IMAGES: Record<string, string> = {
  hello: helloThumb,
  apple: appleThumb,
  banana: bananaThumb,
  milk: milkThumb,
  "stand up": standUpThumb,
  "sit down": sitDownThumb,
  "hands up": handsUpThumb,
  "hands down": handsDownThumb,
  "one more time": oneMoreTimeThumb,
};

const FALLBACK_OPTIONS = [
  "stand up",
  "sit down",
  "hands up",
  "hands down",
  "one more time",
];

const courseImageFiles = import.meta.glob(
  [
    "../../courses/*.{png,jpg,jpeg,webp}",
    // 这些短语已有裁剪好的内置图（避免重复打包整张闪卡）
    "!../../courses/{hello,apple,banana,milk,stand_up,sit_down,hands_up,hands_down,one_more_time}.{png,jpg,jpeg,webp}",
  ],
  {
    query: "?url",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

const courseImages = Object.fromEntries(
  Object.entries(courseImageFiles).map(([path, url]) => [
    path.split("/").pop()?.toLowerCase() ?? path,
    url,
  ]),
);

/** 课程里引用的图片（新短语没有内置裁剪图时使用） */
function resolveCourseImage(src: string, alt: string): string | undefined {
  for (const candidate of [src, alt]) {
    const file = candidate.replace(/^\.?\//, "").split("/").pop()?.toLowerCase();
    if (file && courseImages[file]) return courseImages[file];
  }
  return undefined;
}

const normalizePhrase = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[.!?。！？]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function parseCourse(markdown: string): {
  dialogues: DialoguePair[];
  phrases: ShortPhrase[];
} {
  const dialogues: DialoguePair[] = [];
  const phrases: ShortPhrase[] = [];
  let section: "dialogue" | "phrase" | "" = "";
  let currentDialogue: { prompt: string; reply: string } | null = null;
  let currentPhrase: ShortPhrase | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").toLowerCase();
      if (heading.includes("dialogue")) section = "dialogue";
      else if (heading.includes("phrase")) section = "phrase";
      else section = "";
      currentDialogue = null;
      currentPhrase = null;
      continue;
    }

    if (section === "dialogue") {
      const numbered = line.match(/^\d+[.)]\s+(.*)$/);
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      if (numbered) {
        currentDialogue = { prompt: numbered[1].trim(), reply: "" };
        dialogues.push(currentDialogue);
      } else if (bullet && currentDialogue && !currentDialogue.reply) {
        currentDialogue.reply = bullet[1].trim();
      }
    } else if (section === "phrase") {
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)/);
      if (bullet) {
        const text = bullet[1].trim();
        if (text) {
          currentPhrase = { text, image: PHRASE_IMAGES[normalizePhrase(text)] };
          phrases.push(currentPhrase);
        }
      } else if (image && currentPhrase) {
        const alt = image[1];
        const src = image[2];
        currentPhrase.image =
          PHRASE_IMAGES[normalizePhrase(currentPhrase.text)] ??
          PHRASE_IMAGES[normalizePhrase(alt)] ??
          resolveCourseImage(src, alt);
      }
    }
  }

  return {
    dialogues: dialogues.filter((pair) => pair.prompt && pair.reply),
    phrases,
  };
}

const courseFiles = import.meta.glob("../../courses/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const COURSES: Course[] = Object.entries(courseFiles)
  .map(([path, markdown]) => {
    const name = path.split("/").pop()?.replace(/\.md$/i, "") ?? "lesson";
    const { dialogues, phrases } = parseCourse(markdown);
    return {
      id: name,
      name,
      title: /^\d+$/.test(name) ? `Lesson ${name}` : name.replace(/[-_]/g, " "),
      dialogues,
      phrases,
      thumb: "",
      accent: "",
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  .map((course, index) => ({
    ...course,
    thumb: THUMBS[index % THUMBS.length],
    accent: ACCENTS[index % ACCENTS.length],
  }));

export function questionCount(course: Course): number {
  return course.dialogues.length + course.phrases.length;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 对话交替练习「回答」和「问句」，所有题型每次随机排序 */
export function buildQuestions(course: Course): Question[] {
  const dialogues: DialogueQuestion[] = course.dialogues.map((pair, index) => {
    const askReply = index % 2 === 0;
    return {
      id: `${course.id}-dialogue-${index}`,
      kind: "dialogue",
      shown: askReply ? pair.prompt : pair.reply,
      answer: askReply ? pair.reply : pair.prompt,
      ask: askReply ? "reply" : "question",
    };
  });

  const phrasePool = Array.from(
    new Set([
      ...COURSES.flatMap((item) => item.phrases.map((phrase) => phrase.text)),
      ...FALLBACK_OPTIONS,
    ]),
  );

  const phrases: PhraseQuestion[] = course.phrases.map((phrase, index) => {
    const distractors = shuffle(
      phrasePool.filter(
        (candidate) => normalizePhrase(candidate) !== normalizePhrase(phrase.text),
      ),
    ).slice(0, 3);
    return {
      id: `${course.id}-phrase-${index}`,
      kind: "phrase",
      text: phrase.text,
      image: phrase.image,
      options: shuffle([phrase.text, ...distractors]),
    };
  });

  return shuffle([...dialogues, ...phrases]);
}
