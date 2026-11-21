//! Capture SDK-owned state and classify allowed native runtime changes.
use super::model::{FileSnapshot, Snapshot, StateChange};
use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub(crate) fn launch_state_changes(
    before: &Snapshot,
    after: &Snapshot,
    natives: &str,
) -> Vec<StateChange> {
    before.keys().chain(after.keys()).collect::<BTreeSet<_>>()
        .into_iter().filter_map(|path| {
            let previous = before.get(path);
            let current = after.get(path);
            if previous == current { return None; }
            // JNA rotates jna<digits>.dll and its .dll.x deletion marker on startup.
            // Keep complete snapshots and list these changes; permit only this instance.
            let allowed_jna_runtime_change = if path == natives {
                matches!((previous, current), (Some(old), Some(new))
                    if old.directory && new.directory && old.size == new.size && old.sha256 == new.sha256)
            } else {
                path.strip_prefix(natives).and_then(|tail| tail.strip_prefix('/'))
                    .and_then(|name| name.strip_suffix(".dll.x").or_else(|| name.strip_suffix(".dll")))
                    .and_then(|stem| stem.strip_prefix("jna"))
                    .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
                    && previous.into_iter().chain(current).all(|state| !state.directory)
            };
            Some(StateChange { path: path.clone(), before: previous.cloned(), after: current.cloned(), allowed_jna_runtime_change })
        }).collect()
}

pub(crate) fn snapshot(root: &Path) -> Result<Snapshot> {
    let mut result = Snapshot::new();
    snapshot_path(root, &root.join("report.json"), false, &mut result)?;
    reject_link_ancestors(&root.join("minecraft/assets/indexes"))?;
    snapshot_path(
        root,
        &root.join("minecraft/assets/indexes"),
        false,
        &mut result,
    )?;
    for entry in fs::read_dir(root.join("minecraft/versions"))? {
        let path = entry?.path();
        reject_link_ancestors(&path)?;
        if !path.is_dir() {
            continue;
        }
        for file in fs::read_dir(&path)? {
            let file = file?.path();
            if file
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                snapshot_path(root, &file, false, &mut result)?;
            }
        }
        for (directory, all_files) in [(".elemental", false), ("natives", true)] {
            let directory = path.join(directory);
            if directory.exists() {
                snapshot_path(root, &directory, all_files, &mut result)?;
            }
        }
    }
    Ok(result)
}

fn snapshot_path(root: &Path, path: &Path, all_files: bool, result: &mut Snapshot) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    reject_link(&metadata, path)?;
    if !metadata.is_dir()
        && !all_files
        && path.extension().is_none_or(|extension| extension != "json")
    {
        return Ok(());
    }
    let digest = if metadata.is_file() {
        let mut hash = Sha256::new();
        let mut file = File::open(path)?;
        let mut bytes = [0; 64 * 1024];
        loop {
            let count = file.read(&mut bytes)?;
            if count == 0 {
                break;
            }
            hash.update(&bytes[..count]);
        }
        Some(hex::encode(hash.finalize()))
    } else {
        None
    };
    result.insert(
        path.strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/"),
        FileSnapshot {
            directory: metadata.is_dir(),
            size: metadata.len(),
            modified_unix_ns: metadata
                .modified()?
                .duration_since(UNIX_EPOCH)?
                .as_nanos()
                .to_string(),
            sha256: digest,
        },
    );
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            snapshot_path(root, &entry?.path(), all_files, result)?;
        }
    }
    Ok(())
}

pub(crate) fn reject_link_ancestors(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        reject_link(&fs::symlink_metadata(ancestor)?, ancestor)?;
    }
    Ok(())
}

fn reject_link(metadata: &Metadata, path: &Path) -> Result<()> {
    let linked = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        linked || metadata.file_attributes() & 0x400 != 0
    };
    ensure!(
        !linked,
        "Cache/report path must not use links: {}",
        path.display()
    );
    Ok(())
}

pub(crate) fn conventional_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(drive) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(drive);
        }
    }
    path.to_owned()
}
