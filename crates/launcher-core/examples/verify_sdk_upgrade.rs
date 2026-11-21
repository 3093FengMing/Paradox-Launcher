//! Checks a previously accepted loader cache without catalogs, preparation or downloads.
//! Optional NeoForge launch uses only the cache's Java 21 and an offline identity.

#[path = "verify_sdk_upgrade/mod.rs"]
mod verify_sdk_upgrade;
use anyhow::{Context, Result, ensure};
use elemental::launcher::Launcher;
use paradox_core::{ElementalService, Settings};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use verify_sdk_upgrade::model::{CachedProfile, ProfileReport, Snapshot, UpgradeReport};
use verify_sdk_upgrade::observation::observe;
use verify_sdk_upgrade::snapshots::{
    conventional_path, launch_state_changes, reject_link_ancestors, snapshot,
};

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> Result<()> {
    let mut arguments = std::env::args().skip(1);
    let input = PathBuf::from(arguments.next().context(
        "Usage: cargo run -p paradox-core --example verify_sdk_upgrade -- <absolute-.test-data-cache-root> [--launch-neoforge]",
    )?);
    let launch = match arguments.next().as_deref() {
        None => false,
        Some("--launch-neoforge") => true,
        Some(_) => anyhow::bail!("The optional argument must be --launch-neoforge"),
    };
    ensure!(arguments.next().is_none(), "Unexpected additional argument");
    ensure!(
        input.is_absolute()
            && !input
                .components()
                .any(|part| matches!(part, Component::ParentDir))
            && input
                .components()
                .any(|part| part.as_os_str() == ".test-data"),
        "Choose an absolute isolated cache within .test-data"
    );
    reject_link_ancestors(&input)?;
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let test_data = workspace.join(".test-data").canonicalize()?;
    let resolved = input.canonicalize()?;
    ensure!(
        resolved.starts_with(&test_data) && resolved != test_data,
        "The resolved cache must stay inside this workspace's .test-data"
    );
    // Native state records conventional Windows paths; retain that spelling for SDK loads.
    let root = conventional_path(&resolved);
    let source_report = root.join("report.json");
    let cached: Vec<CachedProfile> = serde_json::from_reader(File::open(&source_report)?)?;
    let loaders = cached
        .iter()
        .map(|profile| profile.loader.as_str())
        .collect::<BTreeSet<_>>();
    ensure!(
        cached.len() == 4
            && loaders == BTreeSet::from(["fabric", "quilt", "forge", "neoforge"])
            && cached
                .iter()
                .all(|profile| profile.passed && profile.installed),
        "report.json must contain four previously accepted loader profiles"
    );
    for cached_profile in &cached {
        let instance = root
            .join("minecraft/versions")
            .join(cached_profile.profile()?.instance_key);
        // Store::load can migrate old state or create a missing .elemental directory.
        // Require an existing current store before calling the SDK's load path.
        let native_state = instance.join(".elemental/natives.json");
        reject_link_ancestors(&native_state)?;
        let state: serde_json::Value = serde_json::from_reader(File::open(native_state)?)?;
        ensure!(
            state["version"] == 1,
            "Native state must already use version 1"
        );
    }
    let output = std::env::var_os("PARADOX_SDK_UPGRADE_REPORT")
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace.join(".test-data/2026-11-07-quintelement-upstream"));
    ensure!(
        output.is_absolute()
            && !output
                .components()
                .any(|part| matches!(part, Component::ParentDir))
            && output.starts_with(workspace.join(".test-data"))
            && output != root,
        "Choose an absolute task-local report directory within workspace .test-data"
    );
    reject_link_ancestors(output.parent().context("Missing report parent")?)?;
    fs::create_dir_all(&output)?;
    reject_link_ancestors(&output)?;
    let run_id = format!(
        "{}-{}",
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos(),
        std::process::id()
    );
    let report_path = output.join(format!("sdk-upgrade-{run_id}.json"));
    let mut report = UpgradeReport {
        cache_root: root.clone(),
        profiles: Vec::new(),
        state_before: snapshot(&root)?,
        state_after_load: Snapshot::new(),
        state_after_launch: None,
        load_state_unchanged: false,
        launch_state_unchanged: None,
        launch_compatible_state_unchanged: None,
        launch_state_changes: Vec::new(),
        launch: None,
        passed: false,
        error: None,
    };
    let result = async {
        let mut settings = Settings {
            game_directory: root.join("minecraft"),
            offline_username: "LoaderTest".into(),
            memory_mb: 3072,
            resolution_width: 960,
            resolution_height: 540,
            ..Settings::default()
        };
        let service = ElementalService::new(&settings)?;
        let scanned = service.inspect().await?;
        let launcher = Launcher::builder()
            .storage_root(&settings.game_directory)
            .build();
        for cached_profile in &cached {
            let profile = cached_profile.profile()?;
            let mut checked = ProfileReport {
                instance_key: profile.instance_key.clone(),
                loader: profile.loader.clone(),
                game_version: profile.game_version.clone(),
                loader_version: profile.loader_version.clone(),
                scanned: false,
                loaded: false,
                sdk_loader_version: None,
                error: None,
            };
            let check = async {
                let found = scanned
                    .iter()
                    .find(|found| found.instance_key == profile.instance_key)
                    .context("ElementalService scan did not find the cached instance")?;
                ensure!(
                    found.loader == profile.loader
                        && found.game_version.as_deref() == Some(profile.game_version.as_str())
                        && found.loader_version.as_deref() == Some(profile.loader_version.as_str()),
                    "Scanned loader/game/release differs from the accepted cache"
                );
                checked.scanned = true;
                let instance = launcher
                    .inspect_instance(profile.instance_key.clone())
                    .await?
                    .context("SDK did not find the cached instance")?;
                checked
                    .sdk_loader_version
                    .clone_from(&instance.driver.driver_version);
                let prepared = launcher.load_instance(instance).await?;
                ensure!(
                    prepared.driver().id == profile.loader
                        && prepared.instance_root().canonicalize()?
                            == settings
                                .game_directory
                                .join("versions")
                                .join(&profile.instance_key)
                                .canonicalize()?,
                    "SDK loaded an unexpected driver or instance root"
                );
                checked.loaded = true;
                Ok::<_, anyhow::Error>(())
            }
            .await;
            checked.error = check.err().map(|error| format!("{error:#}"));
            report.profiles.push(checked);
        }
        report.state_after_load = snapshot(&root)?;
        report.load_state_unchanged = report.state_before == report.state_after_load;
        ensure!(
            report.load_state_unchanged,
            "SDK scan/load changed cached JSON or native state"
        );
        ensure!(
            report.profiles.iter().all(|profile| profile.loaded),
            "A cached profile failed scan/load"
        );
        if launch {
            let profile = cached
                .iter()
                .find(|profile| profile.loader == "neoforge")
                .unwrap()
                .profile()?;
            let launch_result = observe(
                &root,
                &output.join(format!("neoforge-{run_id}.log")),
                &mut settings,
                &profile,
            )
            .await;
            let after = snapshot(&root)?;
            report.launch_state_unchanged = Some(after == report.state_after_load);
            let natives = format!("minecraft/versions/{}/natives", profile.instance_key);
            report.launch_state_changes =
                launch_state_changes(&report.state_after_load, &after, &natives);
            report.launch_compatible_state_unchanged = Some(
                report
                    .launch_state_changes
                    .iter()
                    .all(|change| change.allowed_jna_runtime_change),
            );
            report.state_after_launch = Some(after);
            report.launch = Some(launch_result?);
            ensure!(
                report.launch_compatible_state_unchanged == Some(true),
                "Launch changed cached state beyond the launched instance's JNA temporary files"
            );
            ensure!(
                report.launch.as_ref().is_some_and(|launch| launch.ready
                    && launch.process_reaped
                    && launch.close_mode == "controlled_stop"),
                "NeoForge did not reach readiness before a controlled stop"
            );
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    // Preserve an after-load snapshot even when SDK inspection/loading returns an error.
    if report.state_after_load.is_empty() {
        report.state_after_load = snapshot(&root)?;
        report.load_state_unchanged = report.state_before == report.state_after_load;
    }
    report.error = result.err().map(|error| format!("{error:#}"));
    report.passed = report.error.is_none();
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&report_path)?;
    file.write_all(&serde_json::to_vec_pretty(&report)?)?;
    file.sync_all()?;
    println!(
        "SDK upgrade: passed={}, load_state_unchanged={}, launch_state_unchanged={:?}, launch_compatible_state_unchanged={:?}, report={}",
        report.passed,
        report.load_state_unchanged,
        report.launch_state_unchanged,
        report.launch_compatible_state_unchanged,
        report_path.display()
    );
    ensure!(
        report.passed,
        "SDK upgrade acceptance failed: {}",
        report.error.as_deref().unwrap_or("unknown error")
    );
    Ok(())
}

#[cfg(test)]
use verify_sdk_upgrade::model::FileSnapshot;

#[cfg(test)]
mod tests {
    use super::*;

    const NATIVES: &str = "minecraft/versions/smoke-neoforge-1.21.1/natives";

    fn file(hash: &str) -> FileSnapshot {
        FileSnapshot {
            directory: false,
            size: 42,
            modified_unix_ns: "1".into(),
            sha256: Some(hash.into()),
        }
    }

    #[test]
    fn launch_comparison_lists_and_allows_only_jna_rotation_and_directory_mtime() {
        let directory = FileSnapshot {
            directory: true,
            size: 4096,
            modified_unix_ns: "1".into(),
            sha256: None,
        };
        let before = Snapshot::from([
            (NATIVES.into(), directory.clone()),
            (format!("{NATIVES}/jna123.dll"), file("jna")),
            (format!("{NATIVES}/jna123.dll.x"), file("empty")),
        ]);
        let mut after = Snapshot::from([
            (NATIVES.into(), directory),
            (format!("{NATIVES}/jna456.dll"), file("jna")),
            (format!("{NATIVES}/jna456.dll.x"), file("empty")),
        ]);
        after.get_mut(NATIVES).unwrap().modified_unix_ns = "2".into();
        let changes = launch_state_changes(&before, &after, NATIVES);
        assert_ne!(before, after);
        assert_eq!(changes.len(), 5);
        assert!(
            changes
                .iter()
                .all(|change| change.allowed_jna_runtime_change)
        );
        after.get_mut(NATIVES).unwrap().size += 1;
        assert!(
            launch_state_changes(&before, &after, NATIVES)
                .iter()
                .any(|change| !change.allowed_jna_runtime_change)
        );
    }

    #[test]
    fn launch_comparison_rejects_sdk_native_and_json_changes() {
        for path in [
            format!("{NATIVES}/lwjgl.dll"),
            "minecraft/versions/smoke-neoforge-1.21.1/smoke-neoforge-1.21.1.json".into(),
            "minecraft/versions/smoke-neoforge-1.21.1/.elemental/natives.json".into(),
        ] {
            let before = Snapshot::from([(path.clone(), file("before"))]);
            let after = Snapshot::from([(path, file("after"))]);
            assert!(
                launch_state_changes(&before, &after, NATIVES)
                    .iter()
                    .any(|change| !change.allowed_jna_runtime_change)
            );
        }
    }

    #[test]
    fn launch_comparison_rejects_other_instances_and_non_numeric_jna_names() {
        for path in [
            "minecraft/versions/smoke-fabric-1.20.1/natives/jna123.dll".into(),
            format!("{NATIVES}/jna.dll"),
            format!("{NATIVES}/jnaabc.dll"),
            format!("{NATIVES}/jna123.dll.json"),
            format!("{NATIVES}/nested/jna123.dll"),
        ] {
            let after = Snapshot::from([(path, file("jna"))]);
            assert!(
                launch_state_changes(&Snapshot::new(), &after, NATIVES)
                    .iter()
                    .any(|change| !change.allowed_jna_runtime_change)
            );
        }
    }
}
