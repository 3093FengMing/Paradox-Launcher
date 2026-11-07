use crate::{GameProfile, Settings};
use anyhow::{Result, bail, ensure};
use elemental::driver::families::version_json::VersionJsonGameStorageExt;
use elemental::{
    core::storage::Storage,
    driver::{
        drivers::{
            fabric::{
                driver::{FabricDriver, FabricDriverFamily},
                source::{FabricEndpoints, FabricFlavor, FabricSource},
            },
            forge::{
                driver::ForgeDriver,
                source::{ForgeEndpoints, ForgeSource},
            },
            neoforge::{
                driver::NeoForgeDriver,
                source::{NeoForgeEndpoints, NeoForgeSource},
            },
            quilt::{
                driver::{QuiltDriver, QuiltDriverFamily},
                source::{QuiltEndpoints, QuiltSource},
            },
            vanilla::source::VanillaSource,
        },
        families::version_json::{BaseInstanceLayout, BaseRootLayout},
    },
    infra::downloader::core::{ElementalDownloader, ElementalDownloaderConfig},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

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
    let url = match loader {
        "fabric" => format!("https://meta.fabricmc.net/v2/versions/loader/{game}"),
        "quilt" => format!("https://meta.quiltmc.org/v3/versions/loader/{game}"),
        "forge" => {
            "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml".into()
        }
        _ => {
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml".into()
        }
    };
    let response = client
        .get(url)
        .timeout(Duration::from_secs(settings.network.timeout_seconds.into()))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("loaders.errors.network"))?
        .error_for_status()
        .map_err(|_| anyhow::anyhow!("loaders.errors.network"))?;
    let body = response.bytes().await?;
    parse_versions(loader, game, &body)
}

fn parse_versions(loader: &str, game: &str, body: &[u8]) -> Result<Vec<LoaderVersion>> {
    ensure!(body.len() <= 8 * 1024 * 1024, "loaders.errors.response");
    let mut result = if matches!(loader, "fabric" | "quilt") {
        #[derive(Deserialize)]
        struct Entry {
            loader: CatalogLoader,
        }
        #[derive(Deserialize)]
        struct CatalogLoader {
            version: String,
            stable: Option<bool>,
        }
        serde_json::from_slice::<Vec<Entry>>(body)
            .map_err(|_| anyhow::anyhow!("loaders.errors.response"))?
            .into_iter()
            .map(|entry| {
                let version = entry.loader.version;
                // Quilt's v3 API omits Fabric's `stable` field. A plain numeric
                // three-part release is stable; prereleases remain opt-in.
                let stable = entry.loader.stable.unwrap_or_else(|| {
                    loader == "quilt"
                        && version.split('.').count() == 3
                        && version.split('.').all(|part| {
                            !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
                        })
                });
                LoaderVersion { version, stable }
            })
            .collect::<Vec<_>>()
    } else {
        #[derive(Deserialize)]
        struct Metadata {
            versioning: Versioning,
        }
        #[derive(Deserialize)]
        struct Versioning {
            versions: Versions,
        }
        #[derive(Deserialize)]
        struct Versions {
            version: Vec<String>,
        }
        let text = std::str::from_utf8(body)?;
        let metadata: Metadata = quick_xml::de::from_str(text)
            .map_err(|_| anyhow::anyhow!("loaders.errors.response"))?;
        let prefix = if loader == "forge" {
            format!("{game}-")
        } else {
            let Some(prefix) = neoforge_version_prefix(game) else {
                return Ok(Vec::new());
            };
            prefix
        };
        metadata
            .versioning
            .versions
            .version
            .into_iter()
            .filter_map(|v| {
                if loader == "forge" {
                    v.strip_prefix(&prefix).map(|version| LoaderVersion {
                        version: version.into(),
                        stable: !version.contains("beta"),
                    })
                } else {
                    let build = v.strip_prefix(&prefix)?;
                    let number = build.strip_suffix("-beta").unwrap_or(build);
                    (!number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())).then(
                        || LoaderVersion {
                            stable: !v.ends_with("-beta"),
                            version: v,
                        },
                    )
                }
            })
            .collect()
    };
    result.retain(|v| validate_loader(loader, &v.version).is_ok());
    result.sort_by(|a, b| {
        numeric_parts(&b.version)
            .cmp(&numeric_parts(&a.version))
            .then_with(|| b.version.cmp(&a.version))
    });
    result.dedup_by(|a, b| a.version == b.version);
    Ok(result)
}

fn neoforge_version_prefix(game: &str) -> Option<String> {
    let parts: Vec<_> = game.split('.').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    // Legacy releases omit Minecraft's leading 1. Year-based releases retain
    // year, release and hotfix (zero when omitted), followed by the loader build.
    // Snapshot/pre-release suffixes require their own metadata and are not inferred.
    match parts.as_slice() {
        ["1", minor] => Some(format!("{minor}.0.")),
        ["1", minor, patch] => Some(format!("{minor}.{patch}.")),
        [year, release] if year.parse::<u32>().ok()? >= 26 => Some(format!("{year}.{release}.0.")),
        [year, release, hotfix] if year.parse::<u32>().ok()? >= 26 => {
            Some(format!("{year}.{release}.{hotfix}."))
        }
        _ => None,
    }
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
            max_connections: settings.network.max_concurrent_downloads as usize,
            session_parallelism: settings.network.max_concurrent_downloads as usize,
            retry_times: settings.network.max_retries,
            connect_timeout: Duration::from_secs(settings.network.timeout_seconds.into()),
            ..Default::default()
        })
        .build()?;
    let vanilla = VanillaSource::with_client(settings.network.endpoints()?, client.clone());
    let game = profile.game_version.clone().into();
    let loader = profile.loader_version.clone().into();
    match profile.loader.as_str() {
        "fabric" => {
            FabricDriver::new(
                FabricDriverFamily::new(FabricFlavor::Fabric),
                FabricSource::with_client(FabricEndpoints::official(), client),
                vanilla,
                downloader,
            )
            .prepare(&instance, game, loader)
            .await?;
        }
        "quilt" => {
            QuiltDriver::new(
                QuiltDriverFamily,
                QuiltSource::with_client(QuiltEndpoints::official(), client),
                vanilla,
                downloader,
            )
            .prepare(&instance, game, loader)
            .await?;
        }
        "forge" | "neoforge" => {
            let base = elemental::driver::drivers::vanilla::source::resolve_vanilla_metadata(
                &vanilla,
                &profile.game_version,
            )
            .await?;
            let metadata = serde_json::to_value(base.metadata)?;
            let required = metadata
                .pointer("/javaVersion/majorVersion")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(8) as u32;
            let runtime = crate::java::select_runtime(
                required,
                (!settings.java_executable.is_empty())
                    .then(|| Path::new(&settings.java_executable)),
                &managed_root,
            )
            .await?;
            let config = elemental::launcher::LaunchOptions::default()
                .set_runtime_executable_path(runtime.executable);
            if profile.loader == "forge" {
                ForgeDriver::new(
                    ForgeSource::with_client(ForgeEndpoints::official(), client),
                    vanilla,
                    downloader,
                )
                .prepare_with_config(&instance, game, loader, &config)
                .await?;
            } else {
                NeoForgeDriver::new(
                    NeoForgeSource::with_client(NeoForgeEndpoints::official(), client),
                    vanilla,
                    downloader,
                )
                .prepare_with_config(&instance, game, loader, &config)
                .await?;
            }
        }
        _ => bail!("loaders.errors.unsupported"),
    }
    ensure!(instance.path == instance_path, "loaders.errors.path");
    Ok(instance.path)
}

mod installation_paths;
pub(crate) use installation_paths::{InstallationPaths, validate_target};

fn validate_installation_paths(profile: &GameProfile, settings: &Settings) -> Result<PathBuf> {
    Ok(InstallationPaths::new(&settings.game_directory, &profile.instance_key)?.instance)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn neoforge_catalog_matches_year_releases_and_hotfixes_exactly() {
        for (game, expected) in [
            ("26.3", vec!["26.3.0.100", "26.3.0.99", "26.3.0.75-beta"]),
            ("26.1", vec!["26.1.0.1-beta"]),
            ("26.1.1", vec!["26.1.1.4-beta"]),
            ("26.1.2", vec!["26.1.2.125", "26.1.2.124"]),
        ] {
            let releases = parse_versions("neoforge", game, NEOFORGE_METADATA).unwrap();
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

    #[test]
    fn neoforge_catalog_preserves_legacy_mapping_and_rejects_unknown_game_formats() {
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
            let releases = parse_versions("neoforge", game, NEOFORGE_METADATA).unwrap();
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

    #[test]
    fn forge_catalog_preserves_full_game_prefix_and_numeric_sorting() {
        let metadata = br#"<metadata><versioning><versions>
            <version>1.21.1-52.0.9</version><version>1.21.1-52.0.10</version>
            <version>1.21.1-52.0.10</version><version>1.21.10-60.0.1</version>
            <version>1.21-51.0.33</version><version>1.21.1-../bad</version>
            </versions></versioning></metadata>"#;
        let releases = parse_versions("forge", "1.21.1", metadata).unwrap();
        assert_eq!(
            releases
                .iter()
                .map(|release| release.version.as_str())
                .collect::<Vec<_>>(),
            ["52.0.10", "52.0.9"]
        );
    }

    #[test]
    fn fabric_and_quilt_catalogs_preserve_stability_and_reject_unsafe_versions() {
        let metadata = br#"[{"loader":{"version":"0.16.9","stable":true}},
            {"loader":{"version":"0.16.10","stable":false}},
            {"loader":{"version":"../bad","stable":true}}]"#;
        for loader in ["fabric", "quilt"] {
            let releases = parse_versions(loader, "1.21.1", metadata).unwrap();
            assert_eq!(
                releases
                    .iter()
                    .map(|release| (release.version.as_str(), release.stable))
                    .collect::<Vec<_>>(),
                [("0.16.10", false), ("0.16.9", true)]
            );
        }
    }

    #[test]
    fn quilt_catalog_recognizes_releases_when_the_api_omits_stable() {
        let metadata = br#"[{"loader":{"version":"0.30.0"}},
            {"loader":{"version":"0.30.1-beta.2"}},
            {"loader":{"version":"0.29.3","stable":false}},
            {"loader":{"version":"0.28.1","stable":true}},
            {"loader":{"version":"../bad"}}]"#;
        let releases = parse_versions("quilt", "1.20.1", metadata).unwrap();
        assert_eq!(
            releases
                .iter()
                .filter(|release| release.stable)
                .map(|release| release.version.as_str())
                .collect::<Vec<_>>(),
            ["0.30.0", "0.28.1"]
        );
        assert!(
            parse_versions("fabric", "1.20.1", metadata)
                .unwrap()
                .iter()
                .filter(|release| release.stable)
                .all(|release| release.version == "0.28.1")
        );
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
