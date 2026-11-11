use std::{
    cmp::Ordering,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use elemental::{
    core::{
        auth::{
            accounts::{Account, offline::OfflineAccount},
            credential::Credential,
        },
        launcher::command::LaunchCommand,
        storage::Storage,
    },
    driver::{
        driver::InstalledDriver,
        drivers::vanilla::{
            prepared::{ResolvedVanillaMetadata, ResolvedVanillaVersion},
            source::VanillaEndpoints,
        },
        families::version_json::{
            layout::{BaseInstanceLayout, BaseRootLayout},
            parse_argument_string,
            storage::VersionJsonGameStorageExt,
        },
    },
    launcher::{LaunchOptions, LaunchResolution, Launcher},
    schema::mojang::{
        launcher::LaunchMetaData,
        piston::{PistonMetaAssetIndexObjects, PistonMetaData},
    },
};
use tokio_util::sync::CancellationToken;

pub use crate::process::{LoggedChild, ProcessLogLine, ProcessLogSource};

use crate::{
    GameProfile, GameVersion, InstalledInstance, Settings,
    download::{Artifact, Checksum, DownloadEngine, DownloadError, DownloadProgress},
    java,
};

/// Application launch policy over Elemental's public prepared-instance API.
pub struct ElementalService {
    launcher: Launcher,
    settings: Settings,
}

/// A validated launch command whose game process has not been created yet.
/// The command can contain credentials, so it deliberately does not expose Debug.
pub struct PreparedGameLaunch {
    command: LaunchCommand,
    executable: PathBuf,
}

impl PreparedGameLaunch {
    /// Create the game process after the caller has resolved its cancellation boundary.
    pub fn spawn(self) -> Result<LoggedChild> {
        crate::process::spawn_command_logged(self.command, &self.executable)
            .context("无法启动 Java 进程")
    }
}

struct LaunchIdentity {
    credential: Option<Credential>,
    username: String,
}
impl LaunchIdentity {
    async fn authorize(&self) -> elemental::core::auth::error::Result<Credential> {
        match &self.credential {
            Some(credential) => Ok(credential.clone()),
            None => {
                OfflineAccount::new(self.username.clone())
                    .credential()
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
        let endpoints = self.settings.network.endpoints()?;
        let client = self.settings.network.build_client()?;
        let timeout = std::time::Duration::from_secs(self.settings.network.timeout_seconds.into());
        let manifest: LaunchMetaData =
            fetch_vanilla_json(&client, &endpoints.version_manifest_url()?, timeout)
                .await
                .context("无法获取 Mojang 版本目录，请检查网络后重试")?;
        let mut versions: Vec<_> = manifest
            .versions
            .into_iter()
            .map(|release| GameVersion {
                id: release.id,
                kind: release.release_type,
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
        let client = self.settings.network.build_client()?;
        let storage = Storage::new(&self.settings.game_directory, BaseRootLayout);
        let instance = storage
            .ensure_instance(profile.instance_key.clone(), BaseInstanceLayout)
            .await
            .context("无法创建实例目录")?;
        let resolved = match ResolvedVanillaVersion::load(endpoints.clone(), instance.clone()) {
            Ok(local) => local,
            Err(_) => {
                let metadata = tokio::select! {
                    biased;
                    () = cancellation.cancelled() => return Err(DownloadError::Cancelled),
                    result = tokio::time::timeout(
                        std::time::Duration::from_secs(self.settings.network.timeout_seconds.into()),
                        resolve_bounded_vanilla_metadata(&endpoints, &client, &profile.game_version,
                            std::time::Duration::from_secs(self.settings.network.timeout_seconds.into())),
                    ) => result
                        .map_err(|_| anyhow::anyhow!("获取游戏元数据超时"))?
                        .context("无法获取游戏元数据")?,
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
            .download_batches()
            .context("无法生成游戏下载计划")?
            .into_iter()
            .flat_map(|batch| batch.into_tasks())
            .map(|task| Artifact {
                url: task.url().to_owned(),
                target: task.path().to_owned(),
                expected_size: task.expected_size(),
                checksum: task
                    .sha1_checksum()
                    .map(|sha1| Checksum::Sha1(sha1.to_owned())),
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
        resolved
            .finish_preparation()
            .await
            .context("无法完成实例准备")?;
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
        credential: Option<Credential>,
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
        credential: Option<Credential>,
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
        options = options.set_extra_jvm_arguments(
            parse_argument_string(&settings.extra_jvm_arguments).context("JVM 参数引号不匹配")?,
        );
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
        options = options.set_extra_game_arguments(
            parse_argument_string(&settings.extra_game_arguments).context("游戏参数引号不匹配")?,
        );
        let runtime_options =
            crate::runtime::elemental_runtime_options(&runtime, required_java).await?;
        let credential = LaunchIdentity {
            credential,
            username: settings.offline_username.clone(),
        }
        .authorize()
        .await
        .context("无法获取启动身份凭据")?;
        let mut command = self
            .launcher
            .build_launch_command(&prepared, &credential, &runtime_options, &options)
            .await
            .context("无法构建启动命令，请检查 Java 版本和实例文件")?;
        let prepared_info = prepared.info().context("无法读取实例原生库布局")?;
        include_extracted_natives(
            &mut command,
            &prepared_info.natives_directory,
            &prepared_info.natives_files,
        )?;
        include_profile_environment(&mut command, settings, profile);
        Ok(PreparedGameLaunch {
            command,
            executable: runtime.executable,
        })
    }
}

// Upstream catalogs use their default metadata client. Keep application proxy,
// mirror, decoded response bounds and a total deadline at this fetch boundary,
// then hand the public SDK schema to its normal prepared-instance planner.
async fn fetch_vanilla_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    timeout: std::time::Duration,
) -> Result<T> {
    let bytes = crate::loaders::fetch_metadata_resource(client, url, timeout)
        .await
        .context("原版元数据请求失败或超过网络限制")?;
    serde_json::from_slice(&bytes).context("原版元数据格式无效")
}

pub(crate) async fn resolve_bounded_vanilla_metadata(
    endpoints: &VanillaEndpoints,
    client: &reqwest::Client,
    game_version: &str,
    timeout: std::time::Duration,
) -> Result<ResolvedVanillaMetadata> {
    tokio::time::timeout(timeout, async {
        let manifest: LaunchMetaData =
            fetch_vanilla_json(client, &endpoints.version_manifest_url()?, timeout).await?;
        let version = manifest
            .versions
            .iter()
            .find(|version| version.id == game_version)
            .context("Mojang 目录中没有所选游戏版本")?;
        let metadata: PistonMetaData =
            fetch_vanilla_json(client, &endpoints.rewrite_upstream(&version.url)?, timeout).await?;
        validate_metadata_paths(&serde_json::to_value(&metadata)?)?;
        let assets: PistonMetaAssetIndexObjects = fetch_vanilla_json(
            client,
            &endpoints.rewrite_upstream(&metadata.asset_index.url)?,
            timeout,
        )
        .await?;
        Ok(ResolvedVanillaMetadata::new(
            endpoints.clone(),
            metadata,
            assets,
        ))
    })
    .await
    .context("获取游戏元数据超时")?
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

fn include_extracted_natives(
    command: &mut LaunchCommand,
    natives: &Path,
    native_files: &[PathBuf],
) -> Result<()> {
    let natives = java_compatible_path(natives);
    // Metadata can select a nested directory while another JNI library lives at
    // the extraction root. Use the prepared instance's public layout and files
    // so both upstream compatibility copies and original nested entries work.
    if let Some(argument) = command
        .jvm_arguments
        .iter_mut()
        .rev()
        .find(|argument| argument.starts_with("-Djava.library.path="))
    {
        let mut paths: Vec<_> =
            std::env::split_paths(argument.trim_start_matches("-Djava.library.path="))
                .map(|path| java_compatible_path(&path))
                .collect();
        let mut extracted_roots = vec![natives.clone()];
        for file in native_files {
            let file = java_compatible_path(file);
            if file.starts_with(&natives)
                && let Some(parent) = file.parent()
            {
                extracted_roots.push(parent.to_owned());
            }
        }
        extracted_roots.sort();
        extracted_roots.dedup();
        for root in extracted_roots {
            if !paths.contains(&root) {
                paths.push(root);
            }
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
    Ok(metadata.persist(instance).await?)
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

    #[tokio::test]
    async fn launch_identity_preserves_supplied_online_credentials() {
        let credential = Credential {
            username: "OnlinePlayer".into(),
            uuid: "12345678-1234-1234-1234-123456789abc".into(),
            access_token: "fixture-access-token".into(),
            kind: elemental::core::auth::credential::CredentialKind::Msa,
            xuid: Some("fixture-xuid".into()),
            client_id: Some("fixture-client-id".into()),
        };
        let authorized = LaunchIdentity {
            credential: Some(credential.clone()),
            username: "OfflinePlayer".into(),
        }
        .authorize()
        .await
        .unwrap();
        assert_eq!(authorized, credential);
    }

    #[tokio::test]
    async fn launch_identity_uses_the_minecraft_offline_uuid_and_empty_token() {
        let authorized = LaunchIdentity {
            credential: None,
            username: "Player".into(),
        }
        .authorize()
        .await
        .unwrap();
        assert_eq!(authorized.username, "Player");
        assert_eq!(authorized.uuid, "a01e3843-e521-3998-958a-f459800e4d11");
        assert!(authorized.access_token.is_empty());
    }

    async fn launch_command(
        jvm_arguments: Vec<String>,
        game_arguments: Vec<String>,
    ) -> LaunchCommand {
        let temporary = tempfile::tempdir().unwrap();
        let home = temporary.path().join("fixture-java");
        std::fs::create_dir_all(home.join("bin")).unwrap();
        std::fs::write(
            home.join("bin")
                .join(format!("java{}", std::env::consts::EXE_SUFFIX)),
            b"fixture",
        )
        .unwrap();
        std::fs::write(home.join("release"), b"JAVA_VERSION=\"21.0.1\"\n").unwrap();
        let provider =
            elemental::core::runtime::providers::custom::CustomProvider::new(vec![home]).unwrap();
        let distribution =
            elemental::core::runtime::RuntimeResolver::new(vec![std::sync::Arc::new(provider)])
                .resolve(21)
                .await
                .unwrap();
        LaunchCommand::new(
            distribution,
            jvm_arguments,
            "example.Main".into(),
            game_arguments,
        )
    }

    #[tokio::test]
    async fn extracted_natives_preserve_jvm_argument_order_and_game_arguments() {
        let metadata_natives = PathBuf::from("metadata-natives");
        let extracted_natives = PathBuf::from("extracted-natives");
        let metadata_path = std::env::join_paths([&metadata_natives]).unwrap();
        let mut command = launch_command(
            vec![
                format!("-Djava.library.path={}", metadata_path.to_str().unwrap()),
                "-Xmx1024M".into(),
            ],
            vec![
                "-Djava.library.path=game-option".into(),
                "--username".into(),
                "Player".into(),
            ],
        )
        .await
        .with_cwd(PathBuf::from("fixture-instance"))
        .with_env("SDK_ENV".into(), "retained".into());
        let program = command.program();
        include_extracted_natives(&mut command, &extracted_natives, &[]).unwrap();
        include_extracted_natives(&mut command, &extracted_natives, &[]).unwrap();
        let expected_path = std::env::join_paths([&metadata_natives, &extracted_natives]).unwrap();
        assert_eq!(
            command.arguments(),
            vec![
                format!("-Djava.library.path={}", expected_path.to_str().unwrap()),
                "-Xmx1024M".into(),
                "example.Main".into(),
                "-Djava.library.path=game-option".into(),
                "--username".into(),
                "Player".into(),
            ]
        );
        assert_eq!(command.program(), program);
        assert_eq!(command.cwd, Some(PathBuf::from("fixture-instance")));
        assert_eq!(
            command.env.get("SDK_ENV").map(String::as_str),
            Some("retained")
        );
    }

    #[tokio::test]
    async fn extracted_natives_do_not_reinterpret_game_arguments_as_jvm_arguments() {
        let mut command = launch_command(
            vec!["-Xmx1024M".into()],
            vec!["-Djava.library.path=game-option".into()],
        )
        .await;
        include_extracted_natives(&mut command, Path::new("extracted-natives"), &[]).unwrap();
        assert_eq!(
            command.arguments(),
            vec![
                "-Xmx1024M".to_owned(),
                "example.Main".to_owned(),
                "-Djava.library.path=game-option".to_owned(),
            ]
        );
    }

    #[tokio::test]
    async fn natives_search_path_uses_actual_root_and_nested_files_in_last_jvm_property() {
        let temporary = tempfile::tempdir().unwrap();
        let natives = temporary.path().join("upstream natives");
        let java = natives.join("java");
        let nested = natives.join("platform/vendor");
        std::fs::create_dir_all(&java).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        let files = vec![
            natives.join("jtracy.dll"),
            java.join("lwjgl.dll"),
            nested.join("audio.dll"),
        ];
        for file in &files {
            std::fs::write(file, b"native fixture").unwrap();
        }
        let initial = std::env::join_paths([&java]).unwrap();
        let mut command = launch_command(
            vec![
                "-Djava.library.path=earlier-option".into(),
                format!("-Djava.library.path={}", initial.to_string_lossy()),
                "-Xmx2048M".into(),
            ],
            vec!["--version".into(), "26.3".into()],
        )
        .await;
        include_extracted_natives(&mut command, &natives, &files).unwrap();
        include_extracted_natives(&mut command, &natives, &files).unwrap();
        let roots: Vec<_> = std::env::split_paths(
            command.jvm_arguments[1].trim_start_matches("-Djava.library.path="),
        )
        .collect();
        assert_eq!(roots[0], java);
        for file in files {
            assert!(roots.contains(&file.parent().unwrap().to_owned()));
        }
        assert_eq!(roots.len(), 3);
        assert_eq!(
            command.jvm_arguments[0],
            "-Djava.library.path=earlier-option"
        );
        assert_eq!(command.jvm_arguments[2], "-Xmx2048M");
        assert_eq!(command.game_arguments, ["--version", "26.3"]);
    }

    #[tokio::test]
    async fn vanilla_catalog_only_reads_the_manifest_and_preserves_release_kinds() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };

        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap().join("minecraft");
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let releases = [
            ("1.21.2", "release"),
            ("26w45a", "snapshot"),
            ("b1.7.3", "old_beta"),
            ("1.21.10", "release"),
        ]
        .into_iter()
        .map(|(id, kind)| {
            serde_json::json!({
                "id": id,
                "type": kind,
                "url": format!("https://piston-meta.mojang.com/unavailable/{id}.json"),
                "time": "2026-11-07T00:00:00Z",
                "releaseTime": "2026-11-07T00:00:00Z",
                "sha1": "0".repeat(40),
                "complianceLevel": 1,
            })
        })
        .collect::<Vec<_>>();
        let manifest = serde_json::json!({
            "latest": {"release": "1.21.10", "snapshot": "26w45a"},
            "versions": releases,
        })
        .to_string();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = connection.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                assert!(request.len() <= 16 * 1024);
            }
            let request = String::from_utf8(request).unwrap();
            let target = request.split_ascii_whitespace().nth(1).unwrap().to_owned();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{manifest}",
                manifest.len(),
            );
            connection.write_all(response.as_bytes()).await.unwrap();
            // Close the listener after the manifest. Any per-version metadata
            // request would fail, so successful catalog loading proves it is lazy.
            drop(listener);
            target
        });
        let mut settings = Settings {
            game_directory: root.clone(),
            ..Settings::default()
        };
        settings.network.mirror_url = format!("{origin}/mirror");
        settings.network.proxy_url = origin.clone();
        settings.network.timeout_seconds = 1;
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            ElementalService::new(&settings).unwrap().catalog(),
        )
        .await
        .unwrap();
        let target = server.await.unwrap();
        let manifest_path = "/mirror/mc/game/version_manifest_v2.json";
        assert!(target == manifest_path || target == format!("{origin}{manifest_path}"));
        let versions = result.unwrap();
        assert_eq!(versions.len(), 4);
        assert_eq!(versions[0].id, "1.21.10");
        assert_eq!(versions[1].id, "1.21.2");
        for (id, kind) in [
            ("1.21.2", "release"),
            ("26w45a", "snapshot"),
            ("b1.7.3", "old_beta"),
            ("1.21.10", "release"),
        ] {
            assert_eq!(
                versions
                    .iter()
                    .find(|version| version.id == id)
                    .unwrap()
                    .kind,
                kind
            );
        }
        assert!(!root.exists());
    }

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
        use elemental::core::storage::layout::Layoutable;
        use sha1::{Digest, Sha1};
        use std::io::Write;

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
        let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for name in ["jtracy.dll", "java/lwjgl.dll", "platform/vendor/audio.dll"] {
            archive
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            archive.write_all(name.as_bytes()).unwrap();
        }
        let archive = archive.finish().unwrap().into_inner();
        let platform = elemental::driver::families::version_json::VersionJsonPlatform::current();
        let artifact_path = format!(
            "org/example/native/1/native-1-natives-{}.jar",
            platform.native_os_names()[0]
        );
        let library = root.join("libraries").join(&artifact_path);
        std::fs::create_dir_all(library.parent().unwrap()).unwrap();
        std::fs::write(&library, &archive).unwrap();
        metadata.metadata.libraries = serde_json::from_value(serde_json::json!([{
            "name": format!("org.example:native:1:natives-{}", platform.native_os_names()[0]),
            "downloads": {"artifact": {"path": artifact_path,
                "sha1": hex::encode(Sha1::digest(&archive)), "size": archive.len(),
                "url": format!("https://libraries.minecraft.net/{artifact_path}")}}
        }]))
        .unwrap();
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
        let service = ElementalService::new(&settings).unwrap();
        let prepared = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            service.prepare_with_progress(&profile, CancellationToken::new(), |_| {}),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            prepared.canonicalize().unwrap(),
            paths.instance.canonicalize().unwrap()
        );
        let natives = java_compatible_path(
            &instance
                .try_get_resource(
                    elemental::driver::families::version_json::VersionJsonInstanceResource::Natives,
                )
                .unwrap(),
        );
        assert!(natives.is_dir());
        assert!(natives.starts_with(&prepared));
        for name in ["jtracy.dll", "java/lwjgl.dll", "platform/vendor/audio.dll"] {
            assert_eq!(std::fs::read(natives.join(name)).unwrap(), name.as_bytes());
        }
        let inspected = service
            .launcher
            .inspect_instance(profile.instance_key.clone())
            .await
            .unwrap()
            .unwrap();
        let loaded = service.launcher.load_instance(inspected).await.unwrap();
        let info = loaded.info().unwrap();
        assert_eq!(info.natives_directory, natives);
        let mut command = launch_command(
            vec![format!(
                "-Djava.library.path={}",
                natives.join("java").display()
            )],
            vec![],
        )
        .await;
        include_extracted_natives(&mut command, &info.natives_directory, &info.natives_files)
            .unwrap();
        let roots: Vec<_> = std::env::split_paths(
            command.jvm_arguments[0].trim_start_matches("-Djava.library.path="),
        )
        .collect();
        assert!(roots.contains(&natives));
        assert!(roots.contains(&natives.join("java")));
        assert!(roots.contains(&natives.join("platform/vendor")));
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
        let platform_natives =
            elemental::driver::families::version_json::VersionJsonPlatform::current()
                .natives_dir_name();
        for target in [
            "assets/indexes".to_owned(),
            "natives/nested".to_owned(),
            ".elemental/state".to_owned(),
            "metadata".to_owned(),
            format!("{platform_natives}/nested"),
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
                root.join(&target)
            } else {
                instance.join(&target)
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
