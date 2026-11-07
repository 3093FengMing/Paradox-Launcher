#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;
mod downloads;
mod launch;
mod loader_worker;
mod logs;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, atomic::AtomicBool},
};

use anyhow::Result;
use paradox_core::{AppConfig, ConfigStore};
use tauri::Manager;

pub struct AppState {
    pub store: ConfigStore,
    pub config: Arc<Mutex<AppConfig>>,
    pub startup_error: Option<String>,
    pub busy: Arc<AtomicBool>,
    pub launch: Arc<launch::LaunchController>,
    pub downloads: downloads::DownloadManager,
    pub profile_file_removals:
        Mutex<HashMap<String, paradox_core::instances::PreparedProfileRemoval>>,
    pub accounts: Arc<paradox_core::accounts::AccountsManager>,
    pub logs: Arc<logs::LogStore>,
    pub ui_suite: Arc<paradox_core::ui_suite::UiSuiteStore>,
    pub exit_allowed: AtomicBool,
    pub backgrounded: AtomicBool,
}

fn configure_ui_safe(config: &mut tauri::Config) -> Result<()> {
    let main = config
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
        .ok_or_else(|| anyhow::anyhow!("UI recovery requires the main launcher window"))?;
    // Tauri joins this app path against devUrl or the packaged protocol URL.
    // Set the query before creating the first webview, so no user source runs
    // before the frontend sees recovery mode.
    main.url = tauri::WebviewUrl::App("index.html?ui-safe=1".into());
    Ok(())
}

fn ui_safe_url(mut url: tauri::Url) -> tauri::Url {
    let preserved: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "ui-safe")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.set_query(None);
    url.query_pairs_mut()
        .extend_pairs(preserved)
        .append_pair("ui-safe", "1");
    url
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
    let argument = std::env::args().nth(1);
    let ui_safe = argument.as_deref() == Some("--ui-safe");
    if let Some(argument) = argument.as_deref().filter(|_| !ui_safe) {
        if argument == "--install-loader" {
            let path = std::env::args_os()
                .nth(2)
                .ok_or_else(|| anyhow::anyhow!("loaders.errors.worker"))?;
            return loader_worker::run(std::path::Path::new(&path));
        }
        return cli::run(argument, &store);
    }
    // Keep the application reachable when its saved configuration needs repair.
    // Commands reject writes until loading succeeds, preserving the original file.
    let (config, startup_error) = match store.load() {
        Ok(config) => (config, None),
        Err(error) => (AppConfig::default(), Some(format!("{error:#}"))),
    };
    let accounts = Arc::new(paradox_core::accounts::AccountsManager::new(store.path()));
    let logs = Arc::new(logs::LogStore::new(store.path()));
    let mut context = tauri::generate_context!();
    let ui_suite = Arc::new(paradox_core::ui_suite::UiSuiteStore::new(store.path()));
    if ui_safe {
        configure_ui_safe(context.config_mut())?;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.get(1).is_some_and(|argument| argument == "--ui-safe")
                && let Some(window) = app.get_webview_window("main")
                && let Err(error) = window
                    .url()
                    .map(ui_safe_url)
                    .and_then(|url| window.navigate(url))
            {
                tracing::warn!(%error, "Unable to navigate the launcher into UI recovery");
            }
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
            config: Arc::new(Mutex::new(config)),
            startup_error,
            busy: Arc::new(AtomicBool::new(false)),
            launch: Arc::new(launch::LaunchController::default()),
            downloads: downloads::DownloadManager::default(),
            profile_file_removals: Mutex::new(HashMap::new()),
            accounts,
            logs,
            ui_suite,
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
            commands::instances::retry_profile_files,
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
            commands::accounts::account_state,
            commands::accounts::account_skin,
            commands::accounts::account_recovery,
            commands::accounts::clear_account_recovery,
            commands::accounts::configure_microsoft,
            commands::accounts::begin_login,
            commands::accounts::complete_login,
            commands::accounts::cancel_login,
            commands::accounts::select_account,
            commands::accounts::refresh_account,
            commands::accounts::logout_account,
            commands::accounts::open_login_page,
            commands::loaders::loader_versions,
            commands::content::search_content,
            commands::content::list_content,
            commands::content::toggle_mod,
            commands::content::remove_content,
            commands::content::open_content_directory,
            commands::content::enqueue_content,
            commands::content::enqueue_pack,
            commands::content::export_instance,
            commands::content::choose_pack,
            commands::preferences::choose_background,
            commands::preferences::read_background,
            commands::preferences::stored_logs,
            commands::preferences::clear_stored_logs,
            commands::ui_suite::get_ui_suite_library,
            commands::ui_suite::save_ui_suite_library,
            commands::ui_suite::reset_ui_suite_library,
            commands::ui_suite::read_ui_suite_recoverable,
            commands::ui_suite::inspect_ui_suite_recovery,
            commands::ui_suite::reset_recoverable_ui_suite_library,
        ])
        .run(context)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_safe_configuration_changes_only_the_main_initial_url() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut secondary = config.app.windows[0].clone();
        secondary.label = "secondary".into();
        secondary.url = tauri::WebviewUrl::App("secondary.html".into());
        config.app.windows.push(secondary);
        let mut expected = config.clone();
        expected.app.windows[0].url = tauri::WebviewUrl::App("index.html?ui-safe=1".into());

        configure_ui_safe(&mut config).unwrap();
        assert_eq!(
            serde_json::to_value(config).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }

    #[test]
    fn ui_safe_initial_query_survives_dev_and_packaged_url_resolution() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        configure_ui_safe(&mut config).unwrap();
        let tauri::WebviewUrl::App(path) = &config.app.windows[0].url else {
            panic!("safe startup must still load bundled app content");
        };
        // Mirrors Tauri's prepare_webview URL join, including the Windows
        // custom-protocol origins. Its asset resolver strips the query.
        for origin in [
            "http://localhost:1420/",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "tauri://localhost/",
        ] {
            let resolved = tauri::Url::parse(origin)
                .unwrap()
                .join(&path.to_string_lossy())
                .unwrap();
            assert_eq!(resolved.path(), "/index.html");
            assert_eq!(resolved.query(), Some("ui-safe=1"));
        }
    }

    #[test]
    fn ui_safe_forwarded_navigation_preserves_other_parameters_and_replaces_the_flag() {
        let current = tauri::Url::parse(
            "http://tauri.localhost/index.html?language=zh-CN&ui-safe=0&ui-safe=0#settings",
        )
        .unwrap();
        let recovered = ui_safe_url(current);
        assert_eq!(recovered.path(), "/index.html");
        assert_eq!(recovered.fragment(), Some("settings"));
        assert_eq!(recovered.query(), Some("language=zh-CN&ui-safe=1"));
        assert_eq!(ui_safe_url(recovered.clone()), recovered);
    }

    #[test]
    fn ui_safe_configuration_rejects_a_missing_main_window() {
        let mut config = tauri::Config::default();
        assert!(configure_ui_safe(&mut config).is_err());
        assert!(config.app.windows.is_empty());
    }
}
