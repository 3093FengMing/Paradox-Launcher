use std::path::PathBuf;

use paradox_core::java::{self, JavaDiscovery, JavaInstallation};
use tauri::State;

use super::{CommandResult, sdk_job, sdk_runtime, snapshot};
use crate::AppState;

pub fn managed_root(state: &AppState) -> PathBuf {
    let root = state
        .store
        .path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("runtimes");
    if root.is_absolute() {
        root
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| paradox_core::model::default_data_directory())
            .join(root)
    }
}

#[tauri::command]
pub async fn discover_java(state: State<'_, AppState>) -> CommandResult<JavaDiscovery> {
    let config = snapshot(&state)?;
    let managed = managed_root(&state);
    sdk_job(move || {
        let mut configured = Vec::new();
        if !config.settings.java_executable.trim().is_empty() {
            configured.push(PathBuf::from(&config.settings.java_executable));
        }
        for profile in &config.profiles {
            if let Some(java) = profile
                .overrides
                .java_executable
                .as_ref()
                .filter(|java| !java.trim().is_empty())
            {
                configured.push(PathBuf::from(java));
            }
        }
        sdk_runtime()?.block_on(java::discover(&configured, &managed))
    })
    .await
}

#[tauri::command]
pub async fn inspect_java(
    path: String,
    state: State<'_, AppState>,
) -> CommandResult<JavaInstallation> {
    snapshot(&state)?;
    sdk_job(move || sdk_runtime()?.block_on(java::inspect(&PathBuf::from(path)))).await
}
