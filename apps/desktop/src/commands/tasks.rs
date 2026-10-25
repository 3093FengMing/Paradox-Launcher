use tauri::State;

use super::{CommandResult, java::managed_root, profile, snapshot};
use crate::{
    AppState,
    downloads::{DownloadKind, DownloadRequest, DownloadStatus, DownloadTask},
};

#[tauri::command]
pub fn download_tasks(state: State<'_, AppState>) -> CommandResult<Vec<DownloadTask>> {
    state.downloads.list().map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn enqueue_install(
    key: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<DownloadTask> {
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    state
        .downloads
        .enqueue(
            app,
            DownloadRequest::Install { config, profile },
            state.busy.clone(),
        )
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn enqueue_java(
    major_version: u32,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<DownloadTask> {
    let config = snapshot(&state)?;
    state
        .downloads
        .enqueue(
            app,
            DownloadRequest::Java {
                settings: config.settings,
                major: major_version,
                managed_root: managed_root(&state),
            },
            state.busy.clone(),
        )
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn cancel_task(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .downloads
        .cancel(&id, &app)
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn retry_task(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<DownloadTask> {
    let config = snapshot(&state)?;
    let task = state
        .downloads
        .list()
        .map_err(|error| format!("{error:#}"))?
        .into_iter()
        .find(|task| task.id == id)
        .ok_or("下载任务不存在")?;
    if !matches!(
        task.status,
        DownloadStatus::Failed | DownloadStatus::Cancelled
    ) {
        return Err("只有失败或已取消的任务可以重试".into());
    }
    let request = match task.kind {
        DownloadKind::Install => {
            let profile = profile(
                &config,
                task.profile_key.as_deref().ok_or("任务没有实例信息")?,
            )?;
            DownloadRequest::Install { config, profile }
        }
        DownloadKind::Java => DownloadRequest::Java {
            settings: config.settings,
            major: task.java_major.ok_or("任务没有 Java 版本信息")?,
            managed_root: managed_root(&state),
        },
    };
    state
        .downloads
        .enqueue(app, request, state.busy.clone())
        .map_err(|error| format!("{error:#}"))
}
