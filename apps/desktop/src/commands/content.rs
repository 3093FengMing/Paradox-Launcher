use super::{
    BusyGuard, CommandResult, java::managed_root, profile, sdk_job, sdk_runtime, snapshot,
};
use crate::{
    AppState,
    downloads::{DownloadRequest, DownloadTask},
};
use paradox_core::content::{ContentEntry, SearchResults};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn search_content(
    query: String,
    category: String,
    offset: u32,
    state: State<'_, AppState>,
) -> CommandResult<SearchResults> {
    let settings = snapshot(&state)?.settings;
    sdk_job(move || {
        sdk_runtime()?.block_on(paradox_core::content::search(
            &settings, &query, &category, offset,
        ))
    })
    .await
}
#[tauri::command]
pub async fn list_content(
    key: String,
    category: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ContentEntry>> {
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    sdk_job(move || paradox_core::content::list(&config.settings, &profile, &category)).await
}
#[tauri::command]
pub async fn toggle_mod(
    key: String,
    name: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let guard = BusyGuard::claim(&state)?;
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    sdk_job(move || {
        let _guard = guard;
        paradox_core::content::toggle(&config.settings, &profile, &name)
    })
    .await
}
#[tauri::command]
pub async fn remove_content(
    key: String,
    category: String,
    name: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let guard = BusyGuard::claim(&state)?;
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    sdk_job(move || {
        let _guard = guard;
        paradox_core::content::remove(&config.settings, &profile, &category, &name)
    })
    .await
}
#[tauri::command]
pub async fn open_content_directory(
    key: String,
    category: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    if !matches!(
        category.as_str(),
        "mods" | "resourcepacks" | "shaderpacks" | "saves"
    ) {
        return Err("content.errors.category".into());
    }
    sdk_job(move || {
        let root = paradox_core::content::root(&config.settings, &profile)?;
        let path = paradox_core::content::path(&root, &category)?;
        std::fs::create_dir_all(&path)?;
        open::that(path)?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn enqueue_content(
    key: String,
    project: String,
    category: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<DownloadTask> {
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    let settings = profile
        .effective_settings(&config.settings)
        .map_err(|e| e.to_string())?;
    state
        .downloads
        .enqueue(
            app,
            DownloadRequest::Content {
                settings,
                profile,
                project,
                category,
            },
            state.busy.clone(),
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn enqueue_pack(
    source: String,
    remote: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<DownloadTask> {
    let settings = snapshot(&state)?.settings;
    if !remote && !PathBuf::from(&source).is_absolute() {
        return Err("content.errors.path".into());
    }
    state
        .downloads
        .enqueue(
            app,
            DownloadRequest::Pack {
                settings,
                source,
                remote,
                store: state.store.clone(),
                config: Arc::clone(&state.config),
                registered: Arc::new(Mutex::new(None)),
                managed_root: managed_root(&state),
            },
            state.busy.clone(),
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn choose_pack(app: tauri::AppHandle) -> CommandResult<Option<String>> {
    sdk_job(move || {
        Ok(app
            .dialog()
            .file()
            .add_filter("Instance / Modrinth pack", &["mrpack", "zip"])
            .blocking_pick_file()
            .map(|path| path.to_string()))
    })
    .await
}
#[tauri::command]
pub async fn export_instance(
    key: String,
    include_saves: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<bool> {
    let guard = BusyGuard::claim(&state)?;
    let config = snapshot(&state)?;
    let profile = profile(&config, &key)?;
    sdk_job(move || {
        let _guard = guard;
        let Some(destination) = app
            .dialog()
            .file()
            .add_filter("Modrinth pack", &["mrpack"])
            .add_filter("Paradox instance", &["zip"])
            .set_file_name("instance.mrpack")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        paradox_core::packs::export(
            &config.settings,
            &profile,
            &PathBuf::from(destination.to_string()),
            include_saves,
        )?;
        Ok(true)
    })
    .await
}
