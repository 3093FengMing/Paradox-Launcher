//! Run with an explicit isolated directory. Close each ready Minecraft window
//! normally to verify shutdown; an unattended timeout tests forced stop instead.
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, ensure};
use paradox_core::{
    ElementalService, GameProfile, Settings,
    download::DownloadProgress,
    java::{self, JavaInstallation},
};
use serde::Serialize;
use tokio_util::sync::CancellationToken;

#[derive(Default, Serialize)]
struct LaunchReport {
    pid: Option<u32>,
    ready: bool,
    readiness_evidence: Vec<String>,
    exit_code: Option<i32>,
    close_mode: String,
    elapsed_seconds: u64,
    log: PathBuf,
}

#[derive(Serialize)]
struct CaseReport {
    version: String,
    instance_key: String,
    required_java: Option<u32>,
    runtime: Option<JavaInstallation>,
    initial_install: Option<DownloadProgress>,
    repair_install: Option<DownloadProgress>,
    launches: Vec<LaunchReport>,
    passed: bool,
    error: Option<String>,
}

#[derive(Serialize)]
struct MvpReport {
    started_unix_seconds: u64,
    test_root: PathBuf,
    fresh_game_directory: bool,
    latest_release: String,
    managed_java: Option<serde_json::Value>,
    cases: Vec<CaseReport>,
    passed: bool,
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> Result<()> {
    let mut arguments = std::env::args().skip(1);
    let test_root = arguments.next().map(PathBuf::from).context(
        "Usage: cargo run -p paradox-core --example verify_mvp -- <absolute-test-directory> [versions-comma-separated]",
    )?;
    ensure!(
        test_root.is_absolute(),
        "The test directory must be absolute"
    );
    ensure!(
        !test_root
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir)),
        "The test directory cannot contain parent traversal"
    );
    fs::create_dir_all(&test_root)?;
    fs::create_dir_all(test_root.join("logs"))?;
    fs::create_dir_all(test_root.join("results"))?;
    let settings = Settings {
        game_directory: test_root.join("minecraft"),
        offline_username: "ParadoxTest".into(),
        memory_mb: 4096,
        minimum_memory_mb: 512,
        resolution_width: 960,
        resolution_height: 540,
        ..Settings::default()
    };
    settings.validate()?;
    let latest_release = latest_release(&settings).await?;
    let versions: Vec<String> = arguments.next().map_or_else(
        || {
            vec![
                "1.12.2".into(),
                "1.20.1".into(),
                "1.21.1".into(),
                latest_release.clone(),
            ]
        },
        |versions| versions.split(',').map(str::to_owned).collect(),
    );
    let mut report = MvpReport {
        started_unix_seconds: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        test_root: test_root.clone(),
        fresh_game_directory: !settings.game_directory.exists(),
        latest_release,
        managed_java: None,
        cases: Vec::new(),
        passed: false,
    };
    write_json(&test_root.join("report.json"), &report)?;
    let managed = verify_managed_java(&test_root, &settings).await;
    let managed_java = match managed {
        Ok((installation, evidence)) => {
            report.managed_java = Some(evidence);
            Some(installation)
        }
        Err(error) => {
            println!("MANAGED JAVA ERROR: {error:#}");
            report.managed_java =
                Some(serde_json::json!({"passed":false,"error":format!("{error:#}")}));
            None
        }
    };
    write_json(&test_root.join("report.json"), &report)?;
    for version in versions {
        let mut profile = GameProfile::new(&format!("MVP {version}"), &version)?;
        profile.instance_key = format!("mvp-{version}");
        profile.validate()?;
        let mut case = CaseReport {
            version: version.clone(),
            instance_key: profile.instance_key.clone(),
            required_java: None,
            runtime: None,
            initial_install: None,
            repair_install: None,
            launches: Vec::new(),
            passed: false,
            error: None,
        };
        match verify_case(
            &test_root,
            &settings,
            &mut profile,
            managed_java.as_ref(),
            &mut case,
        )
        .await
        {
            Ok(()) => case.passed = true,
            Err(error) => {
                println!("CASE {version} ERROR: {error:#}");
                case.error = Some(format!("{error:#}"));
            }
        }
        write_json(
            &test_root.join("results").join(format!("{version}.json")),
            &case,
        )?;
        report.cases.push(case);
        write_json(&test_root.join("report.json"), &report)?;
    }
    report.passed = report
        .managed_java
        .as_ref()
        .and_then(|result| result.get("passed"))
        .and_then(serde_json::Value::as_bool)
        == Some(true)
        && report.cases.iter().all(|case| case.passed);
    write_json(&test_root.join("report.json"), &report)?;
    println!(
        "MVP REPORT: {} (passed={})",
        test_root.join("report.json").display(),
        report.passed
    );
    ensure!(
        report.passed,
        "One or more MVP verification targets failed; inspect report and game logs"
    );
    Ok(())
}

async fn latest_release(settings: &Settings) -> Result<String> {
    let manifest: serde_json::Value = settings
        .network
        .build_client()?
        .get(settings.network.endpoints()?.version_manifest_url()?)
        .timeout(Duration::from_secs(30))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    manifest
        .pointer("/latest/release")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .context("Mojang manifest did not contain a latest release")
}

async fn verify_managed_java(
    test_root: &Path,
    settings: &Settings,
) -> Result<(JavaInstallation, serde_json::Value)> {
    println!("MANAGED JAVA: resolving Java 21");
    let package = java::resolve_package(21, &settings.network).await?;
    let progress = Arc::new(Mutex::new(None));
    let observed = Arc::clone(&progress);
    let installation = java::download_and_install(
        &package,
        &test_root.join("runtimes"),
        settings.network.clone(),
        CancellationToken::new(),
        move |value| {
            if let Ok(mut last) = observed.lock() {
                *last = Some(value);
            }
        },
    )
    .await?;
    let reuse_events = Arc::new(AtomicUsize::new(0));
    let events = Arc::clone(&reuse_events);
    let reused = java::download_and_install(
        &package,
        &test_root.join("runtimes"),
        settings.network.clone(),
        CancellationToken::new(),
        move |_| {
            events.fetch_add(1, Ordering::Relaxed);
        },
    )
    .await?;
    ensure!(
        installation.executable == reused.executable && reuse_events.load(Ordering::Relaxed) == 0,
        "Managed Java was not reused"
    );
    ensure!(
        installation.major_version == 21,
        "Managed Java has incorrect major version"
    );
    let evidence = serde_json::json!({
        "passed": true,
        "package": package,
        "installation": installation,
        "download": progress.lock().map_err(|_| anyhow::anyhow!("Progress lock failed"))?.clone(),
        "reuse_progress_events": reuse_events.load(Ordering::Relaxed),
    });
    write_json(&test_root.join("results/managed-java.json"), &evidence)?;
    println!("MANAGED JAVA: verified installation and reuse");
    Ok((installation, evidence))
}

async fn verify_case(
    test_root: &Path,
    global: &Settings,
    profile: &mut GameProfile,
    managed_java: Option<&JavaInstallation>,
    case: &mut CaseReport,
) -> Result<()> {
    let settings = profile.effective_settings(global)?;
    let service = ElementalService::new(&settings)?;
    case.initial_install = Some(prepare(&service, profile, "initial").await?);
    case.repair_install = Some(prepare(&service, profile, "reuse").await?);
    ensure!(
        case.repair_install
            .as_ref()
            .is_some_and(|progress| progress.downloaded_files == 0 && progress.failed_files == 0),
        "An intact instance downloaded files again"
    );
    let instance_root = settings
        .game_directory
        .join("versions")
        .join(&profile.instance_key);
    let required = java::required_java_major_version(&instance_root)?;
    case.required_java = Some(required);
    let runtime = if required == 21 {
        match managed_java {
            Some(installation) => installation.clone(),
            None => java::select_runtime(required, None, &test_root.join("runtimes")).await?,
        }
    } else {
        match java::select_runtime(required, None, &test_root.join("runtimes")).await {
            Ok(installation) => installation,
            Err(_) => {
                let package = java::resolve_package(required, &settings.network).await?;
                java::download_and_install(
                    &package,
                    &test_root.join("runtimes"),
                    settings.network.clone(),
                    CancellationToken::new(),
                    |_| {},
                )
                .await?
            }
        }
    };
    println!("JAVA {}: {}", required, runtime.executable.display());
    profile.overrides.java_executable = Some(runtime.executable.to_string_lossy().into_owned());
    case.runtime = Some(runtime);
    write_json(
        &test_root
            .join("results")
            .join(format!("{}.json", profile.game_version)),
        case,
    )?;
    let settings = profile.effective_settings(global)?;
    for attempt in 1..=2 {
        let launch = launch_and_observe(test_root, &settings, profile, attempt).await?;
        let passed = launch.ready && launch.exit_code == Some(0) && launch.close_mode == "natural";
        case.launches.push(launch);
        write_json(
            &test_root
                .join("results")
                .join(format!("{}.json", profile.game_version)),
            case,
        )?;
        ensure!(
            passed,
            "Launch attempt {attempt} did not complete a ready, natural shutdown"
        );
    }
    Ok(())
}

async fn prepare(
    service: &ElementalService,
    profile: &GameProfile,
    phase: &str,
) -> Result<DownloadProgress> {
    println!("INSTALL {phase}: {}", profile.game_version);
    let last = Arc::new(Mutex::new(None));
    let observed = Arc::clone(&last);
    let label = format!("{} {phase}", profile.game_version);
    let last_print = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10)));
    service
        .prepare_with_progress(profile, CancellationToken::new(), move |value| {
            if let Ok(mut previous) = last_print.lock()
                && (previous.elapsed() >= Duration::from_secs(2)
                    || value.completed_files == value.total_files)
            {
                println!(
                    "DOWNLOAD {label}: {}/{} files, {} transferred bytes, {} bytes/s",
                    value.completed_files,
                    value.total_files,
                    value.transferred_bytes,
                    value.bytes_per_second
                );
                *previous = Instant::now();
            }
            if let Ok(mut previous) = observed.lock() {
                *previous = Some(value);
            }
        })
        .await?;
    last.lock()
        .map_err(|_| anyhow::anyhow!("Progress lock failed"))?
        .clone()
        .context("Download engine emitted no progress")
}

async fn launch_and_observe(
    test_root: &Path,
    settings: &Settings,
    profile: &GameProfile,
    attempt: u32,
) -> Result<LaunchReport> {
    println!("LAUNCH {} attempt {attempt}", profile.game_version);
    let mut process = ElementalService::new(settings)?
        .launch(profile, settings)
        .await?;
    let log_path = test_root
        .join("logs")
        .join(format!("{}-{attempt}.log", profile.game_version));
    let mut log = File::create(&log_path)?;
    let started = Instant::now();
    let mut report = LaunchReport {
        pid: process.child.id(),
        log: log_path,
        ..LaunchReport::default()
    };
    write_json(
        &test_root.join("current-game.json"),
        &serde_json::json!({"version":profile.game_version,"attempt":attempt,"pid":report.pid,"ready":false}),
    )?;
    let mut textures = false;
    let mut sound = false;
    let mut lines_open = true;
    let mut close_deadline = None;
    let mut timeout_tick = tokio::time::interval(Duration::from_secs(1));
    timeout_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let status = loop {
        tokio::select! {
            exit = process.child.wait() => {
                report.close_mode = "natural".into();
                break exit?;
            }
            line = process.lines.recv(), if lines_open => {
                if let Some(line) = line {
                    writeln!(log, "{}", line.line)?;
                    log.flush()?;
                    if line.line.contains("Created:") && (line.line.contains("atlas") || line.line.contains("texture")) {
                        textures = true;
                        if report.readiness_evidence.len() < 8 { report.readiness_evidence.push(line.line.clone()); }
                    }
                    if line.line.contains("Sound engine started") || line.line.contains("OpenAL initialized") || line.line.contains("SoundSystem started") {
                        sound = true;
                        if report.readiness_evidence.len() < 8 { report.readiness_evidence.push(line.line.clone()); }
                    }
                    if textures && sound && !report.ready {
                        report.ready = true;
                        close_deadline = Some(Instant::now() + Duration::from_secs(300));
                        write_json(&test_root.join("current-game.json"), &serde_json::json!({"version":profile.game_version,"attempt":attempt,"pid":report.pid,"ready":true}))?;
                        println!("READY {} attempt {attempt}, PID {:?}: close this Minecraft window normally", profile.game_version, report.pid);
                    }
                } else { lines_open = false; }
            }
            _ = timeout_tick.tick() => {
                let timeout = close_deadline.is_some_and(|deadline| Instant::now() >= deadline) || (!report.ready && started.elapsed() > Duration::from_secs(180));
                if timeout {
                    report.close_mode = if report.ready { "forced_stop" } else { "startup_timeout" }.into();
                    process.child.kill().await.context("Could not stop test game")?;
                    break process.child.wait().await?;
                }
            }
        }
    };
    while let Ok(line) = process.lines.try_recv() {
        writeln!(log, "{}", line.line)?;
    }
    log.sync_all()?;
    report.exit_code = status.code();
    report.elapsed_seconds = started.elapsed().as_secs();
    write_json(
        &test_root.join("current-game.json"),
        &serde_json::json!({"version":profile.game_version,"attempt":attempt,"pid":report.pid,"ready":report.ready,"finished":true,"exit_code":report.exit_code,"close_mode":report.close_mode}),
    )?;
    println!(
        "EXIT {} attempt {attempt}: {status}, ready={}, mode={}",
        profile.game_version, report.ready, report.close_mode
    );
    Ok(report)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().context("Report path has no parent")?;
    fs::create_dir_all(parent)?;
    let mut staging = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut staging, value)?;
    staging.write_all(b"\n")?;
    staging.persist(path).map_err(|error| error.error)?;
    Ok(())
}
