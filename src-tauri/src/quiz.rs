//! 本地真值库出题：所有答案都来自内置的 ground_truth.db（SQLite 只读查询），
//! 不做任何模型生成，保证题面与答案键一致。

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const LANG: &str = "de";
const MAX_COUNT: usize = 10;
const DB_BYTES: &[u8] = include_bytes!("../resources/ground_truth_de.db");

/// A1 / A2 的常用词，仅作为干扰项（错误选项）使用，绝不作为答案来源。
const DISTRACTOR_WORDS_A1: &[(&str, &str)] = &[
    ("Apfel", "苹果"),
    ("Wasser", "水"),
    ("Buch", "书"),
    ("Schule", "学校"),
    ("Haus", "房子"),
    ("Zeit", "时间"),
    ("Freund", "朋友"),
    ("Straße", "街道"),
    ("Brot", "面包"),
    ("Milch", "牛奶"),
];

const DISTRACTOR_WORDS_A2: &[(&str, &str)] = &[
    ("Reise", "旅行"),
    ("Erfahrung", "经验"),
    ("Umgebung", "环境"),
    ("Entscheidung", "决定"),
    ("Gesundheit", "健康"),
    ("Wetter", "天气"),
    ("Termin", "预约"),
    ("Nachricht", "消息"),
];

const DISTRACTOR_PLURALS: &[&str] = &[
    "Äpfel", "Bücher", "Häuser", "Straßen", "Freunde", "Tische", "Hunde", "Schulen",
];

const DISTRACTOR_POSSESSIVE: &[&str] = &["mein", "meine", "meinem", "meinen", "meiner"];

const DISTRACTOR_CONJ: &[&str] = &["lerne", "lernst", "lernt", "lernen", "hilfst", "helfen"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizRequest {
    /// A1 / A2
    pub level: String,
    /// vocab / grammar
    pub kind: String,
    pub count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizBatch {
    pub level: String,
    pub kind: String,
    pub message: String,
    pub questions: Vec<QuizQuestion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizQuestion {
    pub id: String,
    pub topic: String,
    pub prompt: String,
    pub hint: Option<String>,
    pub options: Vec<String>,
    pub answer_index: usize,
    pub explanation: String,
}

#[derive(Debug, Clone)]
struct VocabWord {
    lemma: String,
    word_type: String,
    gender: Option<String>,
    plural: Option<String>,
    chinese_mean: String,
    core_case: Option<String>,
}

#[derive(Debug, Clone)]
struct GrammarForm {
    root: String,
    form_type: String,
    form: String,
    note: Option<String>,
    level: Option<String>,
}

struct Draft {
    topic: &'static str,
    prompt: String,
    hint: Option<String>,
    correct: String,
    pool: Vec<String>,
    explanation: String,
}

/// 极简 xorshift，避免为出题引入额外随机数依赖。
struct Rng(u64);

impl Rng {
    fn new() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);
        Rng(seed | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, len: usize) -> usize {
        if len == 0 {
            0
        } else {
            (self.next() % len as u64) as usize
        }
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i + 1);
            items.swap(i, j);
        }
    }
}

fn db_err(error: rusqlite::Error) -> String {
    format!("查询真值库失败：{error}")
}

fn normalize_level(level: &str) -> Result<String, String> {
    let level = level.trim().to_uppercase();
    if level == "A1" || level == "A2" {
        Ok(level)
    } else {
        Err("目前只支持 A1 / A2 难度".to_string())
    }
}

fn normalize_kind(kind: &str) -> &'static str {
    let kind = kind.trim().to_lowercase();
    if kind.contains("gram") || kind.contains("语法") {
        "grammar"
    } else {
        "vocab"
    }
}

fn gender_label(gender: &str) -> &'static str {
    match gender {
        "m" => "阳性",
        "f" => "阴性",
        "n" => "中性",
        _ => "未知词性",
    }
}

fn word_type_label(word_type: &str) -> &'static str {
    match word_type {
        "noun" => "名词",
        "verb" => "动词",
        "adj" => "形容词",
        "adv" => "副词",
        "prep" => "介词",
        _ => "词汇",
    }
}

fn case_label(core_case: &str) -> Option<&'static str> {
    match core_case {
        "+N" => Some("第一格（Nominativ）"),
        "+G" => Some("第二格（Genitiv）"),
        "+D" => Some("第三格（Dativ）"),
        "+A" => Some("第四格（Akkusativ）"),
        _ => None,
    }
}

fn load_vocab(conn: &Connection, level: &str) -> Result<Vec<VocabWord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT lemma, word_type, gender, plural, chinese_mean, core_case
             FROM vocab WHERE lang = ?1 AND level = ?2 ORDER BY word_id",
        )
        .map_err(db_err)?;

    let rows = stmt
        .query_map([LANG, level], |row| {
            Ok(VocabWord {
                lemma: row.get(0)?,
                word_type: row.get(1)?,
                gender: row.get(2)?,
                plural: row.get(3)?,
                chinese_mean: row.get(4)?,
                core_case: row.get(5)?,
            })
        })
        .map_err(db_err)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
}

fn load_forms(conn: &Connection) -> Result<Vec<GrammarForm>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT g.root, g.form_type, g.form, g.note, v.level
             FROM grammar_forms g
             LEFT JOIN vocab v ON v.lang = g.lang AND v.lemma = g.root
             WHERE g.lang = ?1
             ORDER BY g.form_id",
        )
        .map_err(db_err)?;

    let rows = stmt
        .query_map([LANG], |row| {
            Ok(GrammarForm {
                root: row.get(0)?,
                form_type: row.get(1)?,
                form: row.get(2)?,
                note: row.get(3)?,
                level: row.get(4)?,
            })
        })
        .map_err(db_err)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
}

fn push_unique(pool: &mut Vec<String>, value: &str) {
    let value = value.trim();
    if !value.is_empty() && !pool.iter().any(|item| item == value) {
        pool.push(value.to_string());
    }
}

fn vocab_drafts(level: &str, words: &[VocabWord]) -> Vec<Draft> {
    let mut lemma_pool: Vec<String> = Vec::new();
    let mut meaning_pool: Vec<String> = Vec::new();
    for word in words {
        push_unique(&mut lemma_pool, &word.lemma);
        push_unique(&mut meaning_pool, &word.chinese_mean);
    }
    let extra = if level == "A1" {
        DISTRACTOR_WORDS_A1
    } else {
        DISTRACTOR_WORDS_A2
    };
    for (lemma, meaning) in extra {
        push_unique(&mut lemma_pool, lemma);
        push_unique(&mut meaning_pool, meaning);
    }

    let mut drafts = Vec::new();
    for word in words {
        let detail = match (&word.gender, &word.plural) {
            (Some(gender), Some(plural)) => format!(
                "{} · {}，复数 {}",
                word_type_label(&word.word_type),
                gender_label(gender),
                plural
            ),
            (Some(gender), None) => format!(
                "{} · {}",
                word_type_label(&word.word_type),
                gender_label(gender)
            ),
            _ => word_type_label(&word.word_type).to_string(),
        };

        drafts.push(Draft {
            topic: "单词",
            prompt: format!("德语单词 “{}” 的中文意思是？", word.lemma),
            hint: Some(format!("{level} · {detail}")),
            correct: word.chinese_mean.clone(),
            pool: meaning_pool.clone(),
            explanation: format!("{} = {}（{}）", word.lemma, word.chinese_mean, detail),
        });

        drafts.push(Draft {
            topic: "单词",
            prompt: format!("“{}” 用德语怎么说？", word.chinese_mean),
            hint: Some(format!("{level} · {detail}")),
            correct: word.lemma.clone(),
            pool: lemma_pool.clone(),
            explanation: format!("{} 对应德语 {}（{}）", word.chinese_mean, word.lemma, detail),
        });
    }
    drafts
}

fn grammar_drafts(level: &str, words: &[VocabWord], forms: &[GrammarForm]) -> Vec<Draft> {
    let in_level = |form: &GrammarForm| form.level.as_deref().map_or(true, |l| l == level);
    let mut drafts = Vec::new();

    // 名词：定冠词 + 复数
    for word in words
        .iter()
        .filter(|word| word.word_type == "noun")
    {
        if let Some(gender) = word.gender.as_deref() {
            let article = match gender {
                "m" => "der",
                "f" => "die",
                "n" => "das",
                _ => continue,
            };
            drafts.push(Draft {
                topic: "语法",
                prompt: format!("名词 “{}” 的定冠词（第一格）是哪一个？", word.lemma),
                hint: Some("德语名词第一格定冠词".to_string()),
                correct: article.to_string(),
                pool: vec![
                    "der".to_string(),
                    "die".to_string(),
                    "das".to_string(),
                    "den".to_string(),
                ],
                explanation: format!(
                    "{} 是{}名词，第一格定冠词用 {}，即 {} {}。",
                    word.lemma,
                    gender_label(gender),
                    article,
                    article,
                    word.lemma
                ),
            });
        }

        if let Some(plural) = word.plural.as_deref() {
            let mut pool: Vec<String> = DISTRACTOR_PLURALS.iter().map(|s| s.to_string()).collect();
            for other in words.iter().filter(|item| item.word_type == "noun") {
                if let Some(other_plural) = other.plural.as_deref() {
                    push_unique(&mut pool, other_plural);
                }
            }
            drafts.push(Draft {
                topic: "语法",
                prompt: format!("名词 “{}” 的复数形式是？", word.lemma),
                hint: Some(format!("{} · 复数", gender_label(word.gender.as_deref().unwrap_or("")))),
                correct: plural.to_string(),
                pool,
                explanation: format!("{} 的复数是 {}。", word.lemma, plural),
            });
        }
    }

    // 动词支配格
    for word in words.iter().filter(|word| word.word_type == "verb") {
        let Some(core_case) = word.core_case.as_deref() else {
            continue;
        };
        let Some(label) = case_label(core_case) else {
            continue;
        };
        drafts.push(Draft {
            topic: "语法",
            prompt: format!("动词 “{}” 支配哪个格？", word.lemma),
            hint: Some("动词固定搭配".to_string()),
            correct: label.to_string(),
            pool: vec![
                "第一格（Nominativ）".to_string(),
                "第二格（Genitiv）".to_string(),
                "第三格（Dativ）".to_string(),
                "第四格（Akkusativ）".to_string(),
            ],
            explanation: format!(
                "{} 支配{}，例如：Ich {} dir.",
                word.lemma,
                label,
                word.lemma
            ),
        });
    }

    // 物主代词 / 动词变位
    let mut possessive_pool: Vec<String> =
        DISTRACTOR_POSSESSIVE.iter().map(|s| s.to_string()).collect();
    let mut conj_pool: Vec<String> = DISTRACTOR_CONJ.iter().map(|s| s.to_string()).collect();
    for form in forms {
        match form.form_type.as_str() {
            "possessive" => push_unique(&mut possessive_pool, &form.form),
            "verb_conj" => push_unique(&mut conj_pool, &form.form),
            _ => {}
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    for form in forms.iter().filter(|form| in_level(form)) {
        let Some(note) = form.note.as_deref().filter(|note| !note.trim().is_empty()) else {
            continue;
        };
        match form.form_type.as_str() {
            "possessive" => {
                // 同一个答案（如 mein 的阳性/中性第一格）只出一道，避免重复感。
                if !seen.insert(format!("possessive:{}:{}", form.root, form.form)) {
                    continue;
                }
                drafts.push(Draft {
                    topic: "语法",
                    prompt: format!("物主代词 “{}” 的「{}」形式是？", form.root, note),
                    hint: Some("物主代词变格".to_string()),
                    correct: form.form.clone(),
                    pool: possessive_pool.clone(),
                    explanation: format!("{} 的{}形式是 {}。", form.root, note, form.form),
                });
            }
            "verb_conj" => drafts.push(Draft {
                topic: "语法",
                prompt: format!("动词 “{}” 的「{}」形式是？", form.root, note),
                hint: Some("动词现在时变位".to_string()),
                correct: form.form.clone(),
                pool: conj_pool.clone(),
                explanation: format!("{} 的{}形式是 {}。", form.root, note, form.form),
            }),
            _ => {}
        }
    }

    drafts
}

fn compose(rng: &mut Rng, index: usize, draft: Draft) -> QuizQuestion {
    let mut pool: Vec<String> = Vec::new();
    for option in draft.pool {
        if option != draft.correct {
            push_unique(&mut pool, &option);
        }
    }
    rng.shuffle(&mut pool);

    let mut options = vec![draft.correct.clone()];
    options.extend(pool.into_iter().take(3));
    rng.shuffle(&mut options);
    let answer_index = options
        .iter()
        .position(|option| option == &draft.correct)
        .unwrap_or(0);

    QuizQuestion {
        id: format!("q{}", index + 1),
        topic: draft.topic.to_string(),
        prompt: draft.prompt,
        hint: draft.hint,
        options,
        answer_index,
        explanation: draft.explanation,
    }
}

fn build_quiz(conn: &Connection, level: &str, kind: &str, count: usize) -> Result<QuizBatch, String> {
    let level = normalize_level(level)?;
    let kind = normalize_kind(kind);
    let count = count.clamp(1, MAX_COUNT);
    let kind_label = if kind == "grammar" { "语法" } else { "单词" };

    let words = load_vocab(conn, &level)?;
    let forms = load_forms(conn)?;

    let mut drafts = if kind == "grammar" {
        grammar_drafts(&level, &words, &forms)
    } else {
        vocab_drafts(&level, &words)
    };
    let available = drafts.len();

    for draft in drafts.iter_mut() {
        if kind == "grammar" {
            draft.hint = draft
                .hint
                .as_ref()
                .map(|hint| format!("{level} · {hint}"));
        }
    }

    let mut rng = Rng::new();
    rng.shuffle(&mut drafts);
    drafts.truncate(count);

    let questions: Vec<QuizQuestion> = drafts
        .into_iter()
        .enumerate()
        .map(|(index, draft)| compose(&mut rng, index, draft))
        .collect();

    let message = if questions.is_empty() {
        format!("真值库里还没有 {level} 难度的{kind_label}素材，换个难度试试，或先在素材库补充内容。")
    } else if available < count {
        format!(
            "{level} 难度目前只有 {available} 道{kind_label}素材，先练这些。"
        )
    } else {
        format!(
            "收到，为你准备了 {} 道 {level} 难度{kind_label}题，选完我会告诉你对错和依据。",
            questions.len()
        )
    };

    Ok(QuizBatch {
        level,
        kind: kind.to_string(),
        message,
        questions,
    })
}

/// 首次运行时把内置真值库释放到应用数据目录；`GROUND_TRUTH_DB` 可指到别处调试。
fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("GROUND_TRUTH_DB") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!("GROUND_TRUTH_DB 指向的文件不存在：{}", path.display()));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;

    let path = dir.join("ground_truth_de.db");
    let up_to_date = std::fs::metadata(&path)
        .map(|meta| meta.len() as usize == DB_BYTES.len())
        .unwrap_or(false);
    if !up_to_date {
        std::fs::write(&path, DB_BYTES).map_err(|error| format!("释放真值库失败：{error}"))?;
    }
    Ok(path)
}

#[tauri::command]
pub fn generate_quiz(app: AppHandle, request: QuizRequest) -> Result<QuizBatch, String> {
    let path = database_path(&app)?;
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("打开真值库失败：{error}"))?;
    build_quiz(
        &conn,
        &request.level,
        &request.kind,
        request.count.unwrap_or(5),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE vocab (
                word_id INTEGER PRIMARY KEY AUTOINCREMENT,
                lang TEXT NOT NULL, lemma TEXT NOT NULL, word_type TEXT NOT NULL,
                gender TEXT, plural TEXT, separable BOOLEAN, trans_intr TEXT,
                level TEXT NOT NULL, chinese_mean TEXT NOT NULL, english_mean TEXT,
                core_case TEXT, sort_key TEXT, extra_json TEXT, source_md_path TEXT,
                create_version TEXT, UNIQUE(lang, lemma)
            );
            CREATE TABLE grammar_forms (
                form_id INTEGER PRIMARY KEY AUTOINCREMENT, lang TEXT NOT NULL,
                root TEXT NOT NULL, form_type TEXT NOT NULL, person TEXT, case_tag TEXT,
                gender TEXT, number_tag TEXT, form TEXT NOT NULL, note TEXT,
                source_md_path TEXT, create_version TEXT,
                UNIQUE(lang, root, form_type, person, case_tag, gender, number_tag)
            );
            INSERT INTO vocab (lang, lemma, word_type, gender, plural, level, chinese_mean, core_case)
                VALUES ('de', 'Tisch', 'noun', 'm', 'Tische', 'A1', '桌子', NULL);
            INSERT INTO vocab (lang, lemma, word_type, gender, plural, level, chinese_mean, core_case)
                VALUES ('de', 'Hund', 'noun', 'm', 'Hunde', 'A2', '狗', NULL);
            INSERT INTO vocab (lang, lemma, word_type, gender, plural, level, chinese_mean, core_case)
                VALUES ('de', 'helfen', 'verb', NULL, NULL, 'A2', '帮助', '+D');
            INSERT INTO grammar_forms (lang, root, form_type, person, case_tag, gender, number_tag, form, note)
                VALUES ('de', 'mein', 'possessive', '1sg', 'nom', 'm', 'sg', 'mein', '阳性第一格');
            INSERT INTO grammar_forms (lang, root, form_type, person, case_tag, gender, number_tag, form, note)
                VALUES ('de', 'mein', 'possessive', '1sg', 'dat', 'm', 'sg', 'meinem', '阳性第三格');
            INSERT INTO grammar_forms (lang, root, form_type, person, case_tag, gender, number_tag, form, note)
                VALUES ('de', 'helfen', 'verb_conj', '1sg', NULL, NULL, 'sg', 'helfe', '现在时第一人称单数');
            INSERT INTO grammar_forms (lang, root, form_type, person, case_tag, gender, number_tag, form, note)
                VALUES ('de', 'helfen', 'verb_conj', '3sg', NULL, NULL, 'sg', 'hilft', '现在时第三人称单数');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn vocab_quiz_has_four_options_and_consistent_key() {
        let conn = test_conn();
        let batch = build_quiz(&conn, "A1", "vocab", 5).unwrap();
        assert_eq!(batch.questions.len(), 2, "A1 只有 1 个词 → 2 道题");
        for question in &batch.questions {
            assert_eq!(question.options.len(), 4);
            assert!(question.answer_index < question.options.len());
            assert!(question.prompt.contains("Tisch") || question.prompt.contains("桌子"));
        }
    }

    #[test]
    fn grammar_quiz_covers_nouns_verbs_and_possessives() {
        let conn = test_conn();
        let batch = build_quiz(&conn, "A2", "grammar", 10).unwrap();
        let prompts: Vec<&str> = batch.questions.iter().map(|q| q.prompt.as_str()).collect();
        assert!(prompts.iter().any(|p| p.contains("定冠词")));
        assert!(prompts.iter().any(|p| p.contains("复数")));
        assert!(prompts.iter().any(|p| p.contains("支配")));
        assert!(prompts.iter().any(|p| p.contains("helfen") && p.contains("形式")));
        assert!(prompts.iter().any(|p| p.contains("mein")));
        for question in &batch.questions {
            assert_eq!(question.options.len(), 4);
            assert!(question.answer_index < 4);
        }
        let article = batch
            .questions
            .iter()
            .find(|q| q.prompt.contains("定冠词"))
            .unwrap();
        assert_eq!(article.options[article.answer_index], "der");
    }

    #[test]
    fn unavailable_level_returns_friendly_empty_batch() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE vocab (word_id INTEGER PRIMARY KEY, lang TEXT NOT NULL,
                lemma TEXT NOT NULL, word_type TEXT NOT NULL, gender TEXT, plural TEXT,
                separable BOOLEAN, trans_intr TEXT, level TEXT NOT NULL,
                chinese_mean TEXT NOT NULL, english_mean TEXT, core_case TEXT,
                sort_key TEXT, extra_json TEXT, source_md_path TEXT, create_version TEXT);
             CREATE TABLE grammar_forms (form_id INTEGER PRIMARY KEY, lang TEXT NOT NULL,
                root TEXT NOT NULL, form_type TEXT NOT NULL, person TEXT, case_tag TEXT,
                gender TEXT, number_tag TEXT, form TEXT NOT NULL, note TEXT,
                source_md_path TEXT, create_version TEXT);",
        )
        .unwrap();
        let batch = build_quiz(&conn, "B1", "vocab", 5).unwrap_err();
        assert!(batch.contains("A1 / A2"));
        let batch = build_quiz(&conn, "A1", "grammar", 5).unwrap();
        assert!(batch.questions.is_empty());
        assert!(batch.message.contains("还没有"));
    }

    #[test]
    fn embedded_database_is_readable() {
        let path = std::env::temp_dir().join("word-adventure-quiz-test.db");
        std::fs::write(&path, DB_BYTES).unwrap();
        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let batch = build_quiz(&conn, "A1", "vocab", 5).unwrap();
        assert!(!batch.questions.is_empty());
        for question in &batch.questions {
            assert_eq!(question.options.len(), 4);
        }
    }
}
