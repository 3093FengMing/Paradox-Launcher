//! Prepared file-removal transactions and shared-resource protection.
use super::InstanceLocation;
use super::paths::{
    canonical_game_root, canonical_instance_root, reject_links_in_tree, resolve_existing_prefix,
};
use crate::AppConfig;
use crate::model::validate_instance_key;
use anyhow::{Context, Result, ensure};
use serde::Serialize;
use std::{fs, io::ErrorKind, path::PathBuf};

#[derive(Clone, Debug, Serialize)]
pub struct FileRemoval {
    pub instance_root: PathBuf,
    pub removed: bool,
}

/// A backend-owned deletion target. The path is fixed before removing its
/// record; retrying still checks every current registration and shared root.
#[derive(Clone, Debug)]
pub struct PreparedProfileRemoval {
    location: InstanceLocation,
    pub instance_root: PathBuf,
}

pub fn prepare_profile_file_removal(
    config: &AppConfig,
    key: &str,
) -> Result<PreparedProfileRemoval> {
    config.validate()?;
    let profile = config
        .profiles
        .iter()
        .find(|profile| profile.instance_key == key)
        .context("实例不存在")?;
    let settings = profile.effective_settings(&config.settings)?;
    let location = InstanceLocation::new(&canonical_game_root(&settings.game_directory)?, key)?;
    let (others, roots) = removal_boundaries(config, Some(key))?;
    let (instance_root, _) = validate_instance_file_removal(&location, &others, &roots)?;
    Ok(PreparedProfileRemoval {
        location,
        instance_root,
    })
}

impl PreparedProfileRemoval {
    pub fn remove(&self, current: &AppConfig) -> Result<FileRemoval> {
        current.validate()?;
        ensure!(
            !current
                .profiles
                .iter()
                .any(|profile| profile.instance_key == self.location.instance_key),
            "实例 ID 已重新注册，不能移除残留文件"
        );
        let (others, mut roots) = removal_boundaries(current, None)?;
        roots.push(self.location.game_directory.clone());
        let (target, exists) = validate_instance_file_removal(&self.location, &others, &roots)?;
        ensure!(target == self.instance_root, "实例目录在操作期间发生变化");
        remove_validated_instance_files(&self.location, target, exists)
    }
}

fn removal_boundaries(
    config: &AppConfig,
    exclude: Option<&str>,
) -> Result<(Vec<InstanceLocation>, Vec<PathBuf>)> {
    let mut others = Vec::new();
    let mut roots = vec![config.settings.game_directory.clone()];
    for profile in &config.profiles {
        let directory = profile.effective_settings(&config.settings)?.game_directory;
        roots.push(directory.clone());
        if exclude != Some(profile.instance_key.as_str()) {
            others.push(InstanceLocation::new(&directory, &profile.instance_key)?);
        }
    }
    Ok((others, roots))
}

/// Resolve every registered profile before deleting files, including shared
/// resources in the global game root when the target is an external import.
pub fn remove_profile_files(config: &AppConfig, key: &str) -> Result<FileRemoval> {
    config.validate()?;
    let profile = config
        .profiles
        .iter()
        .find(|profile| profile.instance_key == key)
        .context("实例不存在")?;
    let settings = profile.effective_settings(&config.settings)?;
    let location = InstanceLocation::new(&settings.game_directory, key)?;
    let mut others = Vec::new();
    let mut game_roots = vec![
        config.settings.game_directory.clone(),
        settings.game_directory,
    ];
    for other in &config.profiles {
        if other.instance_key != key {
            let directory = other.effective_settings(&config.settings)?.game_directory;
            others.push(InstanceLocation::new(&directory, &other.instance_key)?);
            game_roots.push(directory);
        }
    }
    remove_instance_files_with_shared_roots(&location, &others, &game_roots)
}

/// Delete only one direct child of a verified `versions` directory. The caller
/// supplies every *other* registered location and claims the task guard.
pub fn remove_instance_files(
    location: &InstanceLocation,
    other_locations: &[InstanceLocation],
) -> Result<FileRemoval> {
    let mut game_roots = vec![location.game_directory.clone()];
    game_roots.extend(
        other_locations
            .iter()
            .map(|location| location.game_directory.clone()),
    );
    remove_instance_files_with_shared_roots(location, other_locations, &game_roots)
}

fn remove_instance_files_with_shared_roots(
    location: &InstanceLocation,
    other_locations: &[InstanceLocation],
    game_roots: &[PathBuf],
) -> Result<FileRemoval> {
    let (target, exists) = validate_instance_file_removal(location, other_locations, game_roots)?;
    remove_validated_instance_files(location, target, exists)
}

fn validate_instance_file_removal(
    location: &InstanceLocation,
    other_locations: &[InstanceLocation],
    game_roots: &[PathBuf],
) -> Result<(PathBuf, bool)> {
    validate_instance_key(&location.instance_key)?;
    let directory = canonical_game_root(&location.game_directory)?;
    let location = InstanceLocation::new(&directory, &location.instance_key)?;
    let lexical_target = location.instance_root();
    match fs::symlink_metadata(&lexical_target) {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok((lexical_target, false));
        }
        Err(error) => return Err(error).context("无法读取实例目录"),
        Ok(_) => {}
    }
    let target = canonical_instance_root(&location)?;
    for other in other_locations {
        validate_instance_key(&other.instance_key)?;
        let other_directory = resolve_existing_prefix(&other.game_directory)?;
        let other_target = resolve_existing_prefix(&other.instance_root())?;
        ensure!(
            !target.starts_with(&other_target)
                && !other_target.starts_with(&target)
                && !other_directory.starts_with(&target),
            "实例目录与其他已注册实例共享，不能移除文件"
        );
    }
    for game_root in game_roots {
        for resource in ["assets", "libraries"] {
            let shared = resolve_existing_prefix(&game_root.join(resource))?;
            ensure!(
                !target.starts_with(&shared) && !shared.starts_with(&target),
                "实例目录包含共享游戏资源，不能移除文件"
            );
        }
    }
    reject_links_in_tree(&target)?;
    Ok((target, true))
}

fn remove_validated_instance_files(
    location: &InstanceLocation,
    target: PathBuf,
    exists: bool,
) -> Result<FileRemoval> {
    if !exists {
        return Ok(FileRemoval {
            instance_root: target,
            removed: false,
        });
    }
    // Recheck the boundary immediately before removing files. std's recursive
    // removal does not follow symbolic links; Windows reparse points are also
    // rejected in the explicit subtree check above.
    ensure!(
        canonical_instance_root(location)? == target,
        "实例目录在操作期间发生变化"
    );
    fs::remove_dir_all(&target).context("无法移除实例文件")?;
    Ok(FileRemoval {
        instance_root: target,
        removed: true,
    })
}
