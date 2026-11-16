//! 素材在线更新：检查服务端最新 ground_truth.db，下载、md5 校验并替换本地库。
//! 只做手动触发，内置库始终作为离线兜底。

use md5::{Digest, Md5};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const LANG: &str = "de";
const DEFAULT_API_BASE: &str = "http://127.0.0.1:8080";
const VERSION_FILE: &str = "material_version.json";
const MAX_DB_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialUpdateInfo {
    pub api_base: String,
    pub remote_version: String,
    pub remote_md5: String,
    pub local_version: String,
    pub local_md5: String,
    pub up_to_date: bool,
}

#[derive(Debug, Deserialize)]
struct VersionResponse {
    version: String,
    ground_truth: MaterialAsset,
}

#[derive(Debug, Deserialize)]
struct MaterialAsset {
    url: String,
    md5: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVersion {
    version: String,
    md5: String,
    updated_at: u64,
}

fn api_base() -> String {
    std::env::var("LANGUAGE_API_BASE")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_API_BASE.to_string())
}

fn md5_hex(bytes: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn resolve_url(api_base: &str, url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        return Ok(url.to_string());
    }
    if url.starts_with('/') {
        return Ok(format!("{api_base}{url}"));
    }
    Err("服务端没有提供可用的下载地址（请配置对象存储或使用本地构建产物）".to_string())
}

fn http_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("初始化网络客户端失败：{error}"))
}

/// 拉取服务端版本并解析出可直接下载的地址。
async fn fetch_version() -> Result<(VersionResponse, String), String> {
    let base = api_base();
    let client = http_client(Duration::from_secs(10))?;
    let response = client
        .get(format!("{base}/api/version?lang={LANG}"))
        .send()
        .await
        .map_err(|error| format!("无法连接素材服务 {base}：{error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "素材服务返回 HTTP {}（{base}），请确认后端已启动且有 {LANG} 的构建版本",
            response.status().as_u16()
        ));
    }

    let version: VersionResponse = response
        .json()
        .await
        .map_err(|error| format!("解析版本信息失败：{error}"))?;
    if version.ground_truth.md5.trim().is_empty() {
        return Err("服务端版本缺少 md5，无法安全更新".to_string());
    }
    let url = resolve_url(&base, &version.ground_truth.url)?;
    Ok((version, url))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(dir)
}

fn read_local_version(app: &AppHandle) -> Option<LocalVersion> {
    let path = app_data_dir(app).ok()?.join(VERSION_FILE);
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_local_version(app: &AppHandle, version: &str, md5: &str) -> Result<(), String> {
    let path = app_data_dir(app)?.join(VERSION_FILE);
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let payload = serde_json::to_vec_pretty(&LocalVersion {
        version: version.to_string(),
        md5: md5.to_string(),
        updated_at,
    })
    .map_err(|error| format!("序列化版本信息失败：{error}"))?;
    std::fs::write(path, payload).map_err(|error| format!("写入版本信息失败：{error}"))
}

#[tauri::command]
pub async fn check_material_update(app: AppHandle) -> Result<MaterialUpdateInfo, String> {
    let base = api_base();
    let (remote, _) = fetch_version().await?;

    let local_path = crate::quiz::database_path(&app)?;
    let local_bytes =
        std::fs::read(&local_path).map_err(|error| format!("读取本地真值库失败：{error}"))?;
    let local_md5 = md5_hex(&local_bytes);
    let local_version = read_local_version(&app)
        .map(|item| item.version)
        .unwrap_or_else(|| "内置素材".to_string());

    Ok(MaterialUpdateInfo {
        api_base: base,
        remote_version: remote.version,
        remote_md5: remote.ground_truth.md5.clone(),
        local_version,
        local_md5: local_md5.clone(),
        up_to_date: local_md5.eq_ignore_ascii_case(remote.ground_truth.md5.trim()),
    })
}

#[tauri::command]
pub async fn apply_material_update(app: AppHandle) -> Result<String, String> {
    let (remote, url) = fetch_version().await?;
    let client = http_client(Duration::from_secs(60))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("下载素材失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载素材失败：HTTP {}", response.status().as_u16()));
    }
    if let Some(length) = response.content_length() {
        if length as usize > MAX_DB_BYTES {
            return Err("素材文件过大，已取消更新".to_string());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取素材内容失败：{error}"))?;
    if bytes.len() > MAX_DB_BYTES {
        return Err("素材文件过大，已取消更新".to_string());
    }
    if bytes.is_empty() {
        return Err("下载到的素材为空，已取消更新".to_string());
    }

    let actual = md5_hex(&bytes);
    let expected = remote.ground_truth.md5.trim();
    if !actual.eq_ignore_ascii_case(expected) {
        return Err("素材校验失败（md5 不一致），本地库未替换".to_string());
    }

    let dir = app_data_dir(&app)?;
    let target = dir.join("ground_truth_de.db");
    let temp = dir.join("ground_truth_de.db.tmp");
    std::fs::write(&temp, &bytes).map_err(|error| format!("写入临时文件失败：{error}"))?;
    std::fs::rename(&temp, &target).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("替换本地真值库失败：{error}")
    })?;

    write_local_version(&app, &remote.version, expected)?;
    Ok(remote.version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_known_value() {
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    fn resolves_absolute_relative_and_invalid_urls() {
        assert_eq!(
            resolve_url("http://127.0.0.1:8080", "https://oss.example/db").unwrap(),
            "https://oss.example/db"
        );
        assert_eq!(
            resolve_url("http://127.0.0.1:8080", "/api/material/de/ground_truth.db").unwrap(),
            "http://127.0.0.1:8080/api/material/de/ground_truth.db"
        );
        assert!(resolve_url("http://127.0.0.1:8080", "builder/work/de/db").is_err());
    }
}
