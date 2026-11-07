use std::{collections::HashSet, path::PathBuf, sync::atomic::Ordering};

use paradox_core::{
    AppConfig, GameProfile, InstalledInstance,
    instances::{
        FileRemoval, PreparedProfileRemoval, prepare_profile_file_removal,
        register_instances_from_scan, remove_profile_record, scan_game_root,
    },
};
use serde::Serialize;
use tauri::State;

use super::{BusyGuard, CommandResult, ensure_config_loaded, sdk_job, sdk_runtime, snapshot};
use crate::AppState;

#[tauri::command]
pub async fn scan_import(
    directory: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<InstalledInstance>> {
    let config = snapshot(&state)?;
    sdk_job(move || {
        sdk_runtime()?.block_on(scan_game_root(&config.settings, &PathBuf::from(directory)))
    })
    .await
}

#[tauri::command]
pub async fn import_instances(
    directory: String,
    keys: Vec<String>,
    state: State<'_, AppState>,
) -> CommandResult<AppConfig> {
    let guard = BusyGuard::claim(&state)?;
    let config = snapshot(&state)?;
    let directory = PathBuf::from(directory);
    let settings = config.settings;
    let scan_directory = directory.clone();
    let instances =
        sdk_job(move || sdk_runtime()?.block_on(scan_game_root(&settings, &scan_directory)))
            .await?;
    let selected: HashSet<_> = keys.into_iter().collect();
    if selected.is_empty() {
        return Err("请选择需要导入的实例".into());
    }
    if !selected.iter().all(|key| {
        instances
            .iter()
            .any(|instance| &instance.instance_key == key)
    }) {
        return Err("所选实例已发生变化，请重新扫描".into());
    }
    let instances: Vec<_> = instances
        .into_iter()
        .filter(|instance| selected.contains(&instance.instance_key))
        .collect();
    let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
    let mut config = current.clone();
    register_instances_from_scan(&mut config, &directory, &instances)
        .map_err(|error| format!("{error:#}"))?;
    state
        .store
        .save(&config)
        .map_err(|error| format!("{error:#}"))?;
    *current = config.clone();
    drop(guard);
    Ok(config)
}

#[tauri::command]
pub fn update_profile(
    profile: GameProfile,
    state: State<'_, AppState>,
) -> CommandResult<AppConfig> {
    ensure_config_loaded(&state)?;
    let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
    if state.busy.load(Ordering::Acquire) {
        return Err("请在下载或游戏结束后编辑实例".into());
    }
    let mut config = current.clone();
    let existing = config
        .profiles
        .iter_mut()
        .find(|item| item.instance_key == profile.instance_key)
        .ok_or("实例不存在")?;
    if existing.game_version != profile.game_version
        || existing.game_directory != profile.game_directory
    {
        return Err("实例编辑不能改变已有游戏版本或存储根目录，请重新导入或创建实例".into());
    }
    *existing = profile;
    state
        .store
        .save(&config)
        .map_err(|error| format!("{error:#}"))?;
    *current = config.clone();
    Ok(config)
}

#[derive(Serialize)]
pub struct ProfileRemovalResult {
    config: AppConfig,
    file_removal: Option<FileRemoval>,
    file_removal_error: Option<String>,
    file_removal_retry: Option<String>,
    instance_root: Option<PathBuf>,
}

#[tauri::command]
pub async fn remove_profile(
    key: String,
    delete_files: bool,
    state: State<'_, AppState>,
) -> CommandResult<ProfileRemovalResult> {
    remove_profile_with_state(key, delete_files, &state).await
}

async fn remove_profile_with_state(
    key: String,
    delete_files: bool,
    state: &AppState,
) -> CommandResult<ProfileRemovalResult> {
    let guard = BusyGuard::claim(state)?;
    let mut config = snapshot(state)?;
    let prepared = if delete_files {
        let original = config.clone();
        let target_key = key.clone();
        Some(sdk_job(move || prepare_profile_file_removal(&original, &target_key)).await?)
    } else {
        None
    };
    // Acquire both locks before saving: a later lock error must not turn a
    // committed removal into an IPC failure that hides its latest config.
    let token = prepared.as_ref().map(|_| uuid::Uuid::new_v4().to_string());
    {
        let mut removals = state
            .profile_file_removals
            .lock()
            .map_err(|_| "残留文件记录锁不可用")?;
        let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
        remove_profile_record(&mut config, &key).map_err(|error| format!("{error:#}"))?;
        state
            .store
            .save(&config)
            .map_err(|error| format!("{error:#}"))?;
        *current = config.clone();
        if let (Some(token), Some(prepared)) = (&token, &prepared) {
            removals.insert(token.clone(), prepared.clone());
        }
    }
    let result = complete_file_removal(config, prepared, token, state).await;
    drop(guard);
    Ok(result)
}

#[tauri::command]
pub async fn retry_profile_files(
    token: String,
    state: State<'_, AppState>,
) -> CommandResult<ProfileRemovalResult> {
    retry_profile_files_with_state(token, &state).await
}

async fn retry_profile_files_with_state(
    token: String,
    state: &AppState,
) -> CommandResult<ProfileRemovalResult> {
    let guard = BusyGuard::claim(state)?;
    let config = snapshot(state)?;
    let prepared = state
        .profile_file_removals
        .lock()
        .map_err(|_| "残留文件记录锁不可用")?
        .get(&token)
        .cloned()
        .ok_or("残留文件重试记录不存在，请检查原实例目录")?;
    let result = complete_file_removal(config, Some(prepared), Some(token), state).await;
    drop(guard);
    Ok(result)
}

async fn complete_file_removal(
    config: AppConfig,
    prepared: Option<PreparedProfileRemoval>,
    token: Option<String>,
    state: &AppState,
) -> ProfileRemovalResult {
    let mut result = ProfileRemovalResult {
        config,
        file_removal: None,
        file_removal_error: None,
        file_removal_retry: None,
        instance_root: prepared.as_ref().map(|target| target.instance_root.clone()),
    };
    if let Some(prepared) = prepared {
        let current = result.config.clone();
        match sdk_job(move || prepared.remove(&current)).await {
            Ok(removal) => {
                result.file_removal = Some(removal);
                if let Some(token) = token {
                    match state.profile_file_removals.lock() {
                        Ok(mut removals) => {
                            removals.remove(&token);
                        }
                        Err(error) => {
                            tracing::warn!(%error, "Unable to clear completed file-removal retry record")
                        }
                    }
                }
            }
            Err(error) => {
                result.file_removal_error = Some(error);
                result.file_removal_retry = token;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        fs,
        sync::{Arc, Mutex, atomic::AtomicBool},
    };

    fn state() -> (tempfile::TempDir, AppState, PathBuf) {
        let temporary = tempfile::tempdir().unwrap();
        let directory = fs::canonicalize(temporary.path())
            .unwrap()
            .join("minecraft");
        let target = directory.join("versions/world");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("world.jar"), b"game").unwrap();
        let mut profile = GameProfile::new("World", "1.21.1").unwrap();
        profile.instance_key = "world".into();
        let mut config = AppConfig {
            profiles: vec![profile],
            active_profile: Some("world".into()),
            ..AppConfig::default()
        };
        config.settings.game_directory = directory;
        let store = paradox_core::ConfigStore::new(temporary.path().join("config.json"));
        store.save(&config).unwrap();
        let state = AppState {
            accounts: Arc::new(paradox_core::accounts::AccountsManager::new(store.path())),
            logs: Arc::new(crate::logs::LogStore::new(store.path())),
            ui_suite: Arc::new(paradox_core::ui_suite::UiSuiteStore::new(store.path())),
            store,
            config: Arc::new(Mutex::new(config)),
            startup_error: None,
            busy: Arc::new(AtomicBool::new(false)),
            launch: Arc::new(crate::launch::LaunchController::default()),
            downloads: crate::downloads::DownloadManager::default(),
            profile_file_removals: Mutex::new(HashMap::new()),
            exit_allowed: AtomicBool::new(false),
            backgrounded: AtomicBool::new(false),
        };
        (temporary, state, target)
    }

    #[tokio::test]
    async fn successful_removal_returns_committed_config_and_file_result() {
        let (_temporary, state, target) = state();
        let result = remove_profile_with_state("world".into(), true, &state)
            .await
            .unwrap();
        assert!(result.config.profiles.is_empty());
        assert!(result.file_removal.unwrap().removed);
        assert!(result.file_removal_error.is_none());
        assert!(result.file_removal_retry.is_none());
        assert!(!target.exists());
        assert!(state.store.load().unwrap().profiles.is_empty());
        assert!(state.profile_file_removals.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn failed_preflight_keeps_record_and_file_deletion_requires_a_server_token() {
        let (_temporary, state, target) = state();
        fs::remove_dir_all(&target).unwrap();
        fs::write(&target, b"not a version directory").unwrap();
        assert!(
            remove_profile_with_state("world".into(), true, &state)
                .await
                .is_err()
        );
        assert_eq!(state.store.load().unwrap().profiles.len(), 1);
        assert_eq!(state.config.lock().unwrap().profiles.len(), 1);
        assert!(
            retry_profile_files_with_state(target.display().to_string(), &state)
                .await
                .is_err()
        );
        assert_eq!(fs::read(&target).unwrap(), b"not a version directory");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn deletion_failure_returns_saved_config_and_retries_after_the_file_unlocks() {
        use std::os::windows::fs::OpenOptionsExt;
        let (_temporary, state, target) = state();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(target.join("world.jar"))
            .unwrap();
        let result = remove_profile_with_state("world".into(), true, &state)
            .await
            .unwrap();
        assert!(result.config.profiles.is_empty());
        assert!(state.store.load().unwrap().profiles.is_empty());
        assert!(result.file_removal.is_none());
        assert!(result.file_removal_error.is_some());
        let token = result.file_removal_retry.unwrap();
        assert!(
            state
                .profile_file_removals
                .lock()
                .unwrap()
                .contains_key(&token)
        );
        assert!(target.join("world.jar").exists());
        drop(locked);
        let retry = retry_profile_files_with_state(token.clone(), &state)
            .await
            .unwrap();
        assert!(retry.file_removal.unwrap().removed);
        assert!(retry.file_removal_error.is_none());
        assert!(!target.exists());
        assert!(
            !state
                .profile_file_removals
                .lock()
                .unwrap()
                .contains_key(&token)
        );
        assert!(retry_profile_files_with_state(token, &state).await.is_err());
    }
}
