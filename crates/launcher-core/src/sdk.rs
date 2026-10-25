use std::{
    cmp::Ordering,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use elemental::{
    core::{
        auth::authorizers::offline::OfflineAuthorizer,
        launcher::command::LaunchCommand,
        launcher::process::{self, LoggedChild},
        storage::Storage,
    },
    driver::{
        drivers::vanilla::{
            catalog::VanillaCatalog,
            prepared::ResolvedVanillaVersion,
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

impl ElementalService {
    pub fn new(settings: &Settings) -> Result<Self> {
        settings.validate()?;
        Ok(Self {
            launcher: Launcher::builder()
                .storage_root(&settings.game_directory)
                .build(),
            settings: settings.clone(),
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
                validate_metadata_paths(
                    &serde_json::to_value(&metadata.metadata).context("无法验证游戏元数据")?,
                )?;
                metadata.persist(&instance).await?
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
        profile.validate()?;
        settings.validate()?;
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
        let instance = self
            .launcher
            .inspect_instance(profile.instance_key.clone())
            .await?
            .context("实例尚未安装，请先安装 / 修复")?;
        ensure!(
            instance.driver.driver.id == "vanilla",
            "此阶段只支持原版启动"
        );
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
                OfflineAuthorizer {
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
        process::spawn_command_logged(command.command).context("无法启动 Java 进程")
    }
}

fn include_extracted_natives(command: &mut LaunchCommand, natives: &Path) -> Result<()> {
    // New Mojang metadata uses natives/java, while this pinned Elemental version
    // extracts the JNI libraries at natives/. Preserve the metadata search path
    // and add the actual extraction directory instead of changing saved metadata.
    if let Some(argument) = command
        .args
        .iter_mut()
        .find(|argument| argument.starts_with("-Djava.library.path="))
    {
        let mut paths: Vec<_> =
            std::env::split_paths(argument.trim_start_matches("-Djava.library.path=")).collect();
        if !paths.iter().any(|path| path == natives) {
            paths.push(natives.to_owned());
            let paths = std::env::join_paths(paths).context("原生库搜索路径无效")?;
            *argument = format!(
                "-Djava.library.path={}",
                paths.to_str().context("原生库搜索路径编码无效")?
            );
        }
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

    #[test]
    fn release_versions_sort_numerically() {
        assert_eq!(compare_version_ids("1.10", "1.9"), Ordering::Greater);
        assert_eq!(compare_version_ids("1.21.10", "1.21.2"), Ordering::Greater);
        assert_eq!(compare_version_ids("1.21.1", "1.21"), Ordering::Greater);
    }

    #[test]
    fn metadata_cannot_escape_the_game_root() {
        for path in [
            "../outside.jar",
            "/absolute.jar",
            "C:/outside.jar",
            "org/../bad.jar",
            "org\\bad.jar",
            "org/CON.jar",
        ] {
            assert!(validate_relative_artifact(path).is_err(), "{path}");
        }
        assert!(validate_relative_artifact("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar").is_ok());
        assert!(
            validate_metadata_paths(&serde_json::json!({"assetIndex":{"id":"../bad"}})).is_err()
        );
        assert!(
            validate_metadata_paths(
                &serde_json::json!({"logging":{"client":{"file":{"id":"bad/path.xml"}}}})
            )
            .is_err()
        );
    }

    #[test]
    fn modern_native_search_keeps_metadata_and_sdk_extraction_directories() {
        let directory = tempfile::tempdir().unwrap();
        let natives = directory.path().join("含空格 natives");
        let requested = natives.join("java");
        let mut command = LaunchCommand {
            program: "java".into(),
            args: vec![format!("-Djava.library.path={}", requested.display())],
            env: Default::default(),
            cwd: None,
        };
        include_extracted_natives(&mut command, &natives).unwrap();
        let paths: Vec<_> =
            std::env::split_paths(command.args[0].trim_start_matches("-Djava.library.path="))
                .collect();
        assert_eq!(paths, vec![requested, natives.clone()]);
        include_extracted_natives(&mut command, &natives).unwrap();
        assert_eq!(
            std::env::split_paths(command.args[0].trim_start_matches("-Djava.library.path="))
                .count(),
            2
        );
    }
}
