//! Install remote pack entries and ordered overrides in one staged transaction.
use super::{
    MAX_ARCHIVE_ENTRIES, MAX_OVERRIDE_SIZE, MAX_OVERRIDES_SIZE, content_path, inspect, profile,
};
use crate::{
    GameProfile, Settings, content,
    download::{Artifact, Checksum, DownloadEngine, DownloadProgress},
};
use anyhow::{Context, Result, ensure};
use std::{collections::BTreeSet, fs, io::Read, path::Path};
use tokio_util::sync::CancellationToken;

pub async fn install(
    settings: &Settings,
    target: &GameProfile,
    archive: &Path,
    cancellation: CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<()> {
    let index = inspect(archive)?;
    let expected = profile(&index)?;
    ensure!(
        expected.game_version == target.game_version
            && expected.loader == target.loader
            && expected.loader_version == target.loader_version,
        "content.errors.compatibility"
    );
    let root = content::root(settings, target)?;
    fs::create_dir_all(&root)?;
    let staging = tempfile::tempdir_in(&root)?;
    let mut zip = zip::ZipArchive::new(fs::File::open(archive)?)?;
    ensure!(zip.len() <= MAX_ARCHIVE_ENTRIES, "content.errors.size");
    let mut client_overrides = BTreeSet::new();
    for name in zip.file_names() {
        if let Some(relative) = name?.strip_prefix("client-overrides/") {
            client_overrides.insert(relative.to_owned());
        }
    }
    let mut artifacts = Vec::new();
    let mut paths = BTreeSet::new();
    for file in &index.files {
        if file
            .env
            .get("client")
            .is_some_and(|value| value == "unsupported")
        {
            continue;
        }
        let final_path = content::path(&root, &file.path)?;
        if final_path.exists() {
            // Installed bytes may come from the client override; compare its final hash below.
            if client_overrides.contains(&file.path) {
                continue;
            }
            ensure!(
                final_path.is_file()
                    && final_path.metadata()?.len() == file.file_size
                    && content::hash_file(&final_path)?.eq_ignore_ascii_case(&file.hashes["sha1"]),
                "content.errors.conflict"
            );
            continue;
        }
        artifacts.push(Artifact {
            url: file.downloads[0].clone(),
            target: staging.path().join(&file.path),
            expected_size: Some(file.file_size),
            checksum: Some(Checksum::Sha1(file.hashes["sha1"].clone())),
        });
        paths.insert(file.path.clone());
    }
    DownloadEngine::new(settings.network.clone())?
        .download(artifacts, cancellation.clone(), progress)
        .await?;
    if cancellation.is_cancelled() {
        return Err(crate::download::DownloadError::Cancelled.into());
    }
    let mut total = 0u64;
    let mut overridden = BTreeSet::new();
    // Client-specific overrides intentionally replace generic overrides from the same archive.
    for prefix in ["overrides/", "client-overrides/"] {
        for i in 0..zip.len() {
            if cancellation.is_cancelled() {
                return Err(crate::download::DownloadError::Cancelled.into());
            }
            let file = zip.by_index(i)?;
            let Some(relative) = file.name()?.strip_prefix(prefix).map(str::to_owned) else {
                continue;
            };
            if relative.is_empty() || file.is_dir() {
                continue;
            }
            ensure!(
                file.enclosed_name().is_some()
                    && file
                        .unix_mode()
                        .is_none_or(|mode| mode & 0o170000 != 0o120000),
                "content.errors.path"
            );
            content_path(&relative)?;
            ensure!(file.size() <= MAX_OVERRIDE_SIZE, "content.errors.size");
            total = total
                .checked_add(file.size())
                .context("content.errors.size")?;
            ensure!(total <= MAX_OVERRIDES_SIZE, "content.errors.size");
            let unique = format!("{prefix}{}", relative.to_ascii_lowercase());
            ensure!(overridden.insert(unique), "content.errors.conflict");
            let destination = content::path(staging.path(), &relative)?;
            if prefix == "overrides/" {
                ensure!(!paths.contains(&relative), "content.errors.conflict");
            }
            fs::create_dir_all(destination.parent().context("content.errors.path")?)?;
            let mut output = fs::File::create(destination)?;
            let declared = file.size();
            let copied = std::io::copy(&mut file.take(MAX_OVERRIDE_SIZE + 1), &mut output)?;
            ensure!(
                copied == declared && copied <= MAX_OVERRIDE_SIZE,
                "content.errors.size"
            );
            output.sync_all()?;
            paths.insert(relative);
        }
    }
    // Compare installed files only after client overrides have replaced generic ones.
    let mut replacements = Vec::new();
    for relative in paths {
        if cancellation.is_cancelled() {
            return Err(crate::download::DownloadError::Cancelled.into());
        }
        let existing = content::path(&root, &relative)?;
        if existing.exists() {
            ensure!(
                existing.is_file()
                    && content::hash_file(&existing)?
                        == content::hash_file(&content::path(staging.path(), &relative)?)?,
                "content.errors.conflict"
            );
        } else {
            replacements.push(relative);
        }
    }
    if cancellation.is_cancelled() {
        return Err(crate::download::DownloadError::Cancelled.into());
    }
    content::commit(&root, staging.path(), &replacements, &[])
}
