//! Canonical roots, direct instance locations, and link rejection boundaries.
use crate::model::validate_instance_key;
use anyhow::{Context, Result, ensure};
use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

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

pub(super) fn canonical_game_root(directory: &Path) -> Result<PathBuf> {
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

pub(super) fn canonical_instance_root(location: &InstanceLocation) -> Result<PathBuf> {
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

pub(super) fn validate_absolute_path(path: &Path) -> Result<()> {
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

pub(super) fn reject_links_in_tree(root: &Path) -> Result<()> {
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
pub(super) fn resolve_existing_prefix(path: &Path) -> Result<PathBuf> {
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
