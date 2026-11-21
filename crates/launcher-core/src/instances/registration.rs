//! Scan-backed registration and configuration record changes.
use super::paths::{
    canonical_game_root, canonical_instance_root, resolve_existing_prefix, validate_absolute_path,
};
use super::{InstanceLocation, ProfileOverrides, effective_settings};
use crate::{AppConfig, ElementalService, GameProfile, InstalledInstance, Settings};
use anyhow::{Context, Result, ensure};
use serde::Serialize;
use std::{fs, io::ErrorKind, path::Path};

pub async fn scan_game_root(global: &Settings, directory: &Path) -> Result<Vec<InstalledInstance>> {
    let directory = canonical_game_root(directory)?;
    let settings = effective_settings(global, Some(&directory), &ProfileOverrides::default())?;
    ElementalService::new(&settings)?.inspect().await
}

/// A configured install root can be empty before its first installation.
/// Missing roots and version directories are empty libraries; inaccessible or
/// malformed paths remain errors. Import scanning keeps its stricter contract.
pub async fn scan_known_game_root(
    global: &Settings,
    directory: &Path,
) -> Result<Vec<InstalledInstance>> {
    global.validate()?;
    validate_absolute_path(directory)?;
    if !directory_exists(directory)? || !directory_exists(&directory.join("versions"))? {
        return Ok(Vec::new());
    }
    scan_game_root(global, directory).await
}

fn directory_exists(path: &Path) -> Result<bool> {
    match fs::metadata(path) {
        Ok(metadata) => {
            ensure!(
                metadata.is_dir(),
                "游戏目录路径必须是文件夹：{}",
                path.display()
            );
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("无法读取游戏目录：{}", path.display())),
    }
}

/// Accept only the version directory identified by a fresh Elemental scan.
/// Callers must not accept a frontend-supplied loader/version as scan evidence.
pub fn registration_from_scan(
    global: &Settings,
    directory: &Path,
    instance: &InstalledInstance,
    name: Option<&str>,
) -> Result<GameProfile> {
    global.validate()?;
    ensure!(instance.loader == "vanilla", "当前只支持导入原版实例");
    let version = instance
        .game_version
        .as_deref()
        .context("无法识别实例游戏版本")?;
    // Keep the caller's absolute path for SDK/Java arguments. On Windows,
    // canonical paths have a verbatim prefix intended for filesystem checks.
    let referenced_directory = directory.to_owned();
    let directory = canonical_game_root(directory)?;
    let location = InstanceLocation::new(&directory, &instance.instance_key)?;
    let expected = canonical_instance_root(&location)?;
    ensure!(
        expected == fs::canonicalize(&instance.root).context("无法读取扫描实例路径")?,
        "扫描实例不属于所选游戏根目录"
    );
    ensure!(
        expected
            .join(format!("{}.json", instance.instance_key))
            .is_file()
            && expected
                .join(format!("{}.jar", instance.instance_key))
                .is_file(),
        "实例缺少版本 JSON 或游戏 JAR"
    );
    let default_name: String = instance.instance_key.chars().take(64).collect();
    let global_directory = resolve_existing_prefix(&global.game_directory)?;
    let profile = GameProfile {
        instance_key: instance.instance_key.clone(),
        name: name.unwrap_or(&default_name).trim().to_owned(),
        game_version: version.to_owned(),
        loader: "vanilla".into(),
        loader_version: String::new(),
        game_directory: (directory != global_directory).then_some(referenced_directory),
        overrides: ProfileOverrides::default(),
    };
    profile.effective_settings(global)?;
    Ok(profile)
}

#[derive(Clone, Debug, Serialize)]
pub struct RegistrationSummary {
    pub added: Vec<String>,
    pub existing: usize,
    pub unsupported: usize,
}

/// Register unrecorded Vanilla versions transactionally. Existing records keep
/// their names and overrides. A conflicting key in another game root rejects
/// the entire operation rather than creating an ambiguous SDK storage key.
pub fn register_instances_from_scan(
    config: &mut AppConfig,
    directory: &Path,
    instances: &[InstalledInstance],
) -> Result<RegistrationSummary> {
    config.validate()?;
    validate_absolute_path(directory)?;
    if instances.is_empty() {
        return Ok(RegistrationSummary {
            added: Vec::new(),
            existing: 0,
            unsupported: 0,
        });
    }
    let referenced_directory = directory;
    let directory = canonical_game_root(directory)?;
    let mut updated = config.clone();
    let mut summary = RegistrationSummary {
        added: Vec::new(),
        existing: 0,
        unsupported: 0,
    };
    for instance in instances {
        if instance.loader != "vanilla" {
            summary.unsupported += 1;
            continue;
        }
        let profile =
            registration_from_scan(&updated.settings, referenced_directory, instance, None)?;
        if let Some(existing) = updated
            .profiles
            .iter()
            .find(|existing| existing.instance_key == profile.instance_key)
        {
            let existing_directory = existing
                .effective_settings(&updated.settings)?
                .game_directory;
            ensure!(
                resolve_existing_prefix(&existing_directory)? == directory,
                "另一个游戏根目录已注册相同实例 ID：{}",
                profile.instance_key
            );
            summary.existing += 1;
            continue;
        }
        summary.added.push(profile.instance_key.clone());
        updated.profiles.push(profile);
    }
    if updated.active_profile.is_none() && !summary.added.is_empty() {
        updated.active_profile = summary.added.first().cloned();
    }
    updated.validate()?;
    *config = updated;
    Ok(summary)
}

/// Remove a configuration record only. Saving the returned configuration is
/// the caller's responsibility; this function never touches game files.
pub fn remove_profile_record(config: &mut AppConfig, key: &str) -> Result<GameProfile> {
    config.validate()?;
    let index = config
        .profiles
        .iter()
        .position(|profile| profile.instance_key == key)
        .context("实例不存在")?;
    let removed = config.profiles.remove(index);
    if config.active_profile.as_deref() == Some(key) {
        config.active_profile = config
            .profiles
            .first()
            .map(|profile| profile.instance_key.clone());
    }
    Ok(removed)
}
