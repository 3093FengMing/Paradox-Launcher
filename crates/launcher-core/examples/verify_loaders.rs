//! Explicit, isolated network/game smoke test for the four supported loaders.
//! Stops each ready game through a controlled process stop; this is recorded
//! separately from a user-requested natural window close.
use std::{
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, ensure};
use paradox_core::{ElementalService, GameProfile, Settings, java, loaders};
use serde::Serialize;
use tokio_util::sync::CancellationToken;

#[derive(Default, Serialize)]
struct LaunchReport {
    ready: bool,
    exit_code: Option<i32>,
    close_mode: String,
    log: PathBuf,
}

#[derive(Serialize)]
struct LoaderReport {
    loader: String,
    game_version: String,
    loader_version: Option<String>,
    installed: bool,
    isolated: bool,
    launches: Vec<LaunchReport>,
    passed: bool,
    error: Option<String>,
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> Result<()> {
    let mut arguments = std::env::args().skip(1);
    let root = PathBuf::from(arguments.next().context(
        "Usage: cargo run -p paradox-core --example verify_loaders -- <absolute-.test-data-root> [fabric,quilt,forge,neoforge] [--canonical-root]",
    )?);
    ensure!(
        root.is_absolute()
            && !root
                .components()
                .any(|component| matches!(component, Component::ParentDir))
            && root
                .components()
                .any(|component| component.as_os_str() == ".test-data"),
        "Choose an absolute isolated directory within .test-data"
    );
    fs::create_dir_all(&root)?;
    let resolved_root = root.canonicalize()?;
    ensure!(
        resolved_root
            .components()
            .any(|component| component.as_os_str() == ".test-data"),
        "The resolved directory must stay within .test-data"
    );
    let selected = arguments
        .next()
        .unwrap_or_else(|| "fabric,quilt,forge,neoforge".into());
    let canonical_root = match arguments.next().as_deref() {
        None => false,
        Some("--canonical-root") => true,
        Some(_) => anyhow::bail!("The optional argument must be --canonical-root"),
    };
    let root = if canonical_root { resolved_root } else { root };
    let report_name = if canonical_root {
        "report-canonical.json"
    } else {
        "report.json"
    };
    let mut reports = Vec::new();
    for loader in selected.split(',') {
        ensure!(matches!(loader, "fabric" | "quilt" | "forge" | "neoforge"));
        let game = if loader == "neoforge" {
            "1.21.1"
        } else {
            "1.20.1"
        };
        let mut report = LoaderReport {
            loader: loader.into(),
            game_version: game.into(),
            loader_version: None,
            installed: false,
            isolated: false,
            launches: Vec::new(),
            passed: false,
            error: None,
        };
        match verify(&root, loader, game, &mut report).await {
            Ok(()) => report.passed = true,
            Err(error) => {
                eprintln!("{loader}: {error:#}");
                report.error = Some(format!("{error:#}"));
            }
        }
        reports.push(report);
        fs::write(root.join(report_name), serde_json::to_vec_pretty(&reports)?)?;
    }
    ensure!(
        reports.iter().all(|report| report.passed),
        "Inspect report.json for loader failures"
    );
    Ok(())
}

async fn verify(root: &Path, loader: &str, game: &str, report: &mut LoaderReport) -> Result<()> {
    let mut settings = Settings {
        game_directory: root.join("minecraft"),
        offline_username: "LoaderTest".into(),
        memory_mb: 3072,
        resolution_width: 960,
        resolution_height: 540,
        ..Settings::default()
    };
    settings.network.timeout_seconds = 60;
    let release = loaders::versions(&settings, loader, game)
        .await?
        .into_iter()
        .find(|version| version.stable)
        .context("The official catalog contained no stable loader release")?;
    report.loader_version = Some(release.version.clone());
    let mut profile = GameProfile::new(&format!("{loader} smoke test"), game)?;
    profile.instance_key = format!("smoke-{loader}-{game}");
    profile.loader = loader.into();
    profile.loader_version = release.version;
    profile.validate()?;

    let runtime_root = root.join("runtimes");
    let required = if game == "1.20.1" { 17 } else { 21 };
    let runtime = match java::select_runtime(required, None, &runtime_root).await {
        Ok(runtime) => runtime,
        Err(_) => {
            println!("Downloading isolated Java {required}");
            let package = java::resolve_package(required, &settings.network).await?;
            java::download_and_install(
                &package,
                &runtime_root,
                settings.network.clone(),
                CancellationToken::new(),
                |_| {},
            )
            .await?
        }
    };
    settings.java_executable = runtime.executable.to_string_lossy().into_owned();
    println!("Installing {loader} {} for {game}", profile.loader_version);
    loaders::prepare(&profile, &settings, &runtime_root).await?;
    let service = ElementalService::new(&settings)?;
    let installed = service.inspect().await?;
    ensure!(
        installed.iter().any(|instance| {
            instance.instance_key == profile.instance_key
                && instance.loader == loader
                && instance.game_version.as_deref() == Some(game)
        }),
        "SDK scan did not identify the installed loader and game version"
    );
    report.installed = true;
    let instance = settings
        .game_directory
        .join("versions")
        .join(&profile.instance_key);
    let baseline = settings
        .game_directory
        .join("versions")
        .join(format!("smoke-vanilla-{game}"));
    for directory in ["config", "saves"] {
        fs::create_dir_all(instance.join(directory))?;
        fs::create_dir_all(baseline.join(directory))?;
        fs::write(
            instance
                .join(directory)
                .join("paradox-loader-isolation.txt"),
            loader,
        )?;
        fs::write(
            baseline
                .join(directory)
                .join("paradox-loader-isolation.txt"),
            "vanilla",
        )?;
    }
    for attempt in 1..=2 {
        let launch = observe(root, &settings, &profile, &runtime_root, attempt).await?;
        let ready = launch.ready;
        report.launches.push(launch);
        ensure!(ready, "Game did not reach texture and sound readiness");
    }
    for directory in ["config", "saves"] {
        ensure!(
            fs::read_to_string(
                instance
                    .join(directory)
                    .join("paradox-loader-isolation.txt")
            )? == loader
                && fs::read_to_string(
                    baseline
                        .join(directory)
                        .join("paradox-loader-isolation.txt")
                )? == "vanilla",
            "A loader launch changed another instance's configuration or save marker"
        );
    }
    ensure!(
        instance.join("logs/latest.log").exists(),
        "The game did not write logs in its instance directory"
    );
    report.isolated = true;
    Ok(())
}

async fn observe(
    root: &Path,
    settings: &Settings,
    profile: &GameProfile,
    runtimes: &Path,
    attempt: usize,
) -> Result<LaunchReport> {
    let log_path = root.join(format!("{}-{attempt}.log", profile.loader));
    let mut log = File::create(&log_path)?;
    let mut game = ElementalService::new(settings)?
        .launch_with_runtime_directory(profile, settings, runtimes)
        .await?;
    let started = Instant::now();
    let mut textures = false;
    let mut sound = false;
    let mut report = LaunchReport {
        log: log_path,
        ..LaunchReport::default()
    };
    let status = loop {
        tokio::select! {
            status = game.child.wait() => {
                report.close_mode = "natural".into();
                break status?;
            }
            line = game.lines.recv() => {
                let Some(line) = line else {
                    report.close_mode = "natural".into();
                    break game.child.wait().await?;
                };
                writeln!(log, "{}", line.line)?;
                log.flush()?;
                textures |= line.line.contains("Created:") && (line.line.contains("atlas") || line.line.contains("texture"));
                sound |= line.line.contains("Sound engine started") || line.line.contains("OpenAL initialized");
                if textures && sound {
                    report.ready = true;
                    report.close_mode = "controlled_stop".into();
                    game.child.kill().await?;
                    break game.child.wait().await?;
                }
            }
            () = tokio::time::sleep(Duration::from_secs(180).saturating_sub(started.elapsed())) => {
                report.close_mode = "startup_timeout".into();
                game.child.kill().await?;
                break game.child.wait().await?;
            }
        }
    };
    while let Ok(line) = game.lines.try_recv() {
        writeln!(log, "{}", line.line)?;
    }
    log.sync_all()?;
    report.exit_code = status.code();
    println!(
        "{} launch {attempt}: ready={}, exit={:?}, {}",
        profile.loader, report.ready, report.exit_code, report.close_mode
    );
    Ok(report)
}
