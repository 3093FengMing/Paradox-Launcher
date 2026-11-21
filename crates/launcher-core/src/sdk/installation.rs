//! Resolve and transfer Vanilla artifacts under application cancellation and path policy.
use super::*;

impl ElementalService {
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
        let storage = Storage::new(&self.settings.game_directory, SharedRootLayout::default());
        let instance = storage
            .ensure_instance(
                profile.instance_key.clone(),
                SharedInstanceLayout::default(),
            )
            .await
            .context("无法创建实例目录")?;
        let resolved = match ResolvedVanillaVersion::load(instance.clone()) {
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
            .planner(&endpoints)
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
}
