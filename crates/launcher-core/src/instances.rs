//! Instance settings and filesystem operations, independent of desktop commands.

use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

use crate::model::validate_instance_key;
use crate::{AppConfig, ElementalService, GameProfile, InstalledInstance, Settings};

/// `None` inherits the global value. An explicit empty string clears Java or
/// argument overrides, rather than falling back to the global string.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
pub struct ProfileOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_jvm_arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_game_arguments: Option<String>,
}

impl ProfileOverrides {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    pub fn validate(&self) -> Result<()> {
        if let Some(memory) = self.memory_mb {
            ensure!(
                (512..=32768).contains(&memory),
                "实例内存应在 512–32768 MB 之间"
            );
        }
        if let Some(memory) = self.minimum_memory_mb {
            ensure!(
                (256..=32768).contains(&memory),
                "实例最小内存应在 256–32768 MB 之间"
            );
        }
        if let (Some(minimum), Some(maximum)) = (self.minimum_memory_mb, self.memory_mb) {
            ensure!(minimum <= maximum, "实例最小内存不能大于最大内存");
        }
        if let Some(java) = &self.java_executable {
            ensure!(!java.contains('\0'), "Java 路径不能包含空字符");
            ensure!(
                java.trim().is_empty() || Path::new(java.trim()).is_absolute(),
                "实例 Java 路径必须是绝对路径"
            );
        }
        if let Some(width) = self.resolution_width {
            ensure!(
                (640..=7680).contains(&width),
                "实例游戏窗口宽度超出支持范围"
            );
        }
        if let Some(height) = self.resolution_height {
            ensure!(
                (480..=4320).contains(&height),
                "实例游戏窗口高度超出支持范围"
            );
        }
        for arguments in [&self.extra_jvm_arguments, &self.extra_game_arguments]
            .into_iter()
            .flatten()
        {
            ensure!(!arguments.contains('\0'), "实例启动参数不能包含空字符");
        }
        Ok(())
    }
}

/// `game_directory` is a complete game root containing `versions`, `assets`
/// and `libraries`; it is never the selected version directory itself.
pub fn effective_settings(
    global: &Settings,
    game_directory: Option<&Path>,
    overrides: &ProfileOverrides,
) -> Result<Settings> {
    global.validate()?;
    overrides.validate()?;
    let mut effective = global.clone();
    if let Some(directory) = game_directory {
        effective.game_directory = directory.to_owned();
    }
    if let Some(value) = &overrides.java_executable {
        effective.java_executable = value.clone();
    }
    if let Some(value) = overrides.memory_mb {
        effective.memory_mb = value;
    }
    if let Some(value) = overrides.minimum_memory_mb {
        effective.minimum_memory_mb = value;
    }
    if let Some(value) = overrides.resolution_width {
        effective.resolution_width = value;
    }
    if let Some(value) = overrides.resolution_height {
        effective.resolution_height = value;
    }
    if let Some(value) = &overrides.extra_jvm_arguments {
        effective.extra_jvm_arguments = value.clone();
    }
    if let Some(value) = &overrides.extra_game_arguments {
        effective.extra_game_arguments = value.clone();
    }
    effective.validate().context("实例启动设置无效")?;
    Ok(effective)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstanceLocation {
    pub game_directory: PathBuf,
    pub instance_key: String,
}

impl InstanceLocation {
    pub fn new(game_directory: &Path, instance_key: &str) -> Result<Self> {
        validate_absolute_path(game_directory)?;
        validate_instance_key(instance_key)?;
        Ok(Self {
            game_directory: game_directory.to_owned(),
            instance_key: instance_key.to_owned(),
        })
    }

    pub fn instance_root(&self) -> PathBuf {
        self.game_directory
            .join("versions")
            .join(&self.instance_key)
    }
}

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

#[derive(Clone, Debug, Serialize)]
pub struct FileRemoval {
    pub instance_root: PathBuf,
    pub removed: bool,
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
/// supplies every *other* registered location, claims the task guard, and keeps
/// the target configuration record intact until deletion completes.
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
    validate_instance_key(&location.instance_key)?;
    let directory = canonical_game_root(&location.game_directory)?;
    let location = InstanceLocation::new(&directory, &location.instance_key)?;
    let lexical_target = location.instance_root();
    match fs::symlink_metadata(&lexical_target) {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(FileRemoval {
                instance_root: lexical_target,
                removed: false,
            });
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
    // Recheck the boundary immediately before removing files. std's recursive
    // removal does not follow symbolic links; Windows reparse points are also
    // rejected in the explicit subtree check above.
    ensure!(
        canonical_instance_root(&location)? == target,
        "实例目录在操作期间发生变化"
    );
    fs::remove_dir_all(&target).context("无法移除实例文件")?;
    Ok(FileRemoval {
        instance_root: target,
        removed: true,
    })
}

fn canonical_game_root(directory: &Path) -> Result<PathBuf> {
    validate_absolute_path(directory)?;
    reject_links_in_path(directory)?;
    let directory = fs::canonicalize(directory).context("游戏根目录不存在或无法访问")?;
    ensure!(directory.is_dir(), "游戏根路径必须是文件夹");
    let versions = directory.join("versions");
    reject_links_in_path(&versions)?;
    let versions = fs::canonicalize(versions).context("所选目录缺少 versions 文件夹")?;
    ensure!(
        versions.is_dir() && versions.parent() == Some(directory.as_path()),
        "versions 必须是游戏根目录内的直接子文件夹"
    );
    Ok(directory)
}

fn canonical_instance_root(location: &InstanceLocation) -> Result<PathBuf> {
    validate_instance_key(&location.instance_key)?;
    let directory = canonical_game_root(&location.game_directory)?;
    let target = directory.join("versions").join(&location.instance_key);
    reject_links_in_path(&target)?;
    let target = fs::canonicalize(target).context("实例目录不存在或无法访问")?;
    ensure!(
        target.is_dir() && target.parent() == Some(directory.join("versions").as_path()),
        "实例目录必须是 versions 内的直接子文件夹"
    );
    Ok(target)
}

fn validate_absolute_path(path: &Path) -> Result<()> {
    ensure!(path.is_absolute(), "游戏根目录必须是绝对路径");
    ensure!(
        !path
            .components()
            .any(|component| matches!(component, Component::ParentDir)),
        "游戏根路径不能包含上级目录跳转"
    );
    Ok(())
}

fn reject_links_in_path(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        let metadata = fs::symlink_metadata(ancestor)
            .with_context(|| format!("无法验证目录路径：{}", ancestor.display()))?;
        reject_link_metadata(ancestor, &metadata)?;
    }
    Ok(())
}

fn reject_link_metadata(path: &Path, metadata: &fs::Metadata) -> Result<()> {
    ensure!(
        !metadata.file_type().is_symlink(),
        "实例路径包含符号链接：{}",
        path.display()
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        ensure!(
            metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0,
            "实例路径包含重解析点：{}",
            path.display()
        );
    }
    Ok(())
}

fn reject_links_in_tree(root: &Path) -> Result<()> {
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).context("无法检查实例文件")? {
            let entry = entry?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            reject_link_metadata(&path, &metadata)?;
            ensure!(
                metadata.is_dir() || metadata.is_file(),
                "实例目录包含特殊文件"
            );
            if metadata.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(())
}

/// Resolve existing ancestors even when another profile has not been installed
/// yet. Inaccessible paths fail closed rather than skipping overlap checks.
fn resolve_existing_prefix(path: &Path) -> Result<PathBuf> {
    validate_absolute_path(path)?;
    let mut current = path;
    let mut missing = Vec::new();
    loop {
        match fs::canonicalize(current) {
            Ok(mut resolved) => {
                for component in missing.into_iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                missing.push(
                    current
                        .file_name()
                        .context("无法解析游戏根目录")?
                        .to_owned(),
                );
                current = current.parent().context("无法解析游戏根目录")?;
            }
            Err(error) => return Err(error).context("无法验证已注册实例路径"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game_root() -> (tempfile::TempDir, PathBuf) {
        let temporary = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap().join("游戏 根");
        fs::create_dir_all(root.join("versions")).unwrap();
        (temporary, root)
    }

    fn installed(root: &Path, key: &str) -> InstalledInstance {
        let instance_root = root.join("versions").join(key);
        fs::create_dir_all(&instance_root).unwrap();
        fs::write(instance_root.join(format!("{key}.json")), b"{}").unwrap();
        fs::write(instance_root.join(format!("{key}.jar")), b"test fixture").unwrap();
        InstalledInstance {
            instance_key: key.to_owned(),
            game_version: Some("1.21.1".into()),
            loader: "vanilla".into(),
            root: instance_root,
        }
    }

    #[test]
    fn empty_overrides_inherit_all_global_settings() {
        let global = Settings::default();
        let overrides: ProfileOverrides = serde_json::from_str("{}").unwrap();
        assert!(overrides.is_empty());
        let effective = effective_settings(&global, None, &overrides).unwrap();
        assert_eq!(
            serde_json::to_value(global).unwrap(),
            serde_json::to_value(effective).unwrap()
        );
    }

    #[test]
    fn overrides_replace_values_and_can_clear_global_strings() {
        let global = Settings {
            java_executable: std::env::current_exe().unwrap().display().to_string(),
            extra_jvm_arguments: "-Dexample=global".into(),
            extra_game_arguments: "--fullscreen".into(),
            ..Settings::default()
        };
        let overrides = ProfileOverrides {
            java_executable: Some(String::new()),
            memory_mb: Some(8192),
            extra_jvm_arguments: Some(String::new()),
            extra_game_arguments: Some("--demo".into()),
            ..ProfileOverrides::default()
        };
        let effective = effective_settings(&global, None, &overrides).unwrap();
        assert!(effective.java_executable.is_empty());
        assert!(effective.extra_jvm_arguments.is_empty());
        assert_eq!(effective.memory_mb, 8192);
        assert_eq!(effective.extra_game_arguments, "--demo");
        assert_eq!(global.memory_mb, 4096);
        assert_eq!(global.extra_game_arguments, "--fullscreen");
    }

    #[test]
    fn effective_settings_validate_the_combined_memory_and_paths() {
        let global = Settings::default();
        for overrides in [
            ProfileOverrides {
                memory_mb: Some(64),
                ..ProfileOverrides::default()
            },
            ProfileOverrides {
                minimum_memory_mb: Some(8192),
                ..ProfileOverrides::default()
            },
            ProfileOverrides {
                java_executable: Some("java.exe".into()),
                ..ProfileOverrides::default()
            },
            ProfileOverrides {
                resolution_width: Some(100),
                ..ProfileOverrides::default()
            },
        ] {
            assert!(effective_settings(&global, None, &overrides).is_err());
        }
        assert!(
            effective_settings(
                &global,
                Some(Path::new("relative")),
                &ProfileOverrides::default()
            )
            .is_err()
        );
    }

    #[test]
    fn imported_game_roots_are_referenced_without_copying() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let registration =
            registration_from_scan(&Settings::default(), &root, &instance, Some("外部世界"))
                .unwrap();
        assert_eq!(registration.game_directory, Some(root.clone()));
        assert_eq!(registration.instance_key, "1.21.1");
        assert_eq!(registration.name, "外部世界");
        assert_eq!(fs::read_dir(root.join("versions")).unwrap().count(), 1);
    }

    #[test]
    fn registration_rejects_other_roots_loaders_and_incomplete_files() {
        let (_temporary, root) = game_root();
        let (_other_temporary, other_root) = game_root();
        let mut instance = installed(&root, "1.21.1");
        let global = Settings::default();
        assert!(registration_from_scan(&global, &other_root, &instance, None).is_err());
        instance.loader = "fabric".into();
        assert!(registration_from_scan(&global, &root, &instance, None).is_err());
        instance.loader = "vanilla".into();
        fs::remove_file(instance.root.join("1.21.1.jar")).unwrap();
        assert!(registration_from_scan(&global, &root, &instance, None).is_err());
    }

    #[test]
    fn removing_a_record_preserves_files_and_updates_the_active_profile() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let profile = registration_from_scan(&Settings::default(), &root, &instance, None).unwrap();
        let next = GameProfile::new("保留的世界", "1.20.1").unwrap();
        let mut config = AppConfig {
            profiles: vec![profile.clone(), next.clone()],
            active_profile: Some(profile.instance_key.clone()),
            ..AppConfig::default()
        };
        remove_profile_record(&mut config, &profile.instance_key).unwrap();
        assert!(instance.root.join("1.21.1.jar").is_file());
        assert_eq!(
            config.active_profile.as_deref(),
            Some(next.instance_key.as_str())
        );
        config.validate().unwrap();
    }

    #[test]
    fn removing_files_preserves_shared_assets_and_other_instances() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let other = installed(&root, "1.20.1");
        for shared in ["assets", "libraries"] {
            fs::create_dir_all(root.join(shared)).unwrap();
            fs::write(root.join(shared).join("keep.txt"), b"keep").unwrap();
        }
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        let others = [InstanceLocation::new(&root, &other.instance_key).unwrap()];
        let removal = remove_instance_files(&location, &others).unwrap();
        assert!(removal.removed);
        assert!(!instance.root.exists());
        assert!(other.root.exists());
        for shared in ["assets", "libraries"] {
            assert_eq!(
                fs::read(root.join(shared).join("keep.txt")).unwrap(),
                b"keep"
            );
        }
    }

    #[test]
    fn shared_instance_paths_cannot_be_deleted() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        assert!(remove_instance_files(&location, std::slice::from_ref(&location)).is_err());
        assert!(instance.root.exists());
        let nested_root = instance.root.join("another-game");
        let nested = InstanceLocation::new(&nested_root, "uninstalled").unwrap();
        assert!(remove_instance_files(&location, &[nested]).is_err());
        assert!(instance.root.exists());
    }

    #[test]
    fn path_traversal_and_reserved_instance_keys_are_rejected() {
        let (_temporary, root) = game_root();
        for key in ["..", "../assets", "x/y", "C:\\outside", "CON"] {
            assert!(InstanceLocation::new(&root, key).is_err());
        }
        let escaped_root = PathBuf::from(format!(
            "{}{}versions{}..",
            root.display(),
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        ));
        assert!(InstanceLocation::new(&escaped_root, "1.21.1").is_err());
    }

    #[test]
    fn legacy_profiles_deserialize_with_inherited_settings() {
        let profile: GameProfile = serde_json::from_str(
            r#"{"instance_key":"old-world","name":"旧实例","game_version":"1.21.1"}"#,
        )
        .unwrap();
        assert!(profile.game_directory.is_none());
        assert!(profile.overrides.is_empty());
        profile.validate().unwrap();
        let global = Settings::default();
        assert_eq!(
            serde_json::to_value(profile.effective_settings(&global).unwrap()).unwrap(),
            serde_json::to_value(global).unwrap()
        );
    }

    #[test]
    fn profile_overrides_round_trip_and_validate_without_global_mutation() {
        let mut profile = GameProfile::new("覆盖设置", "1.21.1").unwrap();
        profile.overrides.memory_mb = Some(8192);
        let serialized = serde_json::to_vec(&profile).unwrap();
        let loaded: GameProfile = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(loaded.overrides.memory_mb, Some(8192));
        let global = Settings::default();
        assert_eq!(loaded.effective_settings(&global).unwrap().memory_mb, 8192);
        assert_eq!(global.memory_mb, 4096);
        profile.game_directory = Some(PathBuf::from("relative"));
        assert!(profile.validate().is_err());
    }

    #[test]
    fn repeated_scans_register_only_new_vanilla_instances() {
        let (_temporary, root) = game_root();
        let first = installed(&root, "1.21.1");
        let mut unsupported = installed(&root, "fabric-world");
        unsupported.loader = "fabric".into();
        let mut config = AppConfig {
            settings: Settings {
                game_directory: root.clone(),
                ..Settings::default()
            },
            ..AppConfig::default()
        };
        let summary =
            register_instances_from_scan(&mut config, &root, &[first.clone(), unsupported])
                .unwrap();
        assert_eq!(summary.added, ["1.21.1"]);
        assert_eq!(summary.unsupported, 1);
        assert!(config.profiles[0].game_directory.is_none());
        config.profiles[0].name = "保留用户名称".into();
        config.profiles[0].overrides.memory_mb = Some(8192);
        let repeated = register_instances_from_scan(&mut config, &root, &[first]).unwrap();
        assert!(repeated.added.is_empty());
        assert_eq!(repeated.existing, 1);
        assert_eq!(config.profiles[0].name, "保留用户名称");
        assert_eq!(config.profiles[0].overrides.memory_mb, Some(8192));
    }

    #[test]
    fn scanning_an_uncreated_empty_global_root_does_not_create_files() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = fs::canonicalize(temporary.path())
            .unwrap()
            .join("uncreated-game");
        let mut config = AppConfig {
            settings: Settings {
                game_directory: directory.clone(),
                ..Settings::default()
            },
            ..AppConfig::default()
        };
        let summary = register_instances_from_scan(&mut config, &directory, &[]).unwrap();
        assert!(summary.added.is_empty());
        assert!(!directory.exists());
    }

    #[test]
    fn failed_registration_keeps_the_entire_configuration_unchanged() {
        let (_temporary, root) = game_root();
        let (_other_temporary, other_root) = game_root();
        let first = installed(&root, "1.21.1");
        let conflicting = installed(&other_root, "1.21.1");
        let next = installed(&other_root, "1.20.1");
        let mut config = AppConfig::default();
        register_instances_from_scan(&mut config, &root, &[first]).unwrap();
        let before = serde_json::to_value(&config).unwrap();
        assert!(
            register_instances_from_scan(&mut config, &other_root, &[next, conflicting]).is_err()
        );
        assert_eq!(serde_json::to_value(config).unwrap(), before);
    }

    #[cfg(any(unix, windows))]
    fn directory_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let powershell = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
            let output = std::process::Command::new(powershell)
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                    "New-Item -ItemType Junction -Path $env:PARADOX_TEST_LINK -Target $env:PARADOX_TEST_TARGET -ErrorAction Stop | Out-Null"])
                .env("PARADOX_TEST_LINK", link)
                .env("PARADOX_TEST_TARGET", target)
                .creation_flags(0x08000000)
                .output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn linked_roots_and_nested_links_are_rejected_before_deletion() {
        let (temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let alias = temporary.path().join("linked-game");
        directory_link(&root, &alias);
        assert!(canonical_game_root(&alias).is_err());
        let protected = temporary.path().join("protected");
        fs::create_dir_all(&protected).unwrap();
        fs::write(protected.join("keep.txt"), b"keep").unwrap();
        directory_link(&protected, &instance.root.join("outside"));
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        assert!(remove_instance_files(&location, &[]).is_err());
        assert!(instance.root.exists());
        assert_eq!(fs::read(protected.join("keep.txt")).unwrap(), b"keep");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn shared_resource_links_into_an_instance_block_file_removal() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        directory_link(&instance.root, &root.join("assets"));
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        assert!(remove_instance_files(&location, &[]).is_err());
        assert!(instance.root.join("1.21.1.jar").is_file());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn imported_instances_protect_resources_referenced_by_the_global_root() {
        let (_temporary, root) = game_root();
        let (_external_temporary, external_root) = game_root();
        let instance = installed(&external_root, "1.21.1");
        directory_link(&instance.root, &root.join("libraries"));
        let mut config = AppConfig {
            settings: Settings {
                game_directory: root,
                ..Settings::default()
            },
            ..AppConfig::default()
        };
        register_instances_from_scan(&mut config, &external_root, std::slice::from_ref(&instance))
            .unwrap();
        assert!(remove_profile_files(&config, &instance.instance_key).is_err());
        assert!(instance.root.join("1.21.1.jar").is_file());
    }

    #[tokio::test]
    async fn uninstalled_known_roots_are_empty_without_creating_files() {
        let temporary = tempfile::tempdir().unwrap();
        let missing = temporary.path().join("尚未安装");
        let settings = Settings {
            game_directory: missing.clone(),
            ..Settings::default()
        };
        assert!(
            scan_known_game_root(&settings, &missing)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(!missing.exists());
        fs::create_dir(&missing).unwrap();
        assert!(
            scan_known_game_root(&settings, &missing)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(fs::read_dir(&missing).unwrap().count(), 0);
        assert!(scan_game_root(&settings, &missing).await.is_err());
    }

    #[tokio::test]
    async fn known_root_scanning_does_not_hide_invalid_directory_shapes() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("not-a-folder");
        let settings = Settings {
            game_directory: root.clone(),
            ..Settings::default()
        };
        fs::write(&root, b"file").unwrap();
        assert!(scan_known_game_root(&settings, &root).await.is_err());
        let directory = temporary.path().join("minecraft");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("versions"), b"file").unwrap();
        assert!(scan_known_game_root(&settings, &directory).await.is_err());
    }
}
