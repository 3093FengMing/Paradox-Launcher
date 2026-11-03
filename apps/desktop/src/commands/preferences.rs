use super::{CommandResult, sdk_job, snapshot};
use crate::{
    AppState,
    logs::{LogIdentity, StoredLog},
};
use std::{path::PathBuf, sync::Arc};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn choose_background(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<String>> {
    snapshot(&state)?;
    let config_path = state.store.path().to_owned();
    sdk_job(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("Background image", &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        Ok(Some(paradox_core::preferences::import_background(
            &config_path,
            &PathBuf::from(path.to_string()),
        )?))
    })
    .await
}
#[tauri::command]
pub async fn read_background(id: String, state: State<'_, AppState>) -> CommandResult<String> {
    snapshot(&state)?;
    let config_path = state.store.path().to_owned();
    sdk_job(move || paradox_core::preferences::background_data(&config_path, &id)).await
}
#[tauri::command]
pub async fn stored_logs(state: State<'_, AppState>) -> CommandResult<Vec<StoredLog>> {
    snapshot(&state)?;
    let logs = Arc::clone(&state.logs);
    sdk_job(move || logs.read()).await
}

#[tauri::command]
pub async fn clear_stored_logs(state: State<'_, AppState>) -> CommandResult<LogIdentity> {
    snapshot(&state)?;
    let logs = Arc::clone(&state.logs);
    sdk_job(move || logs.clear()).await
}
