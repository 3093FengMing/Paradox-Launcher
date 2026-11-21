//! Bound SDK loader preparation and settle downloads on every failure path.
use super::profile::BoundedProfileFamily;
use super::versions::legacy_forge_game;
use super::{installation_paths::InstallationPaths, versions};
use crate::{GameProfile, Settings};
use anyhow::{Result, bail, ensure};
use elemental::driver::families::version_json::VersionJsonGameStorageExt;
use elemental::{
    core::{runtime::RuntimeResolver, storage::Storage},
    driver::{
        driver::{Driver, PrepareRequest},
        drivers::{
            fabric::{
                driver::FabricDriverFamily,
                source::{FabricEndpoints, FabricFlavor, FabricSource},
            },
            forge, neoforge,
            quilt::{
                driver::QuiltDriverFamily,
                source::{QuiltEndpoints, QuiltSource},
            },
            vanilla::source::VanillaSource,
        },
        families::{
            installer::{InstallerFamilyDriver, InstallerMavenSource},
            version_json::{ProfiledVersionJsonDriver, SharedInstanceLayout, SharedRootLayout},
        },
    },
    infra::downloader::{
        DownloadSession, ElementalDownloader, ElementalDownloaderConfig, FailurePolicy, RetryPolicy,
    },
};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

/// Called in an isolated installation worker so cancellation stops SDK downloads and Java processors together.
pub async fn prepare(
    profile: &GameProfile,
    settings: &Settings,
    managed_root: &Path,
) -> Result<PathBuf> {
    profile.validate()?;
    settings.validate()?;
    ensure!(
        profile.loader != "forge" || !legacy_forge_game(&profile.game_version),
        "loaders.errors.compatibility"
    );
    let mut normalized_settings = settings.clone();
    normalized_settings.game_directory = crate::sdk::java_compatible_path(&settings.game_directory);
    let configured_java = settings.java_executable.trim();
    normalized_settings.java_executable = if configured_java.is_empty() {
        String::new()
    } else {
        crate::sdk::java_compatible_path(Path::new(configured_java))
            .to_string_lossy()
            .into_owned()
    };
    let settings = &normalized_settings;
    let managed_root = crate::sdk::java_compatible_path(managed_root);
    let instance_path = validate_installation_paths(profile, settings)?;
    ensure!(
        versions(settings, &profile.loader, &profile.game_version)
            .await?
            .iter()
            .any(|v| v.version == profile.loader_version),
        "loaders.errors.compatibility"
    );
    validate_installation_paths(profile, settings)?;
    std::fs::create_dir_all(&settings.game_directory)?;
    let storage = Storage::new(&settings.game_directory, SharedRootLayout::default());
    let instance = storage
        .ensure_instance(
            profile.instance_key.clone(),
            SharedInstanceLayout::default(),
        )
        .await?;
    let client = settings.network.build_client()?;
    let downloader = ElementalDownloader::builder()
        .client(client.clone())
        .config(ElementalDownloaderConfig {
            max_concurrent_downloads: settings.network.max_concurrent_downloads as usize,
            default_session_parallelism: settings.network.max_concurrent_downloads as usize,
            connect_timeout: Duration::from_secs(settings.network.timeout_seconds.into()),
            read_timeout: Duration::from_secs(settings.network.timeout_seconds.into()),
            ..Default::default()
        })
        .build()?;
    let session = downloader
        .session(format!("{}:{}", profile.loader, profile.instance_key))
        .retry(RetryPolicy {
            max_attempts: settings.network.max_retries as usize + 1,
            ..Default::default()
        })
        .failure_policy(FailurePolicy::CancelAll)
        .open()
        .await?;
    let vanilla_endpoints = settings.network.endpoints()?;
    let vanilla = VanillaSource::with_client(vanilla_endpoints.clone(), client.clone());
    let game = profile.game_version.clone().into();
    let loader = profile.loader_version.clone().into();
    let timeout = Duration::from_secs(settings.network.timeout_seconds.into());
    let runtime_options = elemental::launcher::RuntimeOptions::new();
    // Profile-only drivers ignore the runtime resolver; installer drivers use
    // the explicitly selected distribution below, without discovery fallback.
    let runtime_resolver = RuntimeResolver::new(Vec::new());
    let request = PrepareRequest {
        session: &session,
        instance: &instance,
        game_version: &game,
        loader_version: Some(&loader),
        runtime_options: &runtime_options,
        runtime_resolver: &runtime_resolver,
        on_stage: None,
    };
    let preparation = async {
        match profile.loader.as_str() {
            "fabric" => {
                ProfiledVersionJsonDriver::new(
                    BoundedProfileFamily::new(
                        FabricDriverFamily::new(FabricFlavor::Fabric),
                        client.clone(),
                        timeout,
                    ),
                    FabricSource::with_client(FabricEndpoints::official(), client),
                )
                .with_vanilla_source(vanilla)
                .prepare(&request)
                .await?;
            }
            "quilt" => {
                ProfiledVersionJsonDriver::new(
                    BoundedProfileFamily::new(QuiltDriverFamily, client.clone(), timeout),
                    QuiltSource::with_client(QuiltEndpoints::official(), client),
                )
                .with_vanilla_source(vanilla)
                .prepare(&request)
                .await?;
            }
            "forge" | "neoforge" => {
                let base = tokio::time::timeout(
                    timeout,
                    crate::sdk::resolve_bounded_vanilla_metadata(
                        &vanilla_endpoints,
                        &client,
                        &profile.game_version,
                        timeout,
                    ),
                )
                .await
                .map_err(|_| anyhow::anyhow!("loaders.errors.network"))??;
                let required = u32::try_from(base.metadata.java_version.major_version)
                    .map_err(|_| anyhow::anyhow!("loaders.errors.compatibility"))?;
                let runtime = crate::java::select_runtime(
                    required,
                    (!settings.java_executable.is_empty())
                        .then(|| Path::new(&settings.java_executable)),
                    &managed_root,
                )
                .await?;
                let runtime_options =
                    crate::runtime::elemental_runtime_options(&runtime, required).await?;
                let request = PrepareRequest {
                    runtime_options: &runtime_options,
                    ..request
                };
                if profile.loader == "forge" {
                    InstallerFamilyDriver::new(InstallerMavenSource::with_client(
                        forge::endpoints(),
                        client,
                    ))
                    .with_vanilla_source(vanilla)
                    .prepare(&request)
                    .await?;
                } else {
                    InstallerFamilyDriver::new(InstallerMavenSource::with_client(
                        neoforge::endpoints(),
                        client,
                    ))
                    .with_vanilla_source(vanilla)
                    .prepare(&request)
                    .await?;
                }
            }
            _ => bail!("loaders.errors.unsupported"),
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    if let Err(error) = preparation {
        return Err(cancel_preparation_with_error(session, error).await);
    }
    session.finish().await?.success()?;
    ensure!(instance.path == instance_path, "loaders.errors.path");
    Ok(instance.path)
}

pub(super) async fn cancel_preparation_with_error(
    session: DownloadSession,
    error: anyhow::Error,
) -> anyhow::Error {
    // A failed transfer can surface later as a rejected submission or missing
    // installer archive. Keep its recorded cause after all workers have stopped.
    if let Ok(report) = session.cancel().await
        && report.failures().next().is_some()
        && let Err(download_error) = report.success()
    {
        return download_error.into();
    }
    error
}

pub(super) fn validate_installation_paths(
    profile: &GameProfile,
    settings: &Settings,
) -> Result<PathBuf> {
    Ok(InstallationPaths::new(&settings.game_directory, &profile.instance_key)?.instance)
}
