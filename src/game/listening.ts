import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export type ExamSummary = {
  examId: string;
  title: string;
  lang: string;
  questionCount: number;
  baseDir: string;
  hasAnswers: boolean;
  createdAt?: string;
};

export type ListeningQuestion = {
  number: number;
  start?: number;
  end?: number;
  audio?: string;   // "audio/q01.m4a"
  image?: string;   // "images/q01.png"
  ocrText?: string;
  transcript?: string;
  answer?: string;  // "A" / "B" / "C" / "D"
  options: string[];
  imageTime?: number;
};

export type ListeningManifest = {
  examId: string;
  title: string;
  lang: string;
  questionCount: number;
  createdAt?: string;
  questions: ListeningQuestion[];
};

/** 扫描本地已有的听力素材目录 */
export function scanListeningExams(): Promise<ExamSummary[]> {
  return invoke<ExamSummary[]>("scan_listening_exams");
}

/** 加载某个 exam 的完整 manifest */
export function loadListeningManifest(examId: string): Promise<ListeningManifest> {
  return invoke<ListeningManifest>("load_listening_manifest", { examId });
}

/** 把相对路径（如 "audio/q01.m4a"）解析为绝对路径字符串，前端 audio/src 直接用 */
export function resolveListeningPath(baseDir: string, relative: string): Promise<string> {
  return invoke<string>("listening_resolve_path", { baseDir, relative });
}

/** 把绝对路径包装成 Tauri asset:// URL，WKWebView / CEF 才能正常加载本地文件 */
export function toAssetUrl(absolutePath: string): string {
  // Tauri 2: convertFileSrc 从 @tauri-apps/api/core 导入
  return convertFileSrc(absolutePath);
}
