//! Read and validate a bounded portable-pack archive index.
use super::index::validate_index;
use super::{MAX_ARCHIVE_SIZE, PackIndex};
use anyhow::{Result, ensure};
use std::{fs, io::Read, path::Path};

pub fn inspect(archive: &Path) -> Result<PackIndex> {
    ensure!(
        archive.is_absolute() && archive.metadata()?.len() <= MAX_ARCHIVE_SIZE,
        "content.errors.size"
    );
    let mut zip = zip::ZipArchive::new(fs::File::open(archive)?)?;
    let entry = if zip
        .file_names()
        .any(|n| n.is_ok_and(|n| n == "modrinth.index.json"))
    {
        "modrinth.index.json"
    } else {
        "paradox-instance.json"
    };
    let mut file = zip.by_name(entry)?;
    ensure!(file.size() <= 4 * 1024 * 1024, "content.errors.size");
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let index: PackIndex =
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("content.errors.pack"))?;
    validate_index(&index)?;
    Ok(index)
}
