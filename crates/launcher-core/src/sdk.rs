//! Application policy and public facade over the tracked Minecraft SDK.

mod command;
mod installation;
mod launch;
mod metadata;
mod paths;

use command::{include_extracted_natives, include_profile_environment};
pub(crate) use metadata::resolve_bounded_vanilla_metadata;
use metadata::{
    fetch_vanilla_json, persist_vanilla_metadata, validate_artifact_target, validate_metadata_paths,
};
pub(crate) use paths::java_compatible_path;

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
            ResolvedVanillaMetadata, ResolvedVanillaVersion, source::VanillaEndpoints,
        },
        families::version_json::{
            layout::{SharedInstanceLayout, SharedRootLayout},
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

    /// Return healthy installed instances, logging each rejected instance with
    /// its name, path and error. Root-level scan failures remain errors.
    pub async fn inspect(&self) -> Result<Vec<InstalledInstance>> {
        let report = self
            .launcher
            .inspect_instances()
            .await
            .context("无法扫描本地实例")?;
        for failure in report.failures {
            tracing::warn!(
                instance = %failure.instance_name,
                path = %failure.path.display(),
                error = %failure.error,
                "Unable to inspect local instance"
            );
        }
        Ok(report
            .instances
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

fn compare_version_ids(left: &str, right: &str) -> Ordering {
    let left_parts: Option<Vec<u32>> = left.split('.').map(|part| part.parse().ok()).collect();
    let right_parts: Option<Vec<u32>> = right.split('.').map(|part| part.parse().ok()).collect();
    match (left_parts, right_parts) {
        (Some(left), Some(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    include!("sdk/tests/inspection.rs");
    include!("sdk/tests/identity.rs");
    include!("sdk/tests/natives.rs");
    include!("sdk/tests/catalog.rs");
    include!("sdk/tests/fixtures.rs");
    include!("sdk/tests/metadata.rs");
    include!("sdk/tests/preparation.rs");
    include!("sdk/tests/boundaries.rs");
}
