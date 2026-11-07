//! Verified .mrpack and portable instance archives; imports never overwrite SDK metadata.
use crate::{
    GameProfile, Settings, content,
    download::{Artifact, Checksum, DownloadEngine, DownloadProgress},
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;

const MAX_ARCHIVE_SIZE: u64 = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10000;
const MAX_OVERRIDE_SIZE: u64 = 128 * 1024 * 1024;
const MAX_OVERRIDES_SIZE: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackIndex {
    pub format_version: u32,
    pub game: String,
    pub version_id: String,
    pub name: String,
    #[serde(default)]
    pub files: Vec<PackFile>,
    pub dependencies: BTreeMap<String, String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    pub path: String,
    pub hashes: BTreeMap<String, String>,
    pub downloads: Vec<String>,
    pub file_size: u64,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}
pub fn content_path(relative: &str) -> Result<()> {
    let first = relative.split('/').next().unwrap_or_default();
    ensure!(
        matches!(
            first,
            "mods"
                | "resourcepacks"
                | "shaderpacks"
                | "config"
                | "defaultconfigs"
                | "kubejs"
                | "scripts"
                | "saves"
        ) || matches!(relative, "options.txt" | "servers.dat"),
        "content.errors.path"
    );
    // The same checks as local content operations, including Windows reserved names.
    content::path(Path::new("."), relative)?;
    Ok(())
}
fn validate_index(index: &PackIndex) -> Result<()> {
    ensure!(
        index.format_version == 1 && index.game == "minecraft" && index.files.len() <= 10000,
        "content.errors.pack"
    );
    let profile = profile(index)?;
    profile.validate()?;
    let mut paths = BTreeSet::new();
    let mut bytes = 0u64;
    for file in &index.files {
        content_path(&file.path)?;
        ensure!(
            paths.insert(file.path.to_ascii_lowercase()),
            "content.errors.conflict"
        );
        ensure!(file.file_size <= 512 * 1024 * 1024, "content.errors.size");
        bytes = bytes
            .checked_add(file.file_size)
            .context("content.errors.size")?;
        ensure!(bytes <= 8 * 1024 * 1024 * 1024, "content.errors.size");
        let sha1 = file.hashes.get("sha1").context("content.errors.hash")?;
        ensure!(
            sha1.len() == 40 && sha1.bytes().all(|b| b.is_ascii_hexdigit()),
            "content.errors.hash"
        );
        ensure!(
            !file.downloads.is_empty() && file.downloads.len() <= 8,
            "content.errors.url"
        );
        for url in &file.downloads {
            validate_url(url)?;
        }
        ensure!(
            file.env
                .get("client")
                .is_none_or(|v| matches!(v.as_str(), "required" | "optional" | "unsupported")),
            "content.errors.pack"
        );
    }
    Ok(())
}
fn validate_url(raw: &str) -> Result<()> {
    let url = reqwest::Url::parse(raw)?;
    ensure!(
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(
                url.host_str(),
                Some(
                    "cdn.modrinth.com"
                        | "github.com"
                        | "raw.githubusercontent.com"
                        | "objects.githubusercontent.com"
                        | "mediafilez.forgecdn.net"
                        | "edge.forgecdn.net"
                )
            ),
        "content.errors.url"
    );
    Ok(())
}
pub fn profile(index: &PackIndex) -> Result<GameProfile> {
    let game = index
        .dependencies
        .get("minecraft")
        .context("content.errors.pack")?;
    let mut profile = GameProfile::new(&index.name, game)?;
    let mut loader = None;
    for (key, value) in &index.dependencies {
        let kind = match key.as_str() {
            "minecraft" => continue,
            "fabric-loader" => "fabric",
            "quilt-loader" => "quilt",
            "forge" => "forge",
            "neoforge" => "neoforge",
            _ => bail!("loaders.errors.unsupported"),
        };
        ensure!(loader.is_none(), "content.errors.pack");
        loader = Some((kind, value));
    }
    if let Some((kind, value)) = loader {
        profile.loader = kind.into();
        profile.loader_version = value.clone();
    }
    profile.validate()?;
    Ok(profile)
}
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

fn export_with_size_limit(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exporting_into_content_does_not_include_the_active_archive() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Nested export", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/settings.txt"), b"setting=true").unwrap();
        let archive = root.join("config/./export.mrpack");
        fs::write(&archive, b"previous export").unwrap();

        export(&settings, &source, &archive, false).unwrap();

        let mut zip = zip::ZipArchive::new(fs::File::open(&archive).unwrap()).unwrap();
        assert_eq!(zip.len(), 2);
        let mut bytes = Vec::new();
        zip.by_name("overrides/config/settings.txt")
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, b"setting=true");
        drop(zip);

        let target = profile(&inspect(&archive).unwrap()).unwrap();
        install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        let imported = content::root(&settings, &target).unwrap();
        assert_eq!(
            fs::read(imported.join("config/settings.txt")).unwrap(),
            b"setting=true"
        );
        assert_eq!(fs::read_dir(imported.join("config")).unwrap().count(), 1);
    }

    #[test]
    fn unimportable_large_override_preserves_the_existing_export() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Large world", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("saves")).unwrap();
        fs::File::create(root.join("saves/large.dat"))
            .unwrap()
            .set_len(128 * 1024 * 1024 + 1)
            .unwrap();
        let archive = temp.path().join("existing.mrpack");
        fs::write(&archive, b"existing archive").unwrap();

        let error = export(&settings, &source, &archive, true).unwrap_err();

        assert!(error.to_string().contains("content.errors.size"));
        assert_eq!(fs::read(&archive).unwrap(), b"existing archive");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    #[test]
    fn export_reserves_an_archive_entry_for_the_index() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Many files", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        for number in 0..10000 {
            fs::write(root.join(format!("config/{number}.txt")), b"").unwrap();
        }
        let archive = temp.path().join("existing.mrpack");
        fs::write(&archive, b"existing archive").unwrap();

        let error = export(&settings, &source, &archive, false).unwrap_err();

        assert!(error.to_string().contains("content.errors.size"));
        assert_eq!(fs::read(&archive).unwrap(), b"existing archive");
    }

    #[test]
    fn an_archive_exceeding_the_import_size_limit_preserves_the_existing_export() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Archive size", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/settings.txt"), b"setting=true").unwrap();
        let archive = temp.path().join("existing.mrpack");
        fs::write(&archive, b"existing archive").unwrap();

        let error = export_with_size_limit(&settings, &source, &archive, false, 64).unwrap_err();

        assert!(error.to_string().contains("content.errors.size"));
        assert_eq!(fs::read(&archive).unwrap(), b"existing archive");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    fn write_pack(archive: &Path, files: Vec<PackFile>, entries: &[(&str, &[u8])]) {
        let index = PackIndex {
            format_version: 1,
            game: "minecraft".into(),
            version_id: "v1".into(),
            name: "Override pack".into(),
            files,
            dependencies: BTreeMap::from([("minecraft".into(), "1.21.1".into())]),
        };
        let mut zip = zip::ZipWriter::new(fs::File::create(archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("modrinth.index.json", options).unwrap();
        zip.write_all(&serde_json::to_vec(&index).unwrap()).unwrap();
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn write_override_pack(archive: &Path) {
        write_pack(
            archive,
            vec![],
            &[
                ("overrides/config/shared.txt", b"generic"),
                ("client-overrides/config/shared.txt", b"client"),
                ("overrides/config/additional.txt", b"additional"),
            ],
        );
    }

    fn write_indexed_client_override_pack(archive: &Path, client_contents: &[u8]) {
        write_pack(
            archive,
            vec![PackFile {
                path: "config/shared.txt".into(),
                hashes: BTreeMap::from([(
                    "sha1".into(),
                    // SHA-1 of the indexed contents, "abc".
                    "a9993e364706816aba3e25717850c26c9cd0d89d".into(),
                )]),
                downloads: vec!["https://cdn.modrinth.com/indexed.txt".into()],
                file_size: 3,
                env: BTreeMap::new(),
            }],
            &[
                ("client-overrides/config/shared.txt", client_contents),
                ("overrides/config/additional.txt", b"additional"),
            ],
        );
    }

    #[tokio::test]
    async fn indexed_client_overrides_can_be_reimported_with_the_same_final_contents() {
        for client_contents in [b"xyz".as_slice(), b"client".as_slice()] {
            let temp = tempfile::tempdir().unwrap();
            let settings = Settings {
                game_directory: temp.path().join("minecraft"),
                ..Settings::default()
            };
            let archive = temp.path().join("indexed-client.mrpack");
            write_indexed_client_override_pack(&archive, client_contents);
            let target = profile(&inspect(&archive).unwrap()).unwrap();
            let root = content::root(&settings, &target).unwrap();
            fs::create_dir_all(root.join("config")).unwrap();
            // The previous import leaves the client override, not the indexed bytes.
            fs::write(root.join("config/shared.txt"), client_contents).unwrap();

            for _ in 0..2 {
                install(
                    &settings,
                    &target,
                    &archive,
                    CancellationToken::new(),
                    |progress| assert_eq!(progress.total_files, 0),
                )
                .await
                .unwrap();

                assert_eq!(
                    fs::read(root.join("config/shared.txt")).unwrap(),
                    client_contents
                );
                assert_eq!(
                    fs::read(root.join("config/additional.txt")).unwrap(),
                    b"additional"
                );
            }
        }
    }

    #[tokio::test]
    async fn conflicting_indexed_client_override_preserves_installed_files() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let archive = temp.path().join("indexed-client.mrpack");
        write_indexed_client_override_pack(&archive, b"client");
        let target = profile(&inspect(&archive).unwrap()).unwrap();
        let root = content::root(&settings, &target).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/shared.txt"), b"user customization").unwrap();

        let error = install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |progress| assert_eq!(progress.total_files, 0),
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("content.errors.conflict"));
        assert_eq!(
            fs::read(root.join("config/shared.txt")).unwrap(),
            b"user customization"
        );
        assert!(!root.join("config/additional.txt").exists());
    }

    #[tokio::test]
    async fn client_overrides_can_be_installed_twice_with_the_same_final_contents() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let archive = temp.path().join("overrides.mrpack");
        write_override_pack(&archive);
        let target = profile(&inspect(&archive).unwrap()).unwrap();
        let root = content::root(&settings, &target).unwrap();

        for _ in 0..2 {
            install(
                &settings,
                &target,
                &archive,
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(fs::read(root.join("config/shared.txt")).unwrap(), b"client");
            assert_eq!(
                fs::read(root.join("config/additional.txt")).unwrap(),
                b"additional"
            );
        }
    }

    #[tokio::test]
    async fn conflicting_final_override_preserves_installed_files() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let archive = temp.path().join("overrides.mrpack");
        write_override_pack(&archive);
        let target = profile(&inspect(&archive).unwrap()).unwrap();
        let root = content::root(&settings, &target).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/shared.txt"), b"user customization").unwrap();

        let error = install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("content.errors.conflict"));
        assert_eq!(
            fs::read(root.join("config/shared.txt")).unwrap(),
            b"user customization"
        );
        assert!(!root.join("config/additional.txt").exists());
    }

    #[test]
    fn malicious_pack_paths_and_multiple_loaders_are_rejected() {
        for path in [
            "../x",
            "mods/../../x",
            "mods/CON.jar",
            "versions/a.json",
            ".paradox-content.json",
            "config/x\\y",
        ] {
            assert!(content_path(path).is_err());
        }
        let mut index = PackIndex {
            format_version: 1,
            game: "minecraft".into(),
            version_id: "v1".into(),
            name: "test".into(),
            files: vec![],
            dependencies: BTreeMap::from([
                ("minecraft".into(), "1.21.1".into()),
                ("fabric-loader".into(), "0.16.10".into()),
            ]),
        };
        validate_index(&index).unwrap();
        index.dependencies.insert("forge".into(), "51.0.0".into());
        assert!(validate_index(&index).is_err());
    }
    #[tokio::test]
    async fn portable_export_import_round_trips_local_files_without_private_configuration() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("My pack", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::write(root.join("mods/local.jar"), b"LOCAL").unwrap();
        fs::write(root.join("account-secret"), b"SECRET").unwrap();
        let archive = temp.path().join("portable.mrpack");
        export(&settings, &source, &archive, false).unwrap();
        let index = inspect(&archive).unwrap();
        let target = profile(&index).unwrap();
        install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read(
                content::root(&settings, &target)
                    .unwrap()
                    .join("mods/local.jar")
            )
            .unwrap(),
            b"LOCAL"
        );
        assert!(
            !content::root(&settings, &target)
                .unwrap()
                .join("account-secret")
                .exists()
        );
    }
}
