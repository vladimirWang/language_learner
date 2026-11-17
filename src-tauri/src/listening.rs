//! 本地听力素材管理：扫描 app_data/listening/ 下的 manifest.json，供前端加载播放。
//! 数据来源是管理台 builder.listen 的导入产物（work_root/listening/{exam_id}/），
//! 由用户手动拷贝或后续版本服务分发。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningExam {
    pub exam_id: String,
    pub title: String,
    pub lang: String,
    pub question_count: usize,
    pub base_dir: String,
    pub has_answers: bool,
    pub created_at: Option<String>,
}

// Builder 产出的 manifest.json 字段全是 snake_case（Python dataclass 默认），
// 而前端 TS 习惯 camelCase。用分方向的 rename_all：
//   deserialize = "snake_case"  接受 builder 原始产物
//   serialize   = "camelCase"  返回给前端 invoke

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct Manifest {
    pub exam_id: String,
    pub title: String,
    pub lang: String,
    pub question_count: usize,
    pub created_at: Option<String>,
    pub questions: Vec<Question>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct Question {
    pub number: u32,
    #[serde(default)]
    pub start: Option<f64>,
    #[serde(default)]
    pub end: Option<f64>,
    #[serde(default)]
    pub audio: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub ocr_text: Option<String>,
    #[serde(default)]
    pub transcript: Option<String>,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub image_time: Option<f64>,
}

fn listening_root(app: &AppHandle) -> Result<PathBuf, String> {
    // 1. 显式环境变量（测试时指向任意目录）
    if let Ok(v) = std::env::var("LISTENING_DATA_DIR") {
        let p = PathBuf::from(v);
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
        return Ok(p);
    }
    // 2. 开发期默认：backend 的 docker-compose volume 映射目录
    //    language_learner_backend/deploy/data/builder-work/listening/
    //    client 仓库和 backend 同级时，相对路径 ../language_learner_backend/deploy/data/builder-work
    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../language_learner_backend/deploy/data/builder-work/listening");
    if dev_root.exists() {
        return Ok(dev_root);
    }
    // 3. 兜底：app_data_dir/listening
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let p = dir.join("listening");
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

/// 扫描本地所有听力素材目录，列出 exam_id 及元信息。
#[tauri::command]
pub fn scan_listening_exams(app: AppHandle) -> Result<Vec<ListeningExam>, String> {
    let root = listening_root(&app)?;
    let mut result = vec![];
    if !root.exists() {
        return Ok(result);
    }
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let bytes = std::fs::read(&manifest_path).map_err(|e| e.to_string())?;
        let mf: Manifest = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let has_answers = mf.questions.iter().any(|q| q.answer.is_some());
        result.push(ListeningExam {
            exam_id: mf.exam_id,
            title: mf.title,
            lang: mf.lang,
            question_count: mf.question_count,
            base_dir: path.to_string_lossy().to_string(),
            has_answers,
            created_at: mf.created_at,
        });
    }
    // 新的在前
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(result)
}

/// 加载某个 exam 的完整 manifest。
#[tauri::command]
pub fn load_listening_manifest(exam_id: String, app: AppHandle) -> Result<Manifest, String> {
    let root = listening_root(&app)?;
    let manifest_path = root.join(&exam_id).join("manifest.json");
    if !manifest_path.exists() {
        return Err(format!("未找到听力素材 {exam_id}"));
    }
    let bytes = std::fs::read(&manifest_path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

/// 把 base_dir + 相对路径转成前端可直接播放的 absolute path 字符串。
/// 前端 audio/video/img 的 src 直接用此值（Tauri 2 已允许 asset 协议或 file 协议）。
#[tauri::command]
pub fn listening_resolve_path(base_dir: String, relative: String) -> Result<String, String> {
    let base = Path::new(&base_dir);
    let target = base.join(&relative);
    let canonical = target.canonicalize().map_err(|e| format!("文件不存在：{e}"))?;
    // 安全：禁止跳出 base_dir
    if !canonical.starts_with(base.canonicalize().unwrap_or_else(|_| base.to_path_buf())) {
        return Err("路径越界".to_string());
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_parses_real_sample() {
        let sample = r#"{
          "exam_id": "goethe-a1-hoeren-01",
          "title": "Goethe A1 Hören",
          "lang": "de",
          "question_count": 1,
          "questions": [{
            "number": 1,
            "start": 14.98,
            "end": 207.89,
            "audio": "audio/q01.m4a",
            "image": "images/q01.png",
            "transcript": "Nummer 1 ...",
            "answer": "B"
          }]
        }"#;
        let mf: Manifest = serde_json::from_str(sample).unwrap();
        assert_eq!(mf.exam_id, "goethe-a1-hoeren-01");
        assert_eq!(mf.questions.len(), 1);
        assert_eq!(mf.questions[0].answer.as_deref(), Some("B"));
        assert_eq!(mf.questions[0].audio.as_deref(), Some("audio/q01.m4a"));
    }

    #[test]
    fn manifest_handles_missing_answer_gracefully() {
        let sample = r#"{
          "exam_id": "x", "title": "x", "lang": "de", "question_count": 1,
          "questions": [{"number": 2, "audio": "audio/q02.m4a"}]
        }"#;
        let mf: Manifest = serde_json::from_str(sample).unwrap();
        assert!(mf.questions[0].answer.is_none());
        assert_eq!(mf.questions[0].options.len(), 0);
    }
}
