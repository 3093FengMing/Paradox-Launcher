use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::{CommandResult, log};
use crate::AppState;

#[derive(Serialize, Clone)]
struct CloseRequest {
    game_running: bool,
    downloads_active: bool,
}

pub fn show(app: &tauri::AppHandle) {
    app.state::<AppState>()
        .backgrounded
        .store(false, Ordering::Release);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn handle_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    if state.exit_allowed.load(Ordering::Acquire) || !state.busy.load(Ordering::Acquire) {
        return;
    }
    api.prevent_close();
    let behavior = state
        .config
        .lock()
        .map(|config| config.settings.close_behavior.clone())
        .unwrap_or_else(|_| "ask".into());
    if behavior == "ask" {
        let game_running = state
            .stop_sender
            .lock()
            .map(|sender| sender.is_some())
            .unwrap_or(false);
        let _ = app.emit(
            "launcher://close-requested",
            CloseRequest {
                game_running,
                downloads_active: state.downloads.has_pending(),
            },
        );
    } else {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(message) = close(&app, &behavior).await {
                log(&app, "error", &message);
                let _ = app.emit("launcher://close-error", message);
            }
        });
    }
}

#[tauri::command]
pub async fn close_launcher(mode: String, app: tauri::AppHandle) -> CommandResult<()> {
    close(&app, &mode).await
}

async fn close(app: &tauri::AppHandle, mode: &str) -> CommandResult<()> {
    let state = app.state::<AppState>();
    match mode {
        "stay" => {
            show(app);
            return Ok(());
        }
        "background" => {
            if !state.busy.load(Ordering::Acquire) {
                exit(app);
                return Ok(());
            }
            state.backgrounded.store(true, Ordering::Release);
            if let Some(window) = app.get_webview_window("main") {
                window
                    .hide()
                    .map_err(|error| format!("无法隐藏启动器：{error}"))?;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let state = app.state::<AppState>();
                    if !state.backgrounded.load(Ordering::Acquire) {
                        break;
                    }
                    if !state.busy.load(Ordering::Acquire) {
                        exit(&app);
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            });
            return Ok(());
        }
        "stop" => {}
        _ => return Err("关闭行为无效".into()),
    }
    state.downloads.cancel_all(app);
    let sender = state
        .stop_sender
        .lock()
        .map_err(|_| "进程锁不可用")?
        .clone();
    if let Some(sender) = sender {
        let _ = sender.try_send(());
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    while state.busy.load(Ordering::Acquire) {
        if Instant::now() >= deadline {
            show(app);
            return Err("任务尚未安全结束，窗口已保留。请稍后重试关闭。".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    exit(app);
    Ok(())
}

fn exit(app: &tauri::AppHandle) {
    app.state::<AppState>()
        .exit_allowed
        .store(true, Ordering::Release);
    app.exit(0);
}

#[tauri::command]
pub async fn choose_directory(
    title: String,
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> CommandResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .transpose()
            .map_err(|error| format!("无法读取目录选择结果：{error}"))
    })
    .await
    .map_err(|error| format!("目录选择器失败：{error}"))?
}

#[tauri::command]
pub async fn choose_java(
    title: String,
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> CommandResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(title);
        if cfg!(windows) {
            dialog = dialog.add_filter("Java 可执行文件", &["exe"]);
        }
        dialog
            .blocking_pick_file()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .transpose()
            .map_err(|error| format!("无法读取 Java 选择结果：{error}"))
    })
    .await
    .map_err(|error| format!("Java 选择器失败：{error}"))?
}
