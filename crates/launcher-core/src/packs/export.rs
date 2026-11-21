//! Export only portable content through a bounded atomic archive publication.
use super::{
    MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_SIZE, MAX_OVERRIDE_SIZE, MAX_OVERRIDES_SIZE, PackIndex,
};
use crate::{GameProfile, Settings, content};
use anyhow::{Context, Result, ensure};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::Path,
};

pub fn export(
    settings: &Settings,
    profile: &GameProfile,
    destination: &Path,
    include_saves: bool,
) -> Result<()> {
    export_with_size_limit(
        settings,
        profile,
        destination,
        include_saves,
        MAX_ARCHIVE_SIZE,
    )
}

pub(super) fn export_with_size_limit(
    settings: &Settings,
    profile: &GameProfile,
    destination: &Path,
    include_saves: bool,
    archive_size_limit: u64,
) -> Result<()> {
    ensure!(destination.is_absolute(), "content.errors.path");
    let root = content::root(settings, profile)?;
    let mut dependencies = BTreeMap::from([("minecraft".into(), profile.game_version.clone())]);
    if profile.loader != "vanilla" {
        let key = match profile.loader.as_str() {
            "fabric" => "fabric-loader",
            "quilt" => "quilt-loader",
            value => value,
        };
        dependencies.insert(key.into(), profile.loader_version.clone());
    }
    let index = PackIndex {
        format_version: 1,
        game: "minecraft".into(),
        version_id: "1.0.0".into(),
        name: profile.name.clone(),
        dependencies,
        files: Vec::new(),
    };
    let parent = destination.parent().context("content.errors.path")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    let temporary_path = temp.path().canonicalize()?;
    let existing_destination = destination
        .exists()
        .then(|| destination.canonicalize())
        .transpose()?;
    {
        let mut zip = zip::ZipWriter::new(temp.as_file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let name = if destination.extension().is_some_and(|e| e == "mrpack") {
            "modrinth.index.json"
        } else {
            "paradox-instance.json"
        };
        zip.start_file(name, options)?;
        zip.write_all(&serde_json::to_vec_pretty(&index)?)?;
        let mut pending = Vec::new();
        for category in [
            "mods",
            "resourcepacks",
            "shaderpacks",
            "config",
            "defaultconfigs",
            "kubejs",
            "scripts",
            "options.txt",
            "servers.dat",
        ] {
            let path = content::path(&root, category)?;
            if path.exists() {
                pending.push((category.to_owned(), path));
            }
        }
        if include_saves {
            let path = content::path(&root, "saves")?;
            if path.exists() {
                pending.push(("saves".into(), path));
            }
        }
        let mut count = 1; // The index also occupies an archive entry.
        let mut bytes = 0u64;
        while let Some((relative, _file)) = pending.pop() {
            let file = content::path(&root, &relative)?;
            let canonical = file.canonicalize()?;
            if canonical == temporary_path
                || existing_destination
                    .as_ref()
                    .is_some_and(|destination| &canonical == destination)
            {
                continue;
            }
            if file.is_dir() {
                for entry in fs::read_dir(file)? {
                    let entry = entry?;
                    pending.push((
                        format!(
                            "{relative}/{}",
                            entry.file_name().to_str().context("content.errors.path")?
                        ),
                        entry.path(),
                    ));
                }
                continue;
            }
            let size = file.metadata()?.len();
            ensure!(size <= MAX_OVERRIDE_SIZE, "content.errors.size");
            count += 1;
            bytes = bytes.checked_add(size).context("content.errors.size")?;
            ensure!(
                count <= MAX_ARCHIVE_ENTRIES && bytes <= MAX_OVERRIDES_SIZE,
                "content.errors.size"
            );
            zip.start_file(format!("overrides/{relative}"), options)?;
            let copied = std::io::copy(
                &mut fs::File::open(file)?.take(MAX_OVERRIDE_SIZE + 1),
                &mut zip,
            )?;
            ensure!(
                copied == size && copied <= MAX_OVERRIDE_SIZE,
                "content.errors.size"
            );
        }
        zip.finish()?;
    }
    ensure!(
        temp.as_file().metadata()?.len() <= archive_size_limit,
        "content.errors.size"
    );
    temp.as_file().sync_all()?;
    temp.persist(destination)?;
    Ok(())
}
