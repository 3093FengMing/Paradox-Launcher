use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use paradox_core::{AppConfig, ElementalService, GameProfile, InstalledInstance};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::AppState;

pub mod accounts;
pub mod catalog;
pub mod content;
pub mod instances;
pub mod java;
pub mod loaders;
pub mod preferences;
pub mod tasks;
pub mod ui_suite;
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

pub(crate) fn snapshot(state: &AppState) -> CommandResult<AppConfig> {
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

pub(crate) fn profile(config: &AppConfig, key: &str) -> CommandResult<GameProfile> {
    config
        .profiles
        .iter()
        .find(|profile| profile.instance_key == key)
        .cloned()
        .ok_or_else(|| "实例不存在".into())
}

pub(crate) fn sdk_runtime() -> anyhow::Result<tokio::runtime::Runtime> {
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

pub(crate) fn activity(app: &tauri::AppHandle, action: &str, status: &str, message: &str) {
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

pub(crate) fn log(app: &tauri::AppHandle, level: &str, message: &str) {
    let state = app.state::<AppState>();
    let retain = state
        .config
        .lock()
        .map(|config| config.settings.personalization.retain_logs)
        .unwrap_or(false);
    match state.logs.record(level, message, retain) {
        Ok(record) => {
            let _ = app.emit("launcher://log", record);
        }
        Err(error) => tracing::warn!(%error, "Unable to identify launcher log"),
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
    loader: Option<String>,
    loader_version: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<AppConfig> {
    ensure_config_loaded(&state)?;
    let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
    if state.busy.load(Ordering::Acquire) {
        return Err("请在当前任务结束后创建实例".into());
    }
    let mut profile = GameProfile::new(&name, &version).map_err(|error| format!("{error:#}"))?;
    profile.loader = loader.unwrap_or_else(|| "vanilla".into());
    profile.loader_version = loader_version.unwrap_or_default();
    profile.validate().map_err(|error| error.to_string())?;
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
    crate::launch::start(&key, app, &state).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub async fn stop_game(app: tauri::AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    crate::launch::request_stop(&app, &state.launch).map_err(|error| format!("{error:#}"))
}
