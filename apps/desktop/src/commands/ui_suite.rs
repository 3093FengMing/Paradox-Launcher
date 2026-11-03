use super::{CommandResult, sdk_job};
use crate::AppState;
use paradox_core::ui_suite::{RecoveryToken, UiSuiteLibrary};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_ui_suite_library(state: State<'_, AppState>) -> CommandResult<UiSuiteLibrary> {
    let store = Arc::clone(&state.ui_suite);
    sdk_job(move || store.load()).await
}
#[tauri::command]
pub async fn save_ui_suite_library(
    library: UiSuiteLibrary,
    expected_revision: u64,
    state: State<'_, AppState>,
) -> CommandResult<UiSuiteLibrary> {
    let store = Arc::clone(&state.ui_suite);
    sdk_job(move || store.save(&library, expected_revision)).await
}
#[tauri::command]
pub async fn reset_ui_suite_library(
    expected_revision: u64,
    state: State<'_, AppState>,
) -> CommandResult<UiSuiteLibrary> {
    let store = Arc::clone(&state.ui_suite);
    sdk_job(move || store.reset(expected_revision)).await
}
#[tauri::command]
pub async fn read_ui_suite_recoverable(state: State<'_, AppState>) -> CommandResult<String> {
    let store = Arc::clone(&state.ui_suite);
    sdk_job(move || {
        Ok(paradox_core::ui_suite::encode_recoverable_bytes(
            &store.read_recoverable()?,
        ))
    })
    .await
}
#[derive(Serialize)]
pub struct RecoveryInspectionIpc {
    raw: String,
    token: RecoveryToken,
}
#[tauri::command]
pub async fn inspect_ui_suite_recovery(
    state: State<'_, AppState>,
) -> CommandResult<RecoveryInspectionIpc> {
    let store = Arc::clone(&state.ui_suite);
    sdk_job(move || {
        let inspection = store.inspect_recovery()?;
        Ok(RecoveryInspectionIpc {
            raw: paradox_core::ui_suite::encode_recoverable_bytes(&inspection.raw),
            token: inspection.token,
        })
    })
    .await
}
#[tauri::command]
pub async fn reset_recoverable_ui_suite_library(
    expected_token: RecoveryToken,
    state: State<'_, AppState>,
) -> CommandResult<UiSuiteLibrary> {
    let store = Arc::clone(&state.ui_suite);
    sdk_job(move || store.reset_recoverable(&expected_token)).await
}
