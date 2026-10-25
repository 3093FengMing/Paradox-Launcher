use std::time::Duration;

use paradox_core::catalog::{CatalogCache, CatalogSnapshot, DEFAULT_CATALOG_TTL};
use serde::Serialize;
use tauri::State;

use super::{CommandResult, log, sdk_job, sdk_runtime, snapshot};
use crate::AppState;

#[derive(Serialize)]
pub struct CatalogResponse {
    #[serde(flatten)]
    snapshot: CatalogSnapshot,
    warning: Option<String>,
    error_kind: Option<String>,
}

#[tauri::command]
pub async fn catalog(
    force_refresh: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<CatalogResponse> {
    let config = snapshot(&state)?;
    let cache_path = state.store.path().with_extension("catalog.json");
    sdk_job(move || {
        let cache = CatalogCache::new(cache_path, DEFAULT_CATALOG_TTL);
        let cached = match cache.load() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                log(&app, "warn", &format!("目录缓存不可用：{error:#}"));
                None
            }
        };
        if !force_refresh.unwrap_or(false)
            && let Some(snapshot) = cached.as_ref().filter(|snapshot| !snapshot.stale)
        {
            return Ok(CatalogResponse {
                snapshot: snapshot.clone(),
                warning: None,
                error_kind: None,
            });
        }
        let result = sdk_runtime()?.block_on(async {
            let service = paradox_core::ElementalService::new(&config.settings)?;
            tokio::time::timeout(
                Duration::from_secs(config.settings.network.timeout_seconds.into()),
                service.catalog(),
            )
            .await
            .map_err(|_| anyhow::anyhow!("获取版本目录超时，请检查网络后重试"))?
        });
        match result {
            Ok(versions) => {
                let snapshot = CatalogSnapshot::network(versions)?;
                let warning = cache
                    .save(&snapshot)
                    .err()
                    .map(|error| format!("版本目录已更新，但缓存保存失败：{error:#}"));
                Ok(CatalogResponse {
                    snapshot,
                    error_kind: warning.as_ref().map(|_| "filesystem".into()),
                    warning,
                })
            }
            Err(error) => {
                let kind = classify_network_error(&error);
                let message = format!("获取版本目录失败：{error:#}");
                match cached {
                    Some(snapshot) => Ok(CatalogResponse {
                        snapshot,
                        warning: Some(format!("{message}。正在使用已保存的版本目录。")),
                        error_kind: Some(kind.into()),
                    }),
                    None => Err(error.context(format!("网络错误类型：{kind}"))),
                }
            }
        }
    })
    .await
}

fn classify_network_error(error: &anyhow::Error) -> &'static str {
    // Keep user-facing categories stable even when the underlying source adds context.
    let text = error.to_string();
    if text.contains("超时") {
        return "timeout";
    }
    for cause in error.chain() {
        if let Some(http) = cause.downcast_ref::<reqwest::Error>() {
            if http.is_timeout() {
                return "timeout";
            }
            if http.is_connect() {
                return "connection";
            }
            if let Some(status) = http.status() {
                return match status.as_u16() {
                    429 => "rate_limit",
                    401 | 403 => "denied",
                    500..=599 => "server",
                    _ => "http",
                };
            }
            if http.is_decode() {
                return "format";
            }
        }
    }
    "unknown"
}
