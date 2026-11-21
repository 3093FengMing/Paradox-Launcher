//! Observe an explicitly requested cached launch and reap the owned game.
use super::model::LaunchReport;
use super::snapshots::reject_link_ancestors;
use anyhow::{Context, Result, ensure};
use paradox_core::{ElementalService, GameProfile, Settings, java};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::Duration,
};

pub(crate) async fn observe(
    root: &Path,
    log_path: &Path,
    settings: &mut Settings,
    profile: &GameProfile,
) -> Result<LaunchReport> {
    let runtimes = root.join("runtimes");
    let mut selected = None;
    for entry in fs::read_dir(&runtimes)? {
        let path = entry?.path();
        reject_link_ancestors(&path)?;
        if path.is_dir()
            && let Ok(runtime) = java::inspect(&path).await
            && runtime.major_version == 21
        {
            ensure!(
                runtime
                    .executable
                    .canonicalize()?
                    .starts_with(runtimes.canonicalize()?),
                "Java must come from the acceptance cache"
            );
            selected = Some(runtime);
            break;
        }
    }
    let runtime = selected.context("The cache contains no usable Java 21")?;
    settings.java_executable = runtime.executable.to_string_lossy().into_owned();
    let mut log = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(log_path)?;
    let mut game = ElementalService::new(settings)?
        .launch_with_runtime_directory(profile, settings, &runtimes)
        .await?;
    let deadline = tokio::time::sleep(Duration::from_secs(180));
    tokio::pin!(deadline);
    let outcome = async {
        let mut textures = false;
        let mut sound = false;
        loop {
            tokio::select! {
                status = game.child.wait() => { status?; return Ok::<_, anyhow::Error>((false, "natural")); }
                line = game.lines.recv() => {
                    let Some(line) = line else { return Ok((false, "log_stream_closed")); };
                    writeln!(log, "{}", line.line)?;
                    log.flush()?;
                    textures |= line.line.contains("Created:") && (line.line.contains("atlas") || line.line.contains("texture"));
                    sound |= line.line.contains("Sound engine started") || line.line.contains("OpenAL initialized");
                    if textures && sound { return Ok((true, "controlled_stop")); }
                }
                () = &mut deadline => return Ok((false, "startup_timeout")),
            }
        }
    }.await;
    // Run cleanup even if reading or writing game logs failed after the spawn.
    let already_exited = matches!(game.child.try_wait(), Ok(Some(_)));
    let stop = if already_exited {
        Ok(())
    } else {
        paradox_core::process::kill_process_tree(&mut game.child).await
    };
    let status = tokio::time::timeout(Duration::from_secs(15), game.child.wait())
        .await
        .context("Java process did not stop within the cleanup deadline")??;
    stop?;
    while let Ok(line) = game.lines.try_recv() {
        writeln!(log, "{}", line.line)?;
    }
    log.sync_all()?;
    let (ready, mut close_mode) = outcome?;
    if ready && already_exited {
        close_mode = "natural";
    }
    Ok(LaunchReport {
        ready,
        close_mode: close_mode.into(),
        process_reaped: true,
        exit_code: status.code(),
        java: runtime.executable,
        log: log_path.to_owned(),
    })
}
