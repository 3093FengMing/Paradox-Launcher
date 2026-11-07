use std::{
    cmp::Ordering,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use elemental::{
    core::{
        auth::{
            authorizer::Authorizer, authorizers::offline::OfflineAuthorizer,
            credential::UserCredential,
        },
        launcher::command::LaunchCommand,
        launcher::process,
        storage::Storage,
    },
    driver::{
        driver::InstalledDriver,
        drivers::vanilla::{
            catalog::VanillaCatalog,
            prepared::{ResolvedVanillaMetadata, ResolvedVanillaVersion},
            source::{VanillaSource, resolve_vanilla_metadata},
        },
        families::version_json::{
            launch::LaunchResolution,
            layout::{BaseInstanceLayout, BaseRootLayout},
            storage::VersionJsonGameStorageExt,
        },
    },
    infra::downloader::plan::DownloadPlanner,
    launcher::{LaunchOptions, Launcher},
};
use tokio_util::sync::CancellationToken;

pub use elemental::core::launcher::process::LoggedChild;

use crate::{
    GameProfile, GameVersion, InstalledInstance, Settings,
    download::{Artifact, Checksum, DownloadEngine, DownloadError, DownloadProgress},
    java,
};

/// The only module that knows Elemental types. UI state stays application-owned.
pub struct ElementalService {
    launcher: Launcher,
    settings: Settings,
}

/// A validated launch command whose game process has not been created yet.
/// The command can contain credentials, so it deliberately does not expose Debug.
pub struct PreparedGameLaunch {
    command: LaunchCommand,
}

impl PreparedGameLaunch {
    /// Create the game process after the caller has resolved its cancellation boundary.
    pub fn spawn(self) -> Result<LoggedChild> {
        process::spawn_command_logged(self.command).context("无法启动 Java 进程")
    }
}

struct LaunchIdentity {
    credential: Option<UserCredential>,
    username: String,
}
impl Authorizer for LaunchIdentity {
    async fn authorize(&self) -> Result<UserCredential> {
        match &self.credential {
            Some(credential) => Ok(credential.clone()),
            None => {
                OfflineAuthorizer {
                    username: self.username.clone(),
                }
                .authorize()
                .await
            }
        }
    }
}

impl ElementalService {
    pub fn new(settings: &Settings) -> Result<Self> {
        settings.validate()?;
        let mut settings = settings.clone();
        settings.game_directory = java_compatible_path(&settings.game_directory);
        Ok(Self {
            launcher: Launcher::builder()
                .storage_root(&settings.game_directory)
                .build(),
            settings,
        })
    }

    pub async fn catalog(&self) -> Result<Vec<GameVersion>> {
        let source = VanillaSource::with_client(
            self.settings.network.endpoints()?,
            self.settings.network.build_client()?,
        );
        let releases = self
            .launcher
            .catalog(VanillaCatalog::new(source))
            .await
            .context("无法获取 Mojang 版本目录，请检查网络后重试")?;
        let mut versions: Vec<_> = releases
            .into_values()
            .flatten()
            .map(|release| GameVersion {
                id: release.version_id,
                kind: release.description.unwrap_or_else(|| "unknown".into()),
            })
            .collect();
        versions.sort_by(|left, right| {
            right
                .is_release()
                .cmp(&left.is_release())
                .then_with(|| compare_version_ids(&right.id, &left.id))
        });
        Ok(versions)
    }

    pub async fn inspect(&self) -> Result<Vec<InstalledInstance>> {
        let instances = self
            .launcher
            .inspect_instances()
            .await
            .context("无法扫描本地实例")?;
        Ok(instances
            .into_iter()
            .map(|instance| InstalledInstance {
                instance_key: instance.instance_name,
                loader_version: installed_loader_version(&instance.driver),
                game_version: instance
                    .driver
                    .game_version
                    .map(|version| version.to_string()),
                loader: instance.driver.driver.id.into(),
                root: instance.instance_root,
            })
            .collect())
    }

    pub async fn prepare(&self, profile: &GameProfile) -> Result<PathBuf> {
        Ok(self
            .prepare_with_progress(profile, CancellationToken::new(), |_| {})
            .await?)
    }

    /// Elemental resolves and plans artifacts; our runner owns transfer state
    /// and cancellation, and returns only after its workers release all files.
    pub async fn prepare_with_progress(
        &self,
        profile: &GameProfile,
        cancellation: CancellationToken,
        on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
    ) -> std::result::Result<PathBuf, DownloadError> {
        profile.validate()?;
        let installation_paths = crate::loaders::InstallationPaths::new(
            &self.settings.game_directory,
            &profile.instance_key,
        )?;
        let endpoints = self.settings.network.endpoints()?;
        let source =
            VanillaSource::with_client(endpoints.clone(), self.settings.network.build_client()?);
        let storage = Storage::new(&self.settings.game_directory, BaseRootLayout);
        let instance = storage
            .ensure_instance(profile.instance_key.clone(), BaseInstanceLayout)
            .await?;
        let resolved = match ResolvedVanillaVersion::load(endpoints, instance.clone()) {
            Ok(local) => local,
            Err(_) => {
                let metadata = tokio::select! {
                    biased;
                    () = cancellation.cancelled() => return Err(DownloadError::Cancelled),
                    result = tokio::time::timeout(
                        std::time::Duration::from_secs(self.settings.network.timeout_seconds.into()),
                        resolve_vanilla_metadata(&source, &profile.game_version),
                    ) => result.map_err(|_| anyhow::anyhow!("获取游戏元数据超时"))??,
                };
                persist_vanilla_metadata(metadata, profile, &installation_paths, &instance).await?
            }
        };
        validate_metadata_paths(
            &serde_json::to_value(&resolved.metadata).context("无法验证实例元数据")?,
        )?;
        if resolved.metadata.id != profile.game_version {
            return Err(DownloadError::Failed(
                "实例文件版本与配置不一致，请修复实例配置".into(),
            ));
        }
        let artifacts: Vec<Artifact> = resolved
            .planner()
            .plan()?
            .into_iter()
            .flat_map(|plan| plan.tasks)
            .map(|task| Artifact {
                url: task.url,
                target: task.path,
                expected_size: task.expected_size,
                checksum: task.sha1.map(Checksum::Sha1),
            })
            .collect();
        let canonical_root = self
            .settings
            .game_directory
            .canonicalize()
            .context("无法解析游戏目录")?;
        for artifact in &artifacts {
            validate_artifact_target(
                &self.settings.game_directory,
                &canonical_root,
                &artifact.target,
            )?;
        }
        DownloadEngine::new(self.settings.network.clone())?
            .download(artifacts, cancellation.clone(), on_progress)
            .await?;
        if cancellation.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        // Artifacts have all passed size/hash validation. Elemental now only
        // extracts native libraries and validates the prepared instance.
        installation_paths.validate()?;
        resolved.prepare(self.launcher.downloader()).await?;
        if cancellation.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        Ok(instance.path)
    }

    /// Reopen the installed instance. Launch does not implicitly download files.
    pub async fn launch(&self, profile: &GameProfile, settings: &Settings) -> Result<LoggedChild> {
        self.launch_with_runtime_directory(
            profile,
            settings,
            &crate::model::default_data_directory().join("runtimes"),
        )
        .await
    }

    pub async fn launch_with_runtime_directory(
        &self,
        profile: &GameProfile,
        settings: &Settings,
        managed_runtime_root: &Path,
    ) -> Result<LoggedChild> {
        self.launch_authenticated(profile, settings, managed_runtime_root, None)
            .await
    }

    pub async fn launch_authenticated(
        &self,
        profile: &GameProfile,
        settings: &Settings,
        managed_runtime_root: &Path,
        credential: Option<UserCredential>,
    ) -> Result<LoggedChild> {
        self.prepare_authenticated_launch(profile, settings, managed_runtime_root, credential)
            .await?
            .spawn()
    }

    /// Inspect an installed instance and prepare its command without spawning the game.
    /// Java probes are owned by this future; cancelling it cannot create a game process.
    pub async fn prepare_authenticated_launch(
        &self,
        profile: &GameProfile,
        settings: &Settings,
        managed_runtime_root: &Path,
        credential: Option<UserCredential>,
    ) -> Result<PreparedGameLaunch> {
        profile.validate()?;
        settings.validate()?;
        let instance = self
            .launcher
            .inspect_instance(profile.instance_key.clone())
            .await?
            .context("实例尚未安装，请先安装 / 修复")?;
        ensure!(
            instance.driver.driver.id == profile.loader
                && instance
                    .driver
                    .game_version
                    .as_ref()
                    .map(|version| version.as_str())
                    == Some(profile.game_version.as_str())
                && (profile.loader == "vanilla"
                    || installed_loader_version(&instance.driver).as_deref()
                        == Some(profile.loader_version.as_str())),
            "loaders.errors.identity"
        );
        let required_java = java::required_java_major_version(
            &settings
                .game_directory
                .join("versions")
                .join(&profile.instance_key),
        )?;
        let runtime = java::select_runtime(
            required_java,
            (!settings.java_executable.trim().is_empty())
                .then(|| std::path::Path::new(settings.java_executable.trim())),
            managed_runtime_root,
        )
        .await?;
        let prepared = self
            .launcher
            .load_instance(instance)
            .await
            .context("实例不完整，请安装 / 修复后重试")?;
        let mut options = LaunchOptions {
            launcher_name: Some("Paradox Launcher".into()),
            launcher_version: Some(env!("CARGO_PKG_VERSION").into()),
            resolution: Some(LaunchResolution::new(
                settings.resolution_width.to_string(),
                settings.resolution_height.to_string(),
            )),
            ..LaunchOptions::default()
        };
        options = options
            .try_set_extra_jvm_argument_string(settings.extra_jvm_arguments.clone())
            .context("JVM 参数引号不匹配")?;
        ensure!(
            !options
                .extra_jvm_arguments
                .iter()
                .any(|argument| argument.starts_with("-Xmx") || argument.starts_with("-Xms")),
            "请通过内存设置调整 -Xmx / -Xms"
        );
        options
            .extra_jvm_arguments
            .push(format!("-Xms{}M", settings.minimum_memory_mb));
        options
            .extra_jvm_arguments
            .push(format!("-Xmx{}M", settings.memory_mb));
        options = options
            .try_set_extra_game_argument_string(settings.extra_game_arguments.clone())
            .context("游戏参数引号不匹配")?;
        options.runtime_executable_path = Some(runtime.executable);
        let mut command = self
            .launcher
            .build_launch_command(
                &prepared,
                LaunchIdentity {
                    credential,
                    username: settings.offline_username.clone(),
                },
                &options,
            )
            .await
            .context("无法构建启动命令，请检查 Java 版本和实例文件")?;
        include_extracted_natives(
            &mut command.command,
            &settings
                .game_directory
                .join("versions")
                .join(&profile.instance_key)
                .join("natives"),
        )?;
        include_profile_environment(&mut command.command, settings, profile);
        Ok(PreparedGameLaunch {
            command: command.command,
        })
    }
}

/// Java's classpath/JAR readers do not accept Windows verbatim prefixes.
/// Resolve filesystem boundaries with the original path, then give SDK Java
/// operations the equivalent conventional drive or UNC path.
pub(crate) fn java_compatible_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(drive) = value.strip_prefix(r"\\?\")
            && drive.as_bytes().get(1..3) == Some(b":\\")
            && drive
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
        {
            return PathBuf::from(drive);
        }
    }
    path.to_owned()
}

fn installed_loader_version(driver: &InstalledDriver) -> Option<String> {
    let version = driver.driver_version.as_deref()?;
    if driver.driver.id == "forge" {
        let prefix = format!("{}-", driver.game_version.as_ref()?.as_str());
        Some(version.strip_prefix(&prefix).unwrap_or(version).to_owned())
    } else {
        Some(version.to_owned())
    }
}

fn include_profile_environment(
    command: &mut LaunchCommand,
    settings: &Settings,
    profile: &GameProfile,
) {
    if let Some(id) = &profile.overrides.argument_template
        && let Some(template) = settings
            .argument_templates
            .iter()
            .find(|template| &template.id == id)
    {
        crate::preferences::merge_environment(&mut command.env, &template.environment);
    }
    crate::preferences::merge_environment(&mut command.env, &profile.overrides.environment);
}

fn include_extracted_natives(command: &mut LaunchCommand, natives: &Path) -> Result<()> {
    let natives = java_compatible_path(natives);
    // New Mojang metadata uses natives/java, while this pinned Elemental version
    // extracts the JNI libraries at natives/. Preserve the metadata search path
    // and add the actual extraction directory instead of changing saved metadata.
    if let Some(argument) = command
        .args
        .iter_mut()
        .find(|argument| argument.starts_with("-Djava.library.path="))
    {
        let mut paths: Vec<_> =
            std::env::split_paths(argument.trim_start_matches("-Djava.library.path="))
                .map(|path| java_compatible_path(&path))
                .collect();
        if !paths.iter().any(|path| path == &natives) {
            paths.push(natives);
        }
        let paths = std::env::join_paths(paths).context("原生库搜索路径无效")?;
        *argument = format!(
            "-Djava.library.path={}",
            paths.to_str().context("原生库搜索路径编码无效")?
        );
    }
    Ok(())
}

fn compare_version_ids(left: &str, right: &str) -> Ordering {
    let left_parts: Option<Vec<u32>> = left.split('.').map(|part| part.parse().ok()).collect();
    let right_parts: Option<Vec<u32>> = right.split('.').map(|part| part.parse().ok()).collect();
    match (left_parts, right_parts) {
        (Some(left), Some(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

fn validate_metadata_paths(metadata: &serde_json::Value) -> Result<()> {
    if let Some(id) = metadata
        .pointer("/assetIndex/id")
        .and_then(|value| value.as_str())
    {
        crate::model::validate_instance_key(id).context("资源索引文件名无效")?;
    }
    if let Some(id) = metadata
        .pointer("/logging/client/file/id")
        .and_then(|value| value.as_str())
    {
        crate::model::validate_instance_key(id).context("日志配置文件名无效")?;
    }
    if let Some(libraries) = metadata.get("libraries").and_then(|value| value.as_array()) {
        for library in libraries {
            if let Some(downloads) = library.get("downloads").and_then(|value| value.as_object()) {
                let mut artifacts = Vec::new();
                if let Some(artifact) = downloads.get("artifact") {
                    artifacts.push(artifact);
                }
                if let Some(classifiers) = downloads
                    .get("classifiers")
                    .and_then(|value| value.as_object())
                {
                    artifacts.extend(classifiers.values());
                }
                for artifact in artifacts {
                    if let Some(path) = artifact.get("path").and_then(|value| value.as_str()) {
                        validate_relative_artifact(path)?;
                    }
                }
            }
        }
    }
    Ok(())
}

async fn persist_vanilla_metadata(
    metadata: ResolvedVanillaMetadata,
    profile: &GameProfile,
    paths: &crate::loaders::InstallationPaths,
    instance: &Storage<BaseInstanceLayout, Storage<BaseRootLayout>>,
) -> Result<ResolvedVanillaVersion<BaseRootLayout, BaseInstanceLayout>> {
    validate_metadata_paths(
        &serde_json::to_value(&metadata.metadata).context("无法验证游戏元数据")?,
    )?;
    ensure!(
        metadata.metadata.id == profile.game_version,
        "实例文件版本与配置不一致，请修复实例配置"
    );
    paths.validate()?;
    paths.validate_asset_index(&metadata.metadata.asset_index.id)?;
    metadata.persist(instance).await
}

fn validate_relative_artifact(raw: &str) -> Result<()> {
    ensure!(!raw.is_empty() && !raw.contains('\\'), "库文件路径无效");
    let path = Path::new(raw);
    ensure!(
        path.components()
            .all(|part| matches!(part, Component::Normal(_))),
        "库文件路径不能跳出游戏目录"
    );
    for component in raw.split('/') {
        crate::model::validate_instance_key(component).context("库文件路径包含无效名称")?;
    }
    Ok(())
}

fn validate_artifact_target(root: &Path, canonical_root: &Path, target: &Path) -> Result<()> {
    ensure!(
        target.starts_with(root) && target != root,
        "下载目标不在游戏目录内"
    );
    ensure!(
        target
            .components()
            .all(|part| !matches!(part, Component::ParentDir)),
        "下载目标不能包含父目录跳转"
    );
    crate::loaders::validate_target(root, target)?;
    let mut existing = target;
    while !existing.exists() {
        existing = existing.parent().context("下载目标没有有效父目录")?;
    }
    ensure!(
        existing.canonicalize()?.starts_with(canonical_root),
        "下载目标通过链接跳出了游戏目录"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(java_compatible_path(link))
                .arg(java_compatible_path(target))
                .creation_flags(0x0800_0000)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    fn vanilla_metadata(profile: &GameProfile) -> ResolvedVanillaMetadata {
        ResolvedVanillaMetadata::new(
            Settings::default().network.endpoints().unwrap(),
            serde_json::from_value(serde_json::json!({
                "assetIndex": {"id": "17", "sha1": "0".repeat(40), "size": 0,
                    "totalSize": 0, "url": "https://piston-meta.mojang.com/v1/packages/index.json"},
                "assets": "17", "complianceLevel": 1,
                "downloads": {"client": {"sha1": "0".repeat(40), "size": 0,
                    "url": "https://piston-data.mojang.com/v1/objects/da39a3ee5e6b4b0d3255bfef95601890afd80709/client.jar"}},
                "id": profile.game_version, "javaVersion": {"component": "java-runtime", "majorVersion": 21},
                "libraries": [], "mainClass": "example.Main", "minimumLauncherVersion": 21,
                "type": "release", "time": "2024-01-01T00:00:00Z", "releaseTime": "2024-01-01T00:00:00Z"
            })).unwrap(),
            serde_json::from_value(serde_json::json!({"objects": {}})).unwrap(),
        )
    }

    #[tokio::test]
    async fn metadata_persistence_writes_validated_instance_and_asset_index() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap().join("minecraft");
        let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
        let paths = crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
        let instance = Storage::with_parent(
            paths.instance.clone(),
            Storage::new(&root, BaseRootLayout),
            BaseInstanceLayout,
        );
        persist_vanilla_metadata(vanilla_metadata(&profile), &profile, &paths, &instance)
            .await
            .unwrap();
        let persisted: serde_json::Value = serde_json::from_slice(
            &std::fs::read(
                paths
                    .instance
                    .join(format!("{}.json", profile.instance_key)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(persisted["id"], "1.21.1");
        assert_eq!(
            std::fs::read(root.join("assets/indexes/17.json")).unwrap(),
            br#"{"objects":{}}"#
        );
    }

    #[tokio::test]
    async fn metadata_persistence_rejects_invalid_identity_and_index_before_creating_directories() {
        for invalid_identity in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let root = temporary.path().canonicalize().unwrap().join("minecraft");
            let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
            let paths =
                crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
            let instance = Storage::with_parent(
                paths.instance.clone(),
                Storage::new(&root, BaseRootLayout),
                BaseInstanceLayout,
            );
            let mut metadata = vanilla_metadata(&profile);
            if invalid_identity {
                metadata.metadata.id = "1.20.1".into();
            } else {
                metadata.metadata.asset_index.id = "../outside".into();
            }
            assert!(
                persist_vanilla_metadata(metadata, &profile, &paths, &instance)
                    .await
                    .is_err()
            );
            assert!(!root.exists());
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn vanilla_prepare_accepts_valid_local_files_and_creates_natives_inside_instance() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap().join("minecraft");
        let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
        let paths = crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
        let instance = Storage::with_parent(
            paths.instance.clone(),
            Storage::new(&root, BaseRootLayout),
            BaseInstanceLayout,
        );
        let mut metadata = vanilla_metadata(&profile);
        metadata.metadata.downloads.client.sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709".into();
        persist_vanilla_metadata(metadata, &profile, &paths, &instance)
            .await
            .unwrap();
        std::fs::write(
            paths.instance.join(format!("{}.jar", profile.instance_key)),
            b"",
        )
        .unwrap();
        let mut settings = Settings {
            game_directory: root,
            ..Settings::default()
        };
        settings.network.proxy_url = "http://127.0.0.1:1".into();
        settings.network.timeout_seconds = 1;
        let prepared = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            ElementalService::new(&settings)
                .unwrap()
                .prepare_with_progress(&profile, CancellationToken::new(), |_| {}),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            prepared.canonicalize().unwrap(),
            paths.instance.canonicalize().unwrap()
        );
        assert!(prepared.join("natives").is_dir());
        assert!(prepared.join(".elemental").is_dir());
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn metadata_persistence_rechecks_index_links_before_overwriting_instance_json() {
        let temporary = tempfile::tempdir().unwrap();
        let base = temporary.path().canonicalize().unwrap();
        let root = base.join("minecraft");
        let outside = base.join("outside");
        let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
        let paths = crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
        std::fs::create_dir_all(&paths.instance).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let instance_json = paths
            .instance
            .join(format!("{}.json", profile.instance_key));
        std::fs::write(&instance_json, b"original").unwrap();
        directory_link(&outside, &root.join("assets/indexes"));
        let instance = Storage::with_parent(
            paths.instance.clone(),
            Storage::new(&root, BaseRootLayout),
            BaseInstanceLayout,
        );
        assert!(
            persist_vanilla_metadata(vanilla_metadata(&profile), &profile, &paths, &instance)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(instance_json).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn vanilla_install_rejects_existing_sdk_links_before_creating_instance() {
        for target in [
            "assets/indexes",
            "natives/nested",
            ".elemental/state",
            "metadata",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().canonicalize().unwrap().join("minecraft");
            let outside = temp.path().join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
            let instance = root.join("versions").join(&profile.instance_key);
            let linked = if target == "metadata" {
                instance.join(format!("{}.json", profile.instance_key))
            } else if target.starts_with("assets/") {
                root.join(target)
            } else {
                instance.join(target)
            };
            std::fs::create_dir_all(linked.parent().unwrap()).unwrap();
            directory_link(&outside, &linked);
            let settings = Settings {
                game_directory: root,
                ..Settings::default()
            };
            let cancellation = CancellationToken::new();
            cancellation.cancel();
            let error = ElementalService::new(&settings)
                .unwrap()
                .prepare_with_progress(&profile, cancellation, |_| {})
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("loaders.errors.path"),
                "{target}: {error}"
            );
            assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
            if target.starts_with("assets/") {
                assert!(
                    !instance.exists(),
                    "validation must precede ensure_instance"
                );
            }
        }
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn vanilla_install_rejects_root_links_and_linked_root_ancestors() {
        for suffix in ["", "minecraft", "missing/minecraft"] {
            let temp = tempfile::tempdir().unwrap();
            let outside = temp.path().join("outside");
            let alias = temp.path().canonicalize().unwrap().join("alias");
            std::fs::create_dir_all(&outside).unwrap();
            directory_link(&outside, &alias);
            let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
            let settings = Settings {
                game_directory: alias.join(suffix),
                ..Settings::default()
            };
            let cancellation = CancellationToken::new();
            cancellation.cancel();
            let error = ElementalService::new(&settings)
                .unwrap()
                .prepare_with_progress(&profile, cancellation, |_| {})
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("loaders.errors.path"),
                "{suffix}: {error}"
            );
            assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn artifact_validation_rejects_links_even_when_they_resolve_inside_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("minecraft");
        let destination = root.join("real");
        std::fs::create_dir_all(&destination).unwrap();
        directory_link(&destination, &root.join("libraries"));
        assert!(
            validate_artifact_target(
                &root,
                &root.canonicalize().unwrap(),
                &root.join("libraries/library.jar")
            )
            .is_err()
        );
    }

    #[test]
    fn artifact_validation_accepts_normal_new_and_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("minecraft");
        std::fs::create_dir_all(&root).unwrap();
        let canonical = root.canonicalize().unwrap();
        for relative in ["libraries/group/library.jar", "assets/indexes/1.21.json"] {
            let target = root.join(relative);
            validate_artifact_target(&root, &canonical, &target).unwrap();
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(&target, b"existing").unwrap();
            validate_artifact_target(&root, &canonical, &target).unwrap();
        }
        assert!(validate_artifact_target(&root, &canonical, &root).is_err());
        assert!(validate_artifact_target(&root, &canonical, &root.join("../outside")).is_err());
    }
}
