//! Instance-local content with checked paths, verified downloads and rollback.
use crate::{
    GameProfile, Settings,
    download::{Artifact, Checksum, DownloadEngine, DownloadProgress},
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha1::{Digest, Sha1};
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

const REGISTRY: &str = ".paradox-content.json";
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ContentRecord {
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    pub url: String,
    pub sha1: String,
    pub size: u64,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ContentEntry {
    pub name: String,
    pub category: String,
    pub size: u64,
    pub enabled: bool,
    pub record: Option<ContentRecord>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Project {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub project_type: String,
    pub downloads: u64,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct SearchResults {
    pub hits: Vec<Project>,
    pub total_hits: u64,
    pub offset: u32,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct RemoteFile {
    pub url: String,
    pub filename: String,
    pub hashes: BTreeMap<String, String>,
    pub size: u64,
    #[serde(default)]
    pub primary: bool,
}
#[derive(Clone, Deserialize)]
struct Dependency {
    version_id: Option<String>,
    project_id: Option<String>,
    dependency_type: String,
}
#[derive(Clone, Deserialize)]
struct Version {
    id: String,
    project_id: String,
    name: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    files: Vec<RemoteFile>,
    dependencies: Vec<Dependency>,
}

pub async fn json<T: DeserializeOwned>(settings: &Settings, path: &str) -> Result<T> {
    let client = settings.network.build_client()?;
    let mut response = client
        .get(format!("https://api.modrinth.com/v2/{path}"))
        .timeout(Duration::from_secs(settings.network.timeout_seconds.into()))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("content.errors.network"))?
        .error_for_status()
        .map_err(|_| anyhow::anyhow!("content.errors.network"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= 8 * 1024 * 1024,
            "content.errors.response"
        );
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("content.errors.response"))
}
pub async fn search(
    settings: &Settings,
    query: &str,
    category: &str,
    offset: u32,
) -> Result<SearchResults> {
    ensure!(
        query.len() <= 256 && offset <= 10000,
        "content.errors.query"
    );
    ensure!(
        matches!(category, "mod" | "modpack" | "resourcepack" | "shader"),
        "content.errors.category"
    );
    let facets = serde_json::to_string(&vec![vec![format!("project_type:{category}")]])?;
    let params = reqwest::Url::parse_with_params(
        "https://api.modrinth.com/v2/search",
        &[
            ("query", query),
            ("facets", facets.as_str()),
            ("limit", "20"),
            ("offset", offset.to_string().as_str()),
        ],
    )?;
    json(
        settings,
        &format!("search?{}", params.query().unwrap_or_default()),
    )
    .await
}
fn identifier(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "content.errors.project"
    );
    Ok(())
}
fn compatible(version: &Version, profile: &GameProfile, category: &str) -> bool {
    version
        .game_versions
        .iter()
        .any(|v| v == &profile.game_version)
        && (category != "mod" || version.loaders.iter().any(|l| l == &profile.loader))
}
async fn latest(
    settings: &Settings,
    project: &str,
    profile: &GameProfile,
    category: &str,
) -> Result<Version> {
    identifier(project)?;
    let mut params = reqwest::Url::parse_with_params(
        "https://api.modrinth.com/v2/",
        &[(
            "game_versions",
            serde_json::to_string(&[&profile.game_version])?.as_str(),
        )],
    )?;
    if category == "mod" {
        params
            .query_pairs_mut()
            .append_pair("loaders", &serde_json::to_string(&[&profile.loader])?);
    }
    let versions: Vec<Version> = json(
        settings,
        &format!(
            "project/{project}/version?{}",
            params.query().unwrap_or_default()
        ),
    )
    .await?;
    versions
        .into_iter()
        .find(|v| compatible(v, profile, category))
        .ok_or_else(|| anyhow::anyhow!("content.errors.compatibility"))
}
pub async fn pack_file(
    settings: &Settings,
    project: &str,
    profile: &GameProfile,
) -> Result<RemoteFile> {
    let version = latest(settings, project, profile, "modpack").await?;
    version
        .files
        .into_iter()
        .find(|file| file.filename.ends_with(".mrpack"))
        .ok_or_else(|| anyhow::anyhow!("content.errors.pack"))
}

pub async fn latest_pack(settings: &Settings, project: &str) -> Result<RemoteFile> {
    identifier(project)?;
    let versions: Vec<Version> = json(settings, &format!("project/{project}/version")).await?;
    let file = versions
        .into_iter()
        .flat_map(|v| v.files)
        .find(|f| f.filename.ends_with(".mrpack"))
        .context("content.errors.pack")?;
    validate_remote(&file)?;
    ensure!(file.size <= 512 * 1024 * 1024, "content.errors.size");
    Ok(file)
}

pub fn validate_remote(file: &RemoteFile) -> Result<()> {
    crate::model::validate_instance_key(&file.filename)?;
    ensure!(
        (1..=2 * 1024 * 1024 * 1024).contains(&file.size),
        "content.errors.size"
    );
    let url = reqwest::Url::parse(&file.url)?;
    ensure!(
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.host_str() == Some("cdn.modrinth.com"),
        "content.errors.url"
    );
    let hash = file.hashes.get("sha1").context("content.errors.hash")?;
    ensure!(
        hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit()),
        "content.errors.hash"
    );
    Ok(())
}
pub fn root(settings: &Settings, profile: &GameProfile) -> Result<PathBuf> {
    let settings = profile.effective_settings(settings)?;
    let root = settings
        .game_directory
        .join("versions")
        .join(&profile.instance_key);
    let mut path = settings.game_directory.clone();
    for part in ["versions", &profile.instance_key] {
        path.push(part);
        reject_link(&path)?;
    }
    Ok(root)
}
fn reject_link(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let mut linked = metadata.file_type().is_symlink();
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                linked |= metadata.file_attributes() & 0x400 != 0;
            }
            ensure!(!linked, "content.errors.path");
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}
pub fn path(root: &Path, relative: &str) -> Result<PathBuf> {
    ensure!(
        !relative.is_empty() && !relative.contains('\\'),
        "content.errors.path"
    );
    let mut result = root.to_owned();
    reject_link(root)?;
    for component in Path::new(relative).components() {
        let Component::Normal(part) = component else {
            bail!("content.errors.path");
        };
        crate::model::validate_instance_key(part.to_str().context("content.errors.path")?)?;
        result.push(part);
        reject_link(&result)?;
    }
    Ok(result)
}
pub fn registry(root: &Path) -> Result<BTreeMap<String, ContentRecord>> {
    let file = path(root, REGISTRY)?;
    if !file.exists() {
        return Ok(BTreeMap::new());
    }
    ensure!(
        file.metadata()?.len() <= 4 * 1024 * 1024,
        "content.errors.registry"
    );
    serde_json::from_slice(&fs::read(file)?).map_err(|_| anyhow::anyhow!("content.errors.registry"))
}
fn registry_bytes(records: &BTreeMap<String, ContentRecord>) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec_pretty(records)?)
}
pub fn list(
    settings: &Settings,
    profile: &GameProfile,
    category: &str,
) -> Result<Vec<ContentEntry>> {
    ensure!(
        matches!(category, "mods" | "resourcepacks" | "shaderpacks" | "saves"),
        "content.errors.category"
    );
    let root = root(settings, profile)?;
    let records = registry(&root)?;
    let directory = path(&root, category)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory)?.take(4096) {
        let entry = entry?;
        reject_link(&entry.path())?;
        let metadata = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        crate::model::validate_instance_key(&name)?;
        entries.push(ContentEntry {
            record: records.get(&format!("{category}/{name}")).cloned(),
            enabled: !name.ends_with(".disabled"),
            name,
            category: category.into(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}
pub fn toggle(settings: &Settings, profile: &GameProfile, name: &str) -> Result<()> {
    toggle_with_staging(settings, profile, name, |root, records| {
        let stage = tempfile::tempdir_in(root)?;
        fs::write(stage.path().join(REGISTRY), registry_bytes(records)?)?;
        Ok(stage)
    })
}

fn toggle_with_staging(
    settings: &Settings,
    profile: &GameProfile,
    name: &str,
    stage_registry: impl FnOnce(&Path, &BTreeMap<String, ContentRecord>) -> Result<tempfile::TempDir>,
) -> Result<()> {
    crate::model::validate_instance_key(name)?;
    ensure!(
        name.ends_with(".jar") || name.ends_with(".jar.disabled"),
        "content.errors.category"
    );
    let root = root(settings, profile)?;
    let from = format!("mods/{name}");
    let to = format!(
        "mods/{}",
        if let Some(name) = name.strip_suffix(".disabled") {
            name.to_owned()
        } else {
            format!("{name}.disabled")
        }
    );
    ensure!(!path(&root, &to)?.exists(), "content.errors.conflict");
    let mut records = registry(&root)?;
    if let Some(record) = records.remove(&from) {
        records.insert(to.clone(), record);
    }
    let stage = stage_registry(&root, &records)?;
    fs::rename(path(&root, &from)?, path(&root, &to)?)?;
    if let Err(error) = commit(&root, stage.path(), &[REGISTRY.into()], &[]) {
        if fs::rename(path(&root, &to)?, path(&root, &from)?).is_err() {
            bail!("content.errors.recovery: {}", root.join(&to).display());
        }
        return Err(error);
    }
    Ok(())
}
pub fn remove(
    settings: &Settings,
    profile: &GameProfile,
    category: &str,
    name: &str,
) -> Result<()> {
    ensure!(
        matches!(category, "mods" | "resourcepacks" | "shaderpacks"),
        "content.errors.category"
    );
    crate::model::validate_instance_key(name)?;
    let root = root(settings, profile)?;
    let relative = format!("{category}/{name}");
    ensure!(path(&root, &relative)?.is_file(), "content.errors.path");
    let mut records = registry(&root)?;
    records.remove(&relative);
    let stage = tempfile::tempdir_in(&root)?;
    fs::write(stage.path().join(REGISTRY), registry_bytes(&records)?)?;
    commit(&root, stage.path(), &[REGISTRY.into()], &[relative])
}
pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha1::new();
    let mut bytes = [0; 65536];
    loop {
        let length = file.read(&mut bytes)?;
        if length == 0 {
            break;
        }
        digest.update(&bytes[..length]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub async fn install(
    settings: &Settings,
    profile: &GameProfile,
    project: &str,
    category: &str,
    cancellation: CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<()> {
    ensure!(
        matches!(category, "mod" | "resourcepack" | "shader"),
        "content.errors.category"
    );
    ensure!(
        category != "mod" || profile.loader != "vanilla",
        "content.errors.compatibility"
    );
    let mut pending = VecDeque::from([latest(settings, project, profile, category).await?]);
    let mut seen = HashSet::new();
    let mut projects = BTreeMap::new();
    let mut plan = Vec::new();
    while let Some(version) = pending.pop_front() {
        if cancellation.is_cancelled() {
            return Err(crate::download::DownloadError::Cancelled.into());
        }
        if !seen.insert(version.id.clone()) {
            continue;
        }
        ensure!(
            seen.len() <= 64 && compatible(&version, profile, category),
            "content.errors.dependencies"
        );
        ensure!(
            projects
                .insert(version.project_id.clone(), version.id.clone())
                .is_none(),
            "content.errors.dependencies"
        );
        for dependency in &version.dependencies {
            if dependency.dependency_type == "required" {
                let dependency = if let Some(id) = &dependency.version_id {
                    identifier(id)?;
                    json(settings, &format!("version/{id}")).await?
                } else if let Some(id) = &dependency.project_id {
                    latest(settings, id, profile, category).await?
                } else {
                    bail!("content.errors.dependencies");
                };
                pending.push_back(dependency);
            }
        }
        let file = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .context("content.errors.response")?
            .clone();
        validate_remote(&file)?;
        ensure!(
            if category == "mod" {
                file.filename.ends_with(".jar")
            } else {
                file.filename.ends_with(".zip")
            },
            "content.errors.category"
        );
        plan.push((version, file));
    }
    install_files(settings, profile, category, plan, cancellation, progress).await
}

// Apply an already resolved, validated remote plan to the instance in one transaction.
async fn install_files(
    settings: &Settings,
    profile: &GameProfile,
    category: &str,
    plan: Vec<(Version, RemoteFile)>,
    cancellation: CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<()> {
    let directory = match category {
        "mod" => "mods",
        "resourcepack" => "resourcepacks",
        _ => "shaderpacks",
    };
    let root = root(settings, profile)?;
    fs::create_dir_all(&root)?;
    let installed_records = registry(&root)?;
    let mut records = installed_records.clone();
    let stage = tempfile::tempdir_in(&root)?;
    let mut artifacts = Vec::new();
    let mut paths = Vec::new();
    let mut remove = Vec::new();
    let mut targets = HashSet::new();
    for (version, file) in plan {
        let previous: Vec<_> = installed_records
            .iter()
            .filter(|(_, r)| r.project_id == version.project_id)
            .map(|(p, _)| p.clone())
            .collect();
        let mut disabled = false;
        for previous in &previous {
            let existing = path(&root, previous)?;
            disabled |= category == "mod"
                && previous.starts_with("mods/")
                && previous.ends_with(".jar.disabled")
                && existing.is_file();
        }
        let suffix = if disabled { ".disabled" } else { "" };
        let relative = format!("{directory}/{}{suffix}", file.filename);
        ensure!(targets.insert(relative.clone()), "content.errors.conflict");
        ensure!(
            installed_records
                .get(&relative)
                .is_none_or(|r| r.project_id == version.project_id),
            "content.errors.conflict"
        );
        let target = path(&root, &relative)?;
        let hash = file.hashes["sha1"].clone();
        let reuse = if target.exists() {
            ensure!(target.is_file(), "content.errors.conflict");
            let matches = target.metadata()?.len() == file.size
                && hash_file(&target)?.eq_ignore_ascii_case(&hash);
            ensure!(
                matches || installed_records.contains_key(&relative),
                "content.errors.conflict"
            );
            matches
        } else {
            false
        };
        for previous in previous {
            if previous != relative {
                remove.push(previous.clone());
                records.remove(&previous);
            }
        }
        if !reuse {
            artifacts.push(Artifact {
                url: file.url.clone(),
                target: stage.path().join(&relative),
                expected_size: Some(file.size),
                checksum: Some(Checksum::Sha1(hash.clone())),
            });
            paths.push(relative.clone());
        }
        records.insert(
            relative.clone(),
            ContentRecord {
                project_id: version.project_id,
                version_id: version.id,
                title: version.name,
                url: file.url,
                sha1: hash,
                size: file.size,
            },
        );
    }
    DownloadEngine::new(settings.network.clone())?
        .download(artifacts, cancellation.clone(), progress)
        .await?;
    if cancellation.is_cancelled() {
        return Err(crate::download::DownloadError::Cancelled.into());
    }
    fs::write(stage.path().join(REGISTRY), registry_bytes(&records)?)?;
    paths.push(REGISTRY.into());
    commit(&root, stage.path(), &paths, &remove)
}

/// Back up all affected files before publishing; rollback restores originals on any failure.
pub fn commit(
    root: &Path,
    staging: &Path,
    replacements: &[String],
    removals: &[String],
) -> Result<()> {
    fs::create_dir_all(root)?;
    let backups = tempfile::tempdir_in(root)?;
    let mut saved = Vec::new();
    let mut published = Vec::new();
    let result = (|| -> Result<()> {
        let affected: HashSet<_> = replacements.iter().chain(removals).collect();
        for relative in affected {
            let original = path(root, relative)?;
            if original.exists() {
                ensure!(original.is_file(), "content.errors.conflict");
                let backup = path(backups.path(), relative)?;
                fs::create_dir_all(backup.parent().context("content.errors.path")?)?;
                fs::rename(original, backup)?;
                saved.push(relative.clone());
            }
        }
        for relative in replacements {
            let target = path(root, relative)?;
            fs::create_dir_all(target.parent().context("content.errors.path")?)?;
            fs::rename(path(staging, relative)?, target)?;
            published.push(relative.clone());
        }
        Ok(())
    })();
    if let Err(error) = result {
        let mut rollback_failed = false;
        for relative in published.iter().rev() {
            rollback_failed |= fs::remove_file(path(root, relative)?).is_err();
        }
        for relative in saved.iter().rev() {
            rollback_failed |=
                fs::rename(path(backups.path(), relative)?, path(root, relative)?).is_err();
        }
        if rollback_failed {
            let recovery = backups.keep();
            bail!("content.errors.recovery: {}", recovery.display());
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance() -> (tempfile::TempDir, Settings, GameProfile, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            network: crate::network::NetworkOptions {
                max_retries: 0,
                timeout_seconds: 3,
                ..Default::default()
            },
            ..Settings::default()
        };
        let mut profile = GameProfile::new("Content updates", "1.21.1").unwrap();
        profile.loader = "fabric".into();
        profile.loader_version = "0.16.10".into();
        let root = root(&settings, &profile).unwrap();
        fs::create_dir_all(&root).unwrap();
        (temp, settings, profile, root)
    }

    fn old_record() -> ContentRecord {
        ContentRecord {
            project_id: "project".into(),
            version_id: "old-version".into(),
            title: "Old version".into(),
            url: "https://cdn.modrinth.com/old.jar".into(),
            sha1: format!("{:x}", Sha1::digest(b"old")),
            size: 3,
        }
    }

    fn new_plan(filename: &str, url: &str) -> Vec<(Version, RemoteFile)> {
        let file = RemoteFile {
            url: url.into(),
            filename: filename.into(),
            size: 3,
            primary: true,
            hashes: BTreeMap::from([(
                "sha1".into(),
                "c2a6b03f190dfb2b4aa91f8af8d477a9bc3401dc".into(),
            )]),
        };
        vec![(
            Version {
                id: "new-version".into(),
                project_id: "project".into(),
                name: "New version".into(),
                game_versions: vec!["1.21.1".into()],
                loaders: vec!["fabric".into()],
                files: vec![file.clone()],
                dependencies: Vec::new(),
            },
            file,
        )]
    }

    fn write_content(root: &Path, relative: &str, bytes: &[u8]) {
        let target = root.join(relative);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, bytes).unwrap();
    }

    fn register(root: &Path, relative: &str, record: ContentRecord) {
        fs::write(
            root.join(REGISTRY),
            registry_bytes(&BTreeMap::from([(relative.into(), record)])).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn failed_mod_toggle_staging_preserves_filename_and_registration() {
        for partial_write in [false, true] {
            let (_temp, settings, profile, root) = instance();
            write_content(&root, "mods/old.jar", b"old");
            register(&root, "mods/old.jar", old_record());
            let before = fs::read(root.join(REGISTRY)).unwrap();
            let result = toggle_with_staging(&settings, &profile, "old.jar", |root, _records| {
                if partial_write {
                    let stage = tempfile::tempdir_in(root)?;
                    fs::write(stage.path().join(REGISTRY), b"partial write")?;
                }
                Err(std::io::Error::other("injected staging I/O failure").into())
            });
            assert!(result.is_err());
            assert_eq!(fs::read(root.join("mods/old.jar")).unwrap(), b"old");
            assert!(!root.join("mods/old.jar.disabled").exists());
            assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
            assert_eq!(fs::read_dir(root).unwrap().count(), 2);
        }
    }

    #[test]
    fn mod_toggle_updates_filename_and_registration_together() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/old.jar", b"old");
        register(&root, "mods/old.jar", old_record());
        for (before, after, enabled) in [
            ("old.jar", "old.jar.disabled", false),
            ("old.jar.disabled", "old.jar", true),
        ] {
            toggle(&settings, &profile, before).unwrap();
            assert!(!root.join("mods").join(before).exists());
            assert_eq!(fs::read(root.join("mods").join(after)).unwrap(), b"old");
            let records = registry(&root).unwrap();
            assert!(!records.contains_key(&format!("mods/{before}")));
            assert_eq!(records[&format!("mods/{after}")].version_id, "old-version");
            let entries = list(&settings, &profile, "mods").unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].enabled, enabled);
        }
    }

    #[test]
    fn failed_mod_toggle_publication_restores_filename_and_registration() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/old.jar.disabled", b"old");
        register(&root, "mods/old.jar.disabled", old_record());
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let result =
            toggle_with_staging(&settings, &profile, "old.jar.disabled", |root, _records| {
                // Missing staged registration forces a failure after the original
                // registration has been moved to the publication backup.
                Ok(tempfile::tempdir_in(root)?)
            });
        assert!(result.is_err());
        assert_eq!(
            fs::read(root.join("mods/old.jar.disabled")).unwrap(),
            b"old"
        );
        assert!(!root.join("mods/old.jar").exists());
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert_eq!(fs::read_dir(root).unwrap().count(), 2);
    }

    async fn serve_file(bytes: &'static [u8]) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/new.jar", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(stream.read_u8().await.unwrap());
                assert!(request.len() <= 8192);
            }
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            );
            stream.write_all(header.as_bytes()).await.unwrap();
            stream.write_all(bytes).await.unwrap();
        });
        (url, server)
    }

    #[tokio::test]
    async fn downloaded_mod_updates_preserve_enabled_state() {
        for suffix in [".disabled", ""] {
            let (_temp, settings, profile, root) = instance();
            let previous = format!("mods/old.jar{suffix}");
            write_content(&root, &previous, b"old");
            register(&root, &previous, old_record());
            let (url, server) = serve_file(b"new").await;

            install_files(
                &settings,
                &profile,
                "mod",
                new_plan("new.jar", &url),
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap();

            let entries = list(&settings, &profile, "mods").unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].name, format!("new.jar{suffix}"));
            assert_eq!(entries[0].enabled, suffix.is_empty());
            assert_eq!(
                entries[0].record.as_ref().unwrap().version_id,
                "new-version"
            );
            assert_eq!(
                fs::read(root.join(format!("mods/new.jar{suffix}"))).unwrap(),
                b"new"
            );
            assert!(!root.join(previous).exists());
            assert_eq!(registry(&root).unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn reused_files_refresh_records_and_remove_old_versions() {
        for (category, directory, extension) in [
            ("mod", "mods", "jar"),
            ("mod", "mods", "jar.disabled"),
            ("resourcepack", "resourcepacks", "zip"),
            ("shader", "shaderpacks", "zip"),
        ] {
            let (_temp, settings, profile, root) = instance();
            let previous = format!("{directory}/old.{extension}");
            let target = format!("{directory}/new.{extension}");
            write_content(&root, &previous, b"old");
            write_content(&root, &target, b"new");
            register(&root, &previous, old_record());
            let filename = if category == "mod" {
                "new.jar"
            } else {
                "new.zip"
            };

            install_files(
                &settings,
                &profile,
                category,
                new_plan(filename, "https://cdn.modrinth.com/new"),
                CancellationToken::new(),
                |progress| assert_eq!(progress.total_files, 0, "matching file must not download"),
            )
            .await
            .unwrap();

            let records = registry(&root).unwrap();
            assert!(
                !records.contains_key(&previous),
                "old version must be unregistered"
            );
            assert_eq!(records.len(), 1);
            assert_eq!(records[&target].version_id, "new-version");
            assert_eq!(records[&target].title, "New version");
            assert!(!root.join(previous).exists());
            assert_eq!(fs::read(root.join(target)).unwrap(), b"new");
        }
    }

    #[tokio::test]
    async fn unchanged_filename_and_bytes_still_refresh_version_metadata() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/new.jar", b"new");
        register(&root, "mods/new.jar", old_record());

        install_files(
            &settings,
            &profile,
            "mod",
            new_plan("new.jar", "https://cdn.modrinth.com/new.jar"),
            CancellationToken::new(),
            |progress| assert_eq!(progress.total_files, 0),
        )
        .await
        .unwrap();

        let records = registry(&root).unwrap();
        assert_eq!(records["mods/new.jar"].version_id, "new-version");
        assert_eq!(
            records["mods/new.jar"].sha1,
            "c2a6b03f190dfb2b4aa91f8af8d477a9bc3401dc"
        );
        assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"new");
    }

    #[tokio::test]
    async fn matching_file_owned_by_another_project_is_a_conflict() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/new.jar", b"new");
        let mut record = old_record();
        record.project_id = "other-project".into();
        register(&root, "mods/new.jar", record);
        let before = fs::read(root.join(REGISTRY)).unwrap();

        let error = install_files(
            &settings,
            &profile,
            "mod",
            new_plan("new.jar", "https://cdn.modrinth.com/new.jar"),
            CancellationToken::new(),
            |progress| assert_eq!(progress.total_files, 0),
        )
        .await
        .unwrap_err();

        assert_eq!(error.to_string(), "content.errors.conflict");
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"new");
    }

    #[tokio::test]
    async fn dependency_cannot_reuse_a_file_scheduled_for_removal_by_another_project() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/shared.jar", b"new");
        write_content(&root, "mods/new.jar", b"new");
        register(&root, "mods/shared.jar", old_record());
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let mut plan = new_plan("new.jar", "https://cdn.modrinth.com/new.jar");
        let mut dependency = new_plan("shared.jar", "https://cdn.modrinth.com/shared.jar");
        dependency[0].0.project_id = "dependency".into();
        dependency[0].0.id = "dependency-version".into();
        plan.extend(dependency);

        let error = install_files(
            &settings,
            &profile,
            "mod",
            plan,
            CancellationToken::new(),
            |progress| assert_eq!(progress.total_files, 0),
        )
        .await
        .unwrap_err();

        assert_eq!(error.to_string(), "content.errors.conflict");
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert_eq!(fs::read(root.join("mods/shared.jar")).unwrap(), b"new");
        assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"new");
    }

    #[tokio::test]
    async fn failed_update_download_preserves_disabled_file_and_registry() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/old.jar.disabled", b"old");
        register(&root, "mods/old.jar.disabled", old_record());
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let (url, server) = serve_file(b"bad").await;

        assert!(
            install_files(
                &settings,
                &profile,
                "mod",
                new_plan("new.jar", &url),
                CancellationToken::new(),
                |_| {},
            )
            .await
            .is_err()
        );
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(
            fs::read(root.join("mods/old.jar.disabled")).unwrap(),
            b"old"
        );
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert_eq!(fs::read_dir(root.join("mods")).unwrap().count(), 1);
        assert_eq!(fs::read_dir(root).unwrap().count(), 2);
    }

    #[tokio::test]
    async fn cancelled_reused_update_preserves_old_file_and_registry() {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/old.jar.disabled", b"old");
        write_content(&root, "mods/new.jar.disabled", b"new");
        register(&root, "mods/old.jar.disabled", old_record());
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let cancellation = CancellationToken::new();
        let cancel_at_download = cancellation.clone();

        assert!(
            install_files(
                &settings,
                &profile,
                "mod",
                new_plan("new.jar", "https://cdn.modrinth.com/new.jar"),
                cancellation,
                move |progress| {
                    assert_eq!(progress.total_files, 0);
                    cancel_at_download.cancel();
                },
            )
            .await
            .is_err()
        );

        assert_eq!(
            fs::read(root.join("mods/old.jar.disabled")).unwrap(),
            b"old"
        );
        assert_eq!(
            fs::read(root.join("mods/new.jar.disabled")).unwrap(),
            b"new"
        );
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert_eq!(fs::read_dir(root).unwrap().count(), 2);
    }

    #[test]
    fn failed_update_publication_restores_removed_version_and_registry() {
        let (_temp, _settings, _profile, root) = instance();
        write_content(&root, "mods/old.jar.disabled", b"old");
        register(&root, "mods/old.jar.disabled", old_record());
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let stage = tempfile::tempdir().unwrap();
        write_content(stage.path(), "mods/new.jar.disabled", b"new");
        fs::write(stage.path().join(REGISTRY), b"{}").unwrap();

        assert!(
            commit(
                &root,
                stage.path(),
                &[
                    "mods/new.jar.disabled".into(),
                    REGISTRY.into(),
                    "missing".into()
                ],
                &["mods/old.jar.disabled".into()],
            )
            .is_err()
        );

        assert_eq!(
            fs::read(root.join("mods/old.jar.disabled")).unwrap(),
            b"old"
        );
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert!(!root.join("mods/new.jar.disabled").exists());
        assert_eq!(fs::read_dir(root).unwrap().count(), 2);
    }
    #[test]
    fn invalid_paths_and_download_urls_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        for name in ["../x", "C:/x", "x\\y", "/x", "mods/CON.jar"] {
            assert!(path(temp.path(), name).is_err());
        }
        let mut file = RemoteFile {
            url: "https://cdn.modrinth.com/a.jar".into(),
            filename: "a.jar".into(),
            size: 10,
            primary: true,
            hashes: BTreeMap::from([("sha1".into(), "a".repeat(40))]),
        };
        validate_remote(&file).unwrap();
        file.url = "http://evil.invalid/a".into();
        assert!(validate_remote(&file).is_err());
    }
    #[test]
    fn failed_publication_restores_all_original_files() {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a"), b"old").unwrap();
        fs::write(stage.path().join("a"), b"new").unwrap();
        assert!(
            commit(
                root.path(),
                stage.path(),
                &["a".into(), "missing".into()],
                &[]
            )
            .is_err()
        );
        assert_eq!(fs::read(root.path().join("a")).unwrap(), b"old");
    }
}
