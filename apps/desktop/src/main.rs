#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;
mod downloads;

use std::sync::{Arc, Mutex, atomic::AtomicBool};

use anyhow::Result;
use paradox_core::{AppConfig, ConfigStore};
use tauri::Manager;

pub struct AppState {
    pub store: ConfigStore,
    pub config: Mutex<AppConfig>,
    pub startup_error: Option<String>,
    pub busy: Arc<AtomicBool>,
    pub stop_sender: Arc<Mutex<Option<tokio::sync::mpsc::Sender<()>>>>,
    pub downloads: downloads::DownloadManager,
    pub exit_allowed: AtomicBool,
    pub backgrounded: AtomicBool,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn,paradox_launcher=info".into()),
        )
        .init();
    let store = std::env::var_os("PARADOX_CONFIG")
        .map(ConfigStore::new)
        .unwrap_or_default();
    if let Some(argument) = std::env::args().nth(1) {
        return cli::run(&argument, &store);
    }
    // Keep the application reachable when its saved configuration needs repair.
    // Commands reject writes until loading succeeds, preserving the original file.
    let (config, startup_error) = match store.load() {
        Ok(config) => (config, None),
        Err(error) => (AppConfig::default(), Some(format!("{error:#}"))),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            commands::window::show(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                window.unminimize()?;
                window.set_focus()?;
            }
            Ok(())
        })
        .manage(AppState {
            store,
            config: Mutex::new(config),
            startup_error,
            busy: Arc::new(AtomicBool::new(false)),
            stop_sender: Arc::new(Mutex::new(None)),
            downloads: downloads::DownloadManager::default(),
            exit_allowed: AtomicBool::new(false),
            backgrounded: AtomicBool::new(false),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                commands::window::handle_close_requested(window, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::create_profile,
            commands::catalog::catalog,
            commands::inspect_instances,
            commands::prepare_instance,
            commands::launch_instance,
            commands::stop_game,
            commands::instances::scan_import,
            commands::instances::import_instances,
            commands::instances::update_profile,
            commands::instances::remove_profile,
            commands::java::discover_java,
            commands::java::inspect_java,
            commands::tasks::download_tasks,
            commands::tasks::enqueue_install,
            commands::tasks::enqueue_java,
            commands::tasks::cancel_task,
            commands::tasks::retry_task,
            commands::window::close_launcher,
            commands::window::choose_directory,
            commands::window::choose_java,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}
