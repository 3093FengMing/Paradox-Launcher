use std::{cmp::Ordering, path::PathBuf};

use anyhow::{Context, Result, ensure};
use elemental::{
    core::{
        auth::authorizers::offline::OfflineAuthorizer,
        launcher::process::{self, LoggedChild},
    },
    driver::{
        drivers::vanilla::catalog::VanillaCatalog, families::version_json::launch::LaunchResolution,
    },
    launcher::{DriverSpec, LaunchOptions, Launcher, PrepareInstanceRequest, VanillaSpec},
};

use crate::{GameProfile, GameVersion, InstalledInstance, Settings};

/// The only module that knows Elemental types. UI state stays application-owned.
pub struct ElementalService {
    launcher: Launcher,
}

impl ElementalService {
    pub fn new(settings: &Settings) -> Result<Self> {
        settings.validate()?;
        Ok(Self {
            launcher: Launcher::builder()
                .storage_root(&settings.game_directory)
                .build(),
        })
    }

    pub async fn catalog(&self) -> Result<Vec<GameVersion>> {
        let releases = self
            .launcher
            .catalog(VanillaCatalog::with_defaults())
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
        profile.validate()?;
        let prepared = self
            .launcher
            .prepare_instance(PrepareInstanceRequest {
                instance_name: profile.instance_key.clone(),
                driver: DriverSpec::Vanilla(VanillaSpec {
                    game_version: profile.game_version.clone().into(),
                }),
            })
            .await
            .context("安装或修复原版实例失败")?;
        Ok(prepared.instance_root().into())
    }

    /// Reopen the installed instance. Launch does not implicitly download files.
    pub async fn launch(&self, profile: &GameProfile, settings: &Settings) -> Result<LoggedChild> {
        profile.validate()?;
        settings.validate()?;
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
        if !settings.java_executable.trim().is_empty() {
            options.runtime_executable_path = Some(settings.java_executable.trim().into());
        }
        let command = self
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
        process::spawn_command_logged(command.command).context("无法启动 Java 进程")
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

    #[test]
    fn release_versions_sort_numerically() {
        assert_eq!(compare_version_ids("1.10", "1.9"), Ordering::Greater);
        assert_eq!(compare_version_ids("1.21.10", "1.21.2"), Ordering::Greater);
        assert_eq!(compare_version_ids("1.21.1", "1.21"), Ordering::Greater);
    }
}
