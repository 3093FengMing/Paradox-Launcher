//! Execute each queue request with its cancellation and installation ownership.

use super::DownloadRequest;
use anyhow::{Result, anyhow};
use paradox_core::{ElementalService, download::DownloadProgress, java};
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

pub(super) async fn run_request(
    request: DownloadRequest,
    cancellation: CancellationToken,
    on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<String> {
    match request {
        DownloadRequest::Content {
            settings,
            profile,
            project,
            category,
        } => {
            paradox_core::content::install(
                &settings,
                &profile,
                &project,
                &category,
                cancellation,
                on_progress,
            )
            .await?;
            Ok("内容安装完成".into())
        }
        DownloadRequest::Pack {
            settings,
            source,
            remote,
            store,
            config,
            registered,
            managed_root,
        } => {
            let archive = tempfile::NamedTempFile::new()?;
            let archive_path = if remote {
                let file = paradox_core::content::latest_pack(&settings, &source).await?;
                paradox_core::download::DownloadEngine::new(settings.network.clone())?
                    .download(
                        vec![paradox_core::download::Artifact {
                            url: file.url,
                            target: archive.path().to_owned(),
                            expected_size: Some(file.size),
                            checksum: Some(paradox_core::download::Checksum::Sha1(
                                file.hashes["sha1"].clone(),
                            )),
                        }],
                        cancellation.clone(),
                        |_| {},
                    )
                    .await?;
                archive.path().to_owned()
            } else {
                PathBuf::from(&source)
            };
            if cancellation.is_cancelled() {
                return Err(paradox_core::download::DownloadError::Cancelled.into());
            }
            let index = paradox_core::packs::inspect(&archive_path)?;
            let profile = {
                let mut registered = registered.lock().map_err(|_| anyhow!("配置锁不可用"))?;
                if let Some(profile) = &*registered {
                    profile.clone()
                } else {
                    let profile = paradox_core::packs::profile(&index)?;
                    let mut current = config.lock().map_err(|_| anyhow!("配置锁不可用"))?;
                    let mut updated = current.clone();
                    updated.active_profile = Some(profile.instance_key.clone());
                    updated.profiles.push(profile.clone());
                    store.save(&updated)?;
                    *current = updated;
                    *registered = Some(profile.clone());
                    profile
                }
            };
            paradox_core::packs::install(
                &settings,
                &profile,
                &archive_path,
                cancellation.clone(),
                on_progress,
            )
            .await?;
            if profile.loader == "vanilla" {
                paradox_core::ElementalService::new(&settings)?
                    .prepare_with_progress(&profile, cancellation, |_| {})
                    .await?;
            } else {
                crate::loader_worker::install(profile, settings, managed_root, cancellation)
                    .await?;
            }
            Ok("整合包安装完成".into())
        }
        DownloadRequest::Install {
            config,
            profile,
            managed_root,
        } => {
            let settings = profile.effective_settings(&config.settings)?;
            if profile.loader != "vanilla" {
                crate::loader_worker::install(profile, settings, managed_root, cancellation)
                    .await?;
            } else {
                ElementalService::new(&settings)?
                    .prepare_with_progress(&profile, cancellation, on_progress)
                    .await?;
            }
            Ok("实例安装 / 修复完成".into())
        }
        DownloadRequest::Java {
            settings,
            major,
            managed_root,
        } => {
            let package = tokio::select! {
                biased;
                () = cancellation.cancelled() => return Err(paradox_core::download::DownloadError::Cancelled.into()),
                package = java::resolve_package(major, &settings.network) => package?,
            };
            let installation = java::download_and_install(
                &package,
                &managed_root,
                settings.network,
                cancellation,
                on_progress,
            )
            .await?;
            Ok(format!(
                "Java {} 已安装：{}",
                installation.major_version,
                installation.executable.display()
            ))
        }
    }
}
