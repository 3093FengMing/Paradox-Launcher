#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;

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
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::create_profile,
            commands::catalog,
            commands::inspect_instances,
            commands::prepare_instance,
            commands::launch_instance,
            commands::stop_game,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}
