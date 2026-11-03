use super::{CommandResult, snapshot};

#[tauri::command]
pub async fn open_login_page(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let uri = state
        .accounts
        .verification_uri(&id)
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || open::that(uri))
        .await
        .map_err(|_| "auth.errors.service".to_string())?
        .map_err(|_| "auth.errors.service".into())
}
use crate::AppState;
use paradox_core::{accounts::AccountsState, auth::LoginPrompt};
use tauri::State;

#[tauri::command]
pub async fn account_state(state: State<'_, AppState>) -> CommandResult<AccountsState> {
    snapshot(&state)?;
    state.accounts.state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn account_skin(
    account_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Option<String>> {
    let config = snapshot(&state)?;
    let accounts = state.accounts.state().await.map_err(|e| e.to_string())?;
    let account = accounts
        .accounts
        .iter()
        .find(|account| account.id == account_id)
        .ok_or_else(|| "auth.errors.profile".to_string())?;
    paradox_core::account_skins::AccountSkinCache::new(state.store.path())
        .skin(account, &config.settings.network)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn account_recovery(state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    snapshot(&state)?;
    state.accounts.recovery().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_account_recovery(
    account_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<String>> {
    snapshot(&state)?;
    state
        .accounts
        .clear_recovery(&account_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn configure_microsoft(
    client_id: String,
    state: State<'_, AppState>,
) -> CommandResult<AccountsState> {
    snapshot(&state)?;
    state
        .accounts
        .configure(&client_id)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn begin_login(
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<LoginPrompt> {
    let config = snapshot(&state)?;
    let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    state
        .accounts
        .begin_with_id(&request_id, &config.settings.network)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn complete_login(
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<AccountsState> {
    let config = snapshot(&state)?;
    state
        .accounts
        .complete(&id, &config.settings.network)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn cancel_login(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.accounts.cancel(&id).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn select_account(
    id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<AccountsState> {
    snapshot(&state)?;
    if state.busy.load(std::sync::atomic::Ordering::Acquire) {
        return Err("auth.errors.taskActive".into());
    }
    state.accounts.select(id).await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn refresh_account(
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<AccountsState> {
    let config = snapshot(&state)?;
    state
        .accounts
        .refresh_account(&id, &config.settings.network)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn logout_account(
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<AccountsState> {
    snapshot(&state)?;
    if state.busy.load(std::sync::atomic::Ordering::Acquire) {
        return Err("auth.errors.taskActive".into());
    }
    state.accounts.logout(&id).await.map_err(|e| e.to_string())
}
