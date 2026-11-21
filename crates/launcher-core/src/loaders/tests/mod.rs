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

use super::prepare::{cancel_preparation_with_error, validate_installation_paths};
use super::versions::{legacy_forge_game, numeric_parts};
use crate::{GameProfile, Settings};
use anyhow::Result;
use elemental::driver::drivers::{
    fabric::source::FabricEndpoints, forge, neoforge, quilt::source::QuiltEndpoints,
};
use elemental::infra::downloader::{
    DownloadSession, ElementalDownloader, ElementalDownloaderConfig, FailurePolicy, RetryPolicy,
};
use std::{path::PathBuf, time::Duration};

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
        url::OriginPolicy,
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
    use elemental::driver::families::installer::MavenEndpoints;
    let url = match loader {
        "fabric" => FabricEndpoints::new(
            OriginPolicy::default()
                .with_override(FabricOrigin::Meta, origin)
                .unwrap(),
        )
        .loader_versions_url(game)
        .unwrap(),
        "quilt" => QuiltEndpoints::new(
            OriginPolicy::default()
                .with_override(QuiltOrigin::Meta, origin)
                .unwrap(),
        )
        .loader_versions_url(game)
        .unwrap(),
        "forge" => MavenEndpoints::new(
            &forge::FORGE_SPEC,
            OriginPolicy::default()
                .with_override(ForgeOrigin, origin)
                .unwrap(),
        )
        .maven_metadata_url()
        .unwrap(),
        "neoforge" => MavenEndpoints::new(
            &neoforge::NEOFORGE_SPEC,
            OriginPolicy::default()
                .with_override(NeoForgeOrigin, origin)
                .unwrap(),
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

// Keep existing test harness names while grouping regressions by behavior.
include!("installation.rs");
include!("catalog.rs");
