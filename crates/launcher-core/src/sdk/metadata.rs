//! Bounded metadata transport and checked persistence before SDK preparation.
use super::*;

// Upstream catalogs use their default metadata client. Keep application proxy,
// mirror, decoded response bounds and a total deadline at this fetch boundary,
// then hand the public SDK schema to its normal prepared-instance planner.
pub(super) async fn fetch_vanilla_json<T: serde::de::DeserializeOwned>(
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
        Ok(ResolvedVanillaMetadata::new(metadata, assets))
    })
    .await
    .context("获取游戏元数据超时")?
}

pub(super) fn validate_metadata_paths(metadata: &serde_json::Value) -> Result<()> {
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

pub(super) async fn persist_vanilla_metadata(
    metadata: ResolvedVanillaMetadata,
    profile: &GameProfile,
    paths: &crate::loaders::InstallationPaths,
    instance: &Storage<SharedInstanceLayout, Storage<SharedRootLayout>>,
) -> Result<ResolvedVanillaVersion> {
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

pub(super) fn validate_relative_artifact(raw: &str) -> Result<()> {
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

pub(super) fn validate_artifact_target(
    root: &Path,
    canonical_root: &Path,
    target: &Path,
) -> Result<()> {
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
