use std::time::Duration;

use anyhow::{Result, bail};
use paradox_core::{ConfigStore, ElementalService};

pub fn run(argument: &str, store: &ConfigStore) -> Result<()> {
    match argument {
        "--version" | "-V" => {
            println!("Paradox Launcher {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        "--help" | "-h" => {
            println!(
                "Paradox Launcher {}\n  --version        Show the application version\n  --check-catalog  Fetch the Elemental / Mojang catalog\n  --inspect        Scan installed instances\nConfig: {}",
                env!("CARGO_PKG_VERSION"),
                store.path().display()
            );
            return Ok(());
        }
        "--check-catalog" | "--inspect" => {}
        _ => bail!("未知参数：{argument}，使用 --help 查看用法"),
    }

    let config = store.load()?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let service = ElementalService::new(&config.settings)?;
        if argument == "--check-catalog" {
            let versions =
                tokio::time::timeout(Duration::from_secs(30), service.catalog()).await??;
            println!("Elemental catalog: {} versions", versions.len());
            for version in versions.iter().take(10) {
                println!("{} ({})", version.id, version.kind);
            }
        } else {
            let instances = service.inspect().await?;
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
        }
        Ok(())
    })
}
