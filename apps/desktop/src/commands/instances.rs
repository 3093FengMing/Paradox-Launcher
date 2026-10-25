use std::{collections::HashSet, path::PathBuf, sync::atomic::Ordering};

use paradox_core::{
    AppConfig, GameProfile, InstalledInstance,
    instances::{
        register_instances_from_scan, remove_profile_files, remove_profile_record, scan_game_root,
    },
};
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

#[tauri::command]
pub async fn remove_profile(
    key: String,
    delete_files: bool,
    state: State<'_, AppState>,
) -> CommandResult<AppConfig> {
    let guard = BusyGuard::claim(&state)?;
    let mut config = snapshot(&state)?;
    remove_profile_record(&mut config, &key).map_err(|error| format!("{error:#}"))?;
    // Save the record removal first. A filesystem failure leaves the files intact
    // or reports the partial deletion, and never leaves a record pointing to it.
    state
        .store
        .save(&config)
        .map_err(|error| format!("{error:#}"))?;
    let original = {
        let mut current = state.config.lock().map_err(|_| "配置锁不可用")?;
        let original = current.clone();
        *current = config.clone();
        original
    };
    if delete_files {
        sdk_job(move || {
            remove_profile_files(&original, &key)?;
            Ok(())
        })
        .await?;
    }
    drop(guard);
    Ok(config)
}
