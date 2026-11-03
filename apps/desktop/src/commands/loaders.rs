use super::{CommandResult, sdk_job, sdk_runtime, snapshot};
use crate::AppState;
use tauri::State;
#[tauri::command]
pub async fn loader_versions(
    loader: String,
    game: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<paradox_core::loaders::LoaderVersion>> {
    let settings = snapshot(&state)?.settings;
    sdk_job(move || {
        sdk_runtime()?.block_on(paradox_core::loaders::versions(&settings, &loader, &game))
    })
    .await
}
