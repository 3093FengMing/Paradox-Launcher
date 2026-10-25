use std::{
    process::ExitStatus,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use paradox_core::{AppConfig, ElementalService, GameProfile, InstalledInstance};
use serde::Serialize;
use tauri::{Emitter, State};

use crate::AppState;

pub mod catalog;
pub mod instances;
pub mod java;
pub mod tasks;
pub mod window;

type CommandResult<T> = Result<T, String>;

#[derive(Clone, Serialize)]
pub struct Bootstrap {
    config: AppConfig,
    config_path: String,
}

#[derive(Clone, Serialize)]
struct ActivityEvent {
    action: String,
    status: String,
    message: String,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    level: String,
    message: String,
}

struct BusyGuard(Arc<AtomicBool>);

impl BusyGuard {
    fn claim(state: &AppState) -> CommandResult<Self> {
        state
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "已有安装或游戏进程正在运行".to_string())?;
        Ok(Self(Arc::clone(&state.busy)))
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn snapshot(state: &AppState) -> CommandResult<AppConfig> {
    ensure_config_loaded(state)?;
    state
        .config
        .lock()
        .map(|config| config.clone())
        .map_err(|_| "配置锁不可用".into())
}

fn ensure_config_loaded(state: &AppState) -> CommandResult<()> {
    match &state.startup_error {
        Some(error) => Err(format!("无法读取启动器配置：{error}")),
        None => Ok(()),
    }
}

fn profile(config: &AppConfig, key: &str) -> CommandResult<GameProfile> {
    config
        .profiles
        .iter()
        .find(|profile| profile.instance_key == key)
        .cloned()
        .ok_or_else(|| "实例不存在".into())
}

fn sdk_runtime() -> anyhow::Result<tokio::runtime::Runtime> {
    Ok(tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?)
}

// Some Elemental futures hold non-Send driver trait objects. Create and poll
// those futures inside a worker, rather than moving them onto Tauri's executor.
async fn sdk_job<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| format!("SDK 工作线程失败：{error}"))?
        .map_err(|error| format!("{error:#}"))
}

fn activity(app: &tauri::AppHandle, action: &str, status: &str, message: &str) {
    let _ = app.emit(
        "launcher://activity",
        ActivityEvent {
            action: action.into(),
            status: status.into(),
            message: message.into(),
        },
    );
    log(
        app,
        if status == "error" { "error" } else { "info" },
        message,
    );
}

fn log(app: &tauri::AppHandle, level: &str, message: &str) {
    let _ = app.emit(
        "launcher://log",
        LogEvent {
            level: level.into(),
            message: message.into(),
        },
    );
}

struct GameExit {
    status: ExitStatus,
    stopped: bool,
}

// This future stays on the SDK worker's runtime for the entire game lifetime.
// A failed stop request leaves supervision active so logs and exit status are
// still collected, and the user can try stopping the process again.
async fn supervise_game(
    app: &tauri::AppHandle,
    config: &AppConfig,
    profile: &GameProfile,
    managed_runtime_root: &std::path::Path,
    mut stop: tokio::sync::mpsc::Receiver<()>,
) -> anyhow::Result<GameExit> {
    let effective = profile.effective_settings(&config.settings)?;
    let service = ElementalService::new(&effective)?;
    let mut process = service
        .launch_with_runtime_directory(profile, &effective, managed_runtime_root)
        .await?;
    activity(
        app,
        "launch",
        "running",
        &format!("{} 已启动", profile.name),
    );

    let mut lines_open = true;
    let mut stop_open = true;
    let mut stopped = false;
    let status = loop {
        tokio::select! {
            exit = process.child.wait() => break exit?,
            line = process.lines.recv(), if lines_open => {
                if let Some(line) = line {
                    log(app, "game", &line.line);
                } else {
                    lines_open = false;
                }
            }
            request = stop.recv(), if stop_open => {
                match request {
                    Some(()) => match process.child.kill().await {
                        Ok(()) => {
                            stopped = true;
                            log(app, "info", "已停止游戏进程");
                        }
                        Err(error) => log(app, "error", &format!("停止游戏失败：{error}")),
                    },
                    None => stop_open = false,
                }
            }
        }
    };

    while let Ok(line) = process.lines.try_recv() {
        log(app, "game", &line.line);
    }
    Ok(GameExit { status, stopped })
}

fn report_game_exit(app: &tauri::AppHandle, result: anyhow::Result<GameExit>) {
    match result {
        Ok(exit) if exit.stopped => activity(app, "launch", "finished", "游戏已停止"),
        Ok(exit) => activity(
            app,
            "launch",
            if exit.status.success() {
                "finished"
            } else {
                "error"
            },
            &format!("游戏进程已退出：{}", exit.status),
        ),
        Err(error) => activity(
            app,
            "launch",
            "error",
            &format!("启动或等待游戏进程失败：{error:#}"),
        ),
    }
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> CommandResult<Bootstrap> {
    Ok(Bootstrap {
        config: snapshot(&state)?,
        config_path: state.store.path().display().to_string(),
    })
}

#[tauri::command]
pub fn save_config(config: AppConfig, state: State<'_, AppState>) -> CommandResult<AppConfig> {
    ensure_config_loaded(&state)?;
    let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
    if state.busy.load(Ordering::Acquire) {
        return Err("请在安装或游戏结束后保存设置".into());
    }
    state
        .store
        .save(&config)
        .map_err(|error| format!("{error:#}"))?;
    *current = config.clone();
    Ok(config)
}

#[tauri::command]
pub fn create_profile(
    name: String,
    version: String,
    state: State<'_, AppState>,
) -> CommandResult<AppConfig> {
    ensure_config_loaded(&state)?;
    let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
    if state.busy.load(Ordering::Acquire) {
        return Err("请在当前任务结束后创建实例".into());
    }
    let profile = GameProfile::new(&name, &version).map_err(|error| format!("{error:#}"))?;
    let mut config = current.clone();
    config.active_profile = Some(profile.instance_key.clone());
    config.profiles.push(profile);
    state
        .store
        .save(&config)
        .map_err(|error| format!("{error:#}"))?;
    *current = config.clone();
    Ok(config)
}

#[tauri::command]
pub async fn inspect_instances(
    state: State<'_, AppState>,
) -> CommandResult<Vec<InstalledInstance>> {
    let config = snapshot(&state)?;
    sdk_job(move || {
        sdk_runtime()?.block_on(async {
            let mut roots = std::collections::HashSet::new();
            roots.insert(config.settings.game_directory.clone());
            for profile in &config.profiles {
                roots.insert(profile.effective_settings(&config.settings)?.game_directory);
            }
            let mut instances = Vec::new();
            for root in roots {
                instances.extend(
                    paradox_core::instances::scan_known_game_root(&config.settings, &root).await?,
                );
            }
            Ok(instances)
        })
    })
    .await
}

#[tauri::command]
pub async fn prepare_instance(
    key: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    let guard = BusyGuard::claim(&state)?;
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    activity(
        &app,
        "install",
        "started",
        &format!(
            "正在安装 / 修复 {} · {}",
            profile.name, profile.game_version
        ),
    );
    let result = sdk_job(move || {
        let _guard = guard;
        sdk_runtime()?.block_on(async {
            let effective = profile.effective_settings(&config.settings)?;
            ElementalService::new(&effective)?.prepare(&profile).await
        })
    })
    .await;
    match result {
        Ok(root) => {
            activity(&app, "install", "finished", "实例安装完成");
            Ok(root.display().to_string())
        }
        Err(message) => {
            activity(&app, "install", "error", &message);
            Err(message)
        }
    }
}

#[tauri::command]
pub async fn launch_instance(
    key: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let guard = BusyGuard::claim(&state)?;
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    let (sender, stop) = tokio::sync::mpsc::channel(1);
    let managed_runtime_root = java::managed_root(&state);
    let stop_sender = Arc::clone(&state.stop_sender);
    *stop_sender.lock().map_err(|_| "进程锁不可用")? = Some(sender);
    activity(&app, "launch", "started", "正在检查 Java 并构建启动命令");
    tauri::async_runtime::spawn_blocking(move || {
        let result = sdk_runtime().and_then(|runtime| {
            runtime.block_on(supervise_game(
                &app,
                &config,
                &profile,
                &managed_runtime_root,
                stop,
            ))
        });
        if let Ok(mut sender) = stop_sender.lock() {
            *sender = None;
        }
        drop(guard);
        report_game_exit(&app, result);
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_game(state: State<'_, AppState>) -> CommandResult<()> {
    let sender = state
        .stop_sender
        .lock()
        .map_err(|_| "进程锁不可用")?
        .clone()
        .ok_or_else(|| "没有运行中的游戏".to_string())?;
    sender.send(()).await.map_err(|_| "游戏进程已经退出".into())
}
