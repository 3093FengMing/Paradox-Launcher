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
            forge::{ForgeDriver, ForgeEndpoints, ForgeSource},
            neoforge::{NeoForgeDriver, NeoForgeEndpoints, NeoForgeSource},
            quilt::{
                driver::QuiltDriverFamily,
                source::{QuiltEndpoints, QuiltSource},
            },
            vanilla::source::VanillaSource,
        },
        families::version_json::{BaseInstanceLayout, BaseRootLayout, ProfiledVersionJsonDriver},
    },
    infra::downloader::{
        DownloadSession, ElementalDownloader, ElementalDownloaderConfig, FailurePolicy, RetryPolicy,
    },
};
use profile::BoundedProfileFamily;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

mod catalog;
mod profile;

pub(crate) use catalog::fetch_resource as fetch_metadata_resource;

#[derive(Clone, Deserialize, Serialize)]
pub struct LoaderVersion {
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

pub fn validate_loader(loader: &str, version: &str) -> Result<()> {
    ensure!(
        matches!(
            loader,
            "vanilla" | "fabric" | "quilt" | "forge" | "neoforge"
        ),
        "loaders.errors.unsupported"
    );
    if loader == "vanilla" {
        ensure!(version.is_empty(), "loaders.errors.version");
    } else {
        ensure!(
            !version.is_empty()
                && version.len() <= 80
                && version
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
                && version != "."
                && version != "..",
            "loaders.errors.version"
        );
    }
    Ok(())
}

pub async fn versions(settings: &Settings, loader: &str, game: &str) -> Result<Vec<LoaderVersion>> {
    GameProfile::new("catalog", game)?;
    ensure!(
        matches!(loader, "fabric" | "quilt" | "forge" | "neoforge"),
        "loaders.errors.unsupported"
    );
    if loader == "forge" && legacy_forge_game(game) {
        return Ok(Vec::new());
    }
    let client = settings.network.build_client()?;
    catalog::versions_from_url(
        &client,
        loader,
        game,
        &catalog::catalog_url(loader, game)?,
        Duration::from_secs(settings.network.timeout_seconds.into()),
    )
    .await
}

fn normalize_versions(loader: &str, mut result: Vec<LoaderVersion>) -> Vec<LoaderVersion> {
    result.retain(|v| validate_loader(loader, &v.version).is_ok());
    result.sort_by(|a, b| {
        numeric_parts(&b.version)
            .cmp(&numeric_parts(&a.version))
            .then_with(|| b.version.cmp(&a.version))
    });
    result.dedup_by(|a, b| a.version == b.version);
    result
}

fn numeric_parts(version: &str) -> Vec<u32> {
    version
        .split(['.', '-'])
        .map(|p| p.parse().unwrap_or_default())
        .collect()
}

fn legacy_forge_game(game: &str) -> bool {
    let mut parts = game.split('.');
    parts.next() == Some("1")
        && parts
            .next()
            .and_then(|minor| minor.parse::<u32>().ok())
            .is_some_and(|minor| minor < 17)
}

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
    let storage = Storage::new(&settings.game_directory, BaseRootLayout);
    let instance = storage
        .ensure_instance(profile.instance_key.clone(), BaseInstanceLayout)
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
                    ForgeDriver::new(ForgeSource::with_client(ForgeEndpoints::official(), client))
                        .with_vanilla_source(vanilla)
                        .prepare(&request)
                        .await?;
                } else {
                    NeoForgeDriver::new(NeoForgeSource::with_client(
                        NeoForgeEndpoints::official(),
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

async fn cancel_preparation_with_error(
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

mod installation_paths;
pub(crate) use installation_paths::{InstallationPaths, validate_target};

fn validate_installation_paths(profile: &GameProfile, settings: &Settings) -> Result<PathBuf> {
    Ok(InstallationPaths::new(&settings.game_directory, &profile.instance_key)?.instance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use elemental::{
        driver::families::installer::{InstallerArtifact, prepare_installer_state},
        infra::{
            downloader::{DownloadPhase, DownloadTask},
            error::Error as DownloaderError,
        },
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
    };

    async fn installation_test_session() -> DownloadSession {
        ElementalDownloader::builder()
            .client(reqwest::Client::builder().no_proxy().build().unwrap())
            .config(ElementalDownloaderConfig {
                max_concurrent_downloads: 1,
                default_session_parallelism: 1,
                connect_timeout: Duration::from_secs(3),
                read_timeout: Duration::from_secs(3),
                ..Default::default()
            })
            .build()
            .unwrap()
            .session("installation-test")
            .retry(RetryPolicy::none())
            .failure_policy(FailurePolicy::CancelAll)
            .open()
            .await
            .unwrap()
    }

    async fn read_http_request(connection: &mut TcpStream) {
        let mut request = Vec::new();
        let mut buffer = [0u8; 4096];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = connection.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            assert!(request.len() <= 16 * 1024);
        }
    }

    async fn catalog_fixture(loader: &str, game: &str, body: &[u8]) -> Result<Vec<LoaderVersion>> {
        use elemental::driver::{
            drivers::{
                fabric::source::FabricOrigin, forge::ForgeOrigin, neoforge::NeoForgeOrigin,
                quilt::source::QuiltOrigin,
            },
            url::OriginEndpoints,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let body = body.to_vec();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            read_http_request(&mut connection).await;
            connection
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            connection.write_all(&body).await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        use elemental::driver::families::installer::InstallerMavenEndpoints;
        let url = match loader {
            "fabric" => FabricEndpoints::with_overrides([(FabricOrigin::Meta, origin)])
                .unwrap()
                .loader_versions_url(game)
                .unwrap(),
            "quilt" => QuiltEndpoints::with_overrides([(QuiltOrigin::Meta, origin)])
                .unwrap()
                .loader_versions_url(game)
                .unwrap(),
            "forge" => ForgeEndpoints::new(
                OriginEndpoints::with_overrides([(ForgeOrigin, origin)]).unwrap(),
            )
            .maven_metadata_url()
            .unwrap(),
            "neoforge" => NeoForgeEndpoints::new(
                OriginEndpoints::with_overrides([(NeoForgeOrigin, origin)]).unwrap(),
            )
            .maven_metadata_url()
            .unwrap(),
            _ => unreachable!(),
        };
        let result =
            catalog::versions_from_url(&client, loader, game, &url, Duration::from_secs(5)).await;
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        result
    }

    #[tokio::test]
    async fn installer_download_failure_is_reported_before_reading_the_archive() {
        for family in ["forge", "neoforge"] {
            let temporary = tempfile::tempdir().unwrap();
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/installer.jar", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut connection, _) = listener.accept().await.unwrap();
                read_http_request(&mut connection).await;
                connection
                    .write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await
                    .unwrap();
            });
            let session = installation_test_session().await;
            let installer = InstallerArtifact {
                coordinate: "example:installer:1.0".into(),
                url,
                path: temporary.path().join("installer.jar"),
                expected_size: None,
                sha1: None,
            };
            let installer_error = tokio::time::timeout(
                Duration::from_secs(5),
                prepare_installer_state(
                    &session,
                    &installer,
                    &temporary.path().join("instance"),
                    &temporary.path().join("libraries"),
                    family,
                    |_| Ok(()),
                ),
            )
            .await
            .unwrap()
            .unwrap_err();
            assert!(matches!(
                &installer_error,
                elemental::driver::error::Error::DownloadInstaller { .. }
            ));
            let error = cancel_preparation_with_error(session, installer_error.into()).await;
            let Some(DownloaderError::SessionFailed { failures, .. }) =
                error.downcast_ref::<DownloaderError>()
            else {
                panic!("the download failure was hidden: {error:#}");
            };
            assert_eq!(failures.len(), 1);
            assert_eq!(failures[0].phase, DownloadPhase::HttpStatus);
            assert_eq!(failures[0].http_status, Some(500));
            assert_eq!(failures[0].group.as_deref(), Some("installer"));
            assert!(error.to_string().contains("HTTP 500"));
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
        }
    }

    #[tokio::test]
    async fn cancelling_an_active_download_preserves_the_java_error() {
        let temporary = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/library.jar", listener.local_addr().unwrap());
        let (started, request_received) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            read_http_request(&mut connection).await;
            started.send(()).unwrap();
            let mut buffer = [0u8; 1];
            let _ = connection.read(&mut buffer).await;
        });
        let session = installation_test_session().await;
        session
            .submit(DownloadTask::new(url, temporary.path().join("library.jar")))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), request_received)
            .await
            .unwrap()
            .unwrap();
        let error =
            cancel_preparation_with_error(session, anyhow::anyhow!("Java runtime unavailable"))
                .await;
        assert_eq!(error.to_string(), "Java runtime unavailable");
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn cancelling_an_empty_session_preserves_the_metadata_error() {
        let session = installation_test_session().await;
        let error =
            cancel_preparation_with_error(session, anyhow::anyhow!("Invalid metadata")).await;
        assert_eq!(error.to_string(), "Invalid metadata");
    }

    const NEOFORGE_METADATA: &[u8] = br#"<metadata><versioning><versions>
        <version>21.0.167</version><version>21.1.265</version><version>21.10.2</version>
        <version>26.1.0.1-beta</version><version>26.1.1.4-beta</version>
        <version>26.1.2.125</version><version>26.1.2.124</version>
        <version>26.3.0.99</version><version>26.3.0.100</version>
        <version>26.3.0.100</version><version>26.3.0.75-beta</version>
        <version>26.3.0.0-alpha.1+snapshot-1</version><version>26.3.1.1</version>
        <version>26.30.0.1</version><version>26.3.0../bad</version>
        </versions></versioning></metadata>"#;

    fn offline_settings(root: PathBuf) -> Settings {
        let mut settings = Settings {
            game_directory: root,
            ..Settings::default()
        };
        settings.network.proxy_url = "http://127.0.0.1:1".into();
        settings.network.timeout_seconds = 1;
        settings
    }

    fn fabric_profile() -> GameProfile {
        let mut profile = GameProfile::new("Fabric", "1.21.1").unwrap();
        profile.loader = "fabric".into();
        profile.loader_version = "0.16.10".into();
        profile
    }

    #[tokio::test]
    async fn forge_catalog_hides_unsupported_legacy_games_without_networking() {
        let temp = tempfile::tempdir().unwrap();
        let settings = offline_settings(temp.path().canonicalize().unwrap().join("minecraft"));
        for game in ["1.7.10", "1.12.2", "1.13.2", "1.16.5"] {
            assert!(versions(&settings, "forge", game).await.unwrap().is_empty());
        }
        assert!(!settings.game_directory.exists());
        for game in ["1.17", "1.17.1", "1.18.2", "1.20.1", "26.3"] {
            assert!(
                !legacy_forge_game(game),
                "{game} must not be hidden as legacy"
            );
        }
    }

    #[tokio::test]
    async fn forge_install_rejects_unsupported_legacy_games_before_network_or_writes() {
        let temp = tempfile::tempdir().unwrap();
        let settings = offline_settings(temp.path().canonicalize().unwrap().join("minecraft"));
        for game in ["1.7.10", "1.12.2", "1.13.2", "1.16.5"] {
            let mut profile = GameProfile::new("Legacy Forge", game).unwrap();
            profile.loader = "forge".into();
            profile.loader_version = "36.2.42".into();
            let error = prepare(&profile, &settings, &temp.path().join("runtimes"))
                .await
                .unwrap_err();
            assert_eq!(error.to_string(), "loaders.errors.compatibility");
        }
        assert!(!settings.game_directory.exists());
    }

    #[tokio::test]
    async fn loader_install_rejects_parent_traversal_before_network_or_file_writes() {
        let temp = tempfile::tempdir().unwrap();
        let settings = offline_settings(
            crate::sdk::java_compatible_path(&temp.path().canonicalize().unwrap())
                .join("minecraft")
                .join("..")
                .join("outside"),
        );
        let error = prepare(&fabric_profile(), &settings, &temp.path().join("runtimes"))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "loaders.errors.path");
        assert!(
            !temp
                .path()
                .canonicalize()
                .unwrap()
                .join("minecraft")
                .exists()
        );
        assert!(!temp.path().join("outside").exists());
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn loader_install_rejects_linked_versions_before_network_or_file_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("minecraft");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("versions")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, root.join("versions")).unwrap();
        let error = prepare(
            &fabric_profile(),
            &offline_settings(root),
            &temp.path().join("runtimes"),
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "loaders.errors.path");
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn loader_install_rejects_nested_and_broken_sdk_target_links() {
        for target in [
            "assets/objects",
            "libraries/net/fabricmc",
            ".elemental/fabric",
            "natives",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().canonicalize().unwrap().join("minecraft");
            let outside = temp.path().join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            let profile = fabric_profile();
            let linked_path = if target.starts_with("assets") || target.starts_with("libraries") {
                root.join(target)
            } else {
                root.join("versions")
                    .join(&profile.instance_key)
                    .join(target)
            };
            std::fs::create_dir_all(linked_path.parent().unwrap()).unwrap();
            #[cfg(unix)]
            std::os::unix::fs::symlink(&outside, &linked_path).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_dir(&outside, &linked_path).unwrap();
            assert_eq!(
                validate_installation_paths(&profile, &offline_settings(root))
                    .unwrap_err()
                    .to_string(),
                "loaders.errors.path",
                "{target}"
            );
            assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
        }
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("minecraft");
        let profile = fabric_profile();
        let instance = root.join("versions").join(&profile.instance_key);
        std::fs::create_dir_all(&instance).unwrap();
        let metadata = instance.join(format!("{}.json", profile.instance_key));
        #[cfg(unix)]
        std::os::unix::fs::symlink(temp.path().join("missing.json"), metadata).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(temp.path().join("missing.json"), metadata).unwrap();
        assert_eq!(
            validate_installation_paths(&profile, &offline_settings(root))
                .unwrap_err()
                .to_string(),
            "loaders.errors.path"
        );
        assert!(!temp.path().join("missing.json").exists());
    }

    #[tokio::test]
    async fn neoforge_catalog_matches_year_releases_and_hotfixes_exactly() {
        for (game, expected) in [
            ("26.3", vec!["26.3.0.100", "26.3.0.99", "26.3.0.75-beta"]),
            ("26.1", vec!["26.1.0.1-beta"]),
            ("26.1.1", vec!["26.1.1.4-beta"]),
            ("26.1.2", vec!["26.1.2.125", "26.1.2.124"]),
        ] {
            let releases = catalog_fixture("neoforge", game, NEOFORGE_METADATA)
                .await
                .unwrap();
            assert_eq!(
                releases
                    .iter()
                    .map(|entry| entry.version.as_str())
                    .collect::<Vec<_>>(),
                expected,
                "wrong NeoForge catalog for Minecraft {game}"
            );
            for release in releases {
                assert_eq!(release.stable, !release.version.ends_with("-beta"));
            }
        }
    }

    #[tokio::test]
    async fn neoforge_catalog_preserves_legacy_mapping_and_rejects_unknown_game_formats() {
        for (game, expected) in [
            ("1.21", vec!["21.0.167"]),
            ("1.21.1", vec!["21.1.265"]),
            ("26.3-snapshot-1", vec![]),
            ("26.3-pre-1", vec![]),
            ("26.3-rc-1", vec![]),
            ("1.21.1.4", vec![]),
            ("26.3.0.1", vec![]),
            ("1.21-pre1", vec![]),
            ("25w14a", vec![]),
            ("25.3", vec![]),
            ("26", vec![]),
            ("26.", vec![]),
        ] {
            let releases = catalog_fixture("neoforge", game, NEOFORGE_METADATA)
                .await
                .unwrap();
            assert_eq!(
                releases
                    .iter()
                    .map(|entry| entry.version.as_str())
                    .collect::<Vec<_>>(),
                expected,
                "wrong NeoForge catalog for Minecraft {game}"
            );
        }
    }

    #[tokio::test]
    #[ignore = "queries the official NeoForge Maven catalog"]
    async fn neoforge_live_catalog_contains_year_based_releases() {
        for (game, expected) in [
            ("26.3", "26.3.0.100"),
            ("26.1.2", "26.1.2.125"),
            ("1.21.1", "21.1.265"),
        ] {
            let releases = versions(&Settings::default(), "neoforge", game)
                .await
                .unwrap();
            assert!(
                releases.iter().any(|release| release.version == expected),
                "Minecraft {game} must include its published NeoForge release {expected}"
            );
        }
    }

    #[tokio::test]
    async fn forge_catalog_preserves_full_game_prefix_and_numeric_sorting() {
        let metadata = br#"<metadata><versioning><versions>
            <version>1.21.1-52.0.9</version><version>1.21.1-52.0.10</version>
            <version>1.21.1-52.0.10</version><version>1.21.10-60.0.1</version>
            <version>1.21-51.0.33</version><version>1.21.1-../bad</version>
            </versions></versioning></metadata>"#;
        let releases = catalog_fixture("forge", "1.21.1", metadata).await.unwrap();
        assert_eq!(
            releases
                .iter()
                .map(|release| release.version.as_str())
                .collect::<Vec<_>>(),
            ["52.0.10", "52.0.9"]
        );
    }

    #[tokio::test]
    async fn forge_catalog_preserves_beta_version_and_stability() {
        let metadata = br#"<metadata><versioning><versions>
            <version>1.21.1-52.0.10-beta</version><version>1.21.1-52.0.11</version>
            </versions></versioning></metadata>"#;
        let releases = catalog_fixture("forge", "1.21.1", metadata).await.unwrap();
        assert_eq!(
            releases
                .iter()
                .map(|entry| (entry.version.as_str(), entry.stable))
                .collect::<Vec<_>>(),
            [("52.0.11", true), ("52.0.10-beta", false)]
        );
    }

    #[tokio::test]
    async fn fabric_and_quilt_catalogs_preserve_stability_and_reject_unsafe_versions() {
        let metadata = br#"[{"loader":{"version":"0.16.9","stable":true}},
            {"loader":{"version":"0.16.10","stable":false}},
            {"loader":{"version":"../bad","stable":true}}]"#;
        for loader in ["fabric", "quilt"] {
            let releases = catalog_fixture(loader, "1.21.1", metadata).await.unwrap();
            assert_eq!(
                releases
                    .iter()
                    .map(|release| (release.version.as_str(), release.stable))
                    .collect::<Vec<_>>(),
                [("0.16.10", false), ("0.16.9", true)]
            );
        }
    }

    #[tokio::test]
    async fn quilt_catalog_recognizes_releases_when_the_api_omits_stable() {
        let metadata = br#"[{"loader":{"version":"0.30.0"}},
            {"loader":{"version":"0.30.1-beta.2"}},
            {"loader":{"version":"0.29.3","stable":false}},
            {"loader":{"version":"0.28.1","stable":true}},
            {"loader":{"version":"../bad"}}]"#;
        let releases = catalog_fixture("quilt", "1.20.1", metadata).await.unwrap();
        assert_eq!(
            releases
                .iter()
                .filter(|release| release.stable)
                .map(|release| release.version.as_str())
                .collect::<Vec<_>>(),
            ["0.30.0", "0.28.1"]
        );
        assert!(
            catalog_fixture("fabric", "1.20.1", metadata)
                .await
                .unwrap()
                .iter()
                .filter(|release| release.stable)
                .all(|release| release.version == "0.28.1")
        );
    }

    #[tokio::test]
    async fn catalogs_treat_null_stability_like_a_missing_field() {
        let metadata = br#"[{"loader":{"version":"0.30.0","stable":null}}]"#;
        let quilt = catalog_fixture("quilt", "1.20.1", metadata).await.unwrap();
        assert_eq!(quilt.len(), 1);
        assert!(quilt[0].stable);
        let fabric = catalog_fixture("fabric", "1.20.1", metadata).await.unwrap();
        assert_eq!(fabric.len(), 1);
        assert!(!fabric[0].stable);
    }

    #[test]
    fn loader_versions_are_path_safe_and_vanilla_has_no_loader_version() {
        for version in ["../bad", "x/y", "", "..", "x:bad"] {
            assert!(validate_loader("fabric", version).is_err());
        }
        assert!(validate_loader("vanilla", "").is_ok());
        assert!(validate_loader("vanilla", "0.16.10").is_err());
        assert!(validate_loader("fabric", "0.16.10").is_ok());
        assert!(numeric_parts("0.16.10") > numeric_parts("0.16.9"));
    }
}
