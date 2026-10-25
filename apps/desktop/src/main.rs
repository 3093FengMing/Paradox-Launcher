#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::{Arc, Mutex, atomic::AtomicBool};

use anyhow::Result;
use paradox_core::{AppConfig, ConfigStore, ElementalService};
use tauri::Manager;

pub struct AppState {
    pub store: ConfigStore,
    pub config: Mutex<AppConfig>,
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
    let config = store.load()?;
    if let Some(argument) = std::env::args().nth(1) {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?;
        match argument.as_str() {
            "--check-catalog" => runtime.block_on(async {
                let service = ElementalService::new(&config.settings)?;
                let versions =
                    tokio::time::timeout(std::time::Duration::from_secs(30), service.catalog())
                        .await??;
                println!("Elemental catalog: {} versions", versions.len());
                for version in versions.iter().take(10) {
                    println!("{} ({})", version.id, version.kind);
                }
                Ok::<_, anyhow::Error>(())
            })?,
            "--inspect" => runtime.block_on(async {
                let instances = ElementalService::new(&config.settings)?.inspect().await?;
                println!(
                    "Game directory: {}",
                    config.settings.game_directory.display()
                );
                println!("Installed instances: {}", instances.len());
                for instance in instances {
                    println!(
                        "{} [{}] {}",
                        instance.instance_key,
                        instance.loader,
                        instance.root.display()
                    );
                }
                Ok::<_, anyhow::Error>(())
            })?,
            "--help" | "-h" => println!(
                "Paradox Launcher\n  npm run dev\n  --check-catalog  Fetch the Elemental / Mojang catalog\n  --inspect        Scan installed instances\nConfig: {}",
                store.path().display()
            ),
            _ => anyhow::bail!("未知参数：{argument}，使用 --help 查看用法"),
        }
        return Ok(());
    }
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
