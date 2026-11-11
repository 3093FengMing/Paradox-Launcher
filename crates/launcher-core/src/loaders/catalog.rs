use super::{LoaderVersion, normalize_versions};
use anyhow::{Result, ensure};
use elemental::{
    core::minecraft::MinecraftVersion,
    driver::{
        drivers::{
            fabric::source::FabricEndpoints, forge::ForgeEndpoints, neoforge::NeoForgeEndpoints,
            quilt::source::QuiltEndpoints,
        },
        families::installer::InstallerMavenEndpoints,
    },
    schema::maven::MavenMetadataBody,
};
use serde::Deserialize;
use std::time::Duration;

const MAX_METADATA_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn catalog_url(loader: &str, game: &str) -> Result<String> {
    Ok(match loader {
        "fabric" => FabricEndpoints::official().loader_versions_url(game)?,
        "quilt" => QuiltEndpoints::official().loader_versions_url(game)?,
        "forge" => ForgeEndpoints::official().maven_metadata_url()?,
        "neoforge" => NeoForgeEndpoints::official().maven_metadata_url()?,
        _ => anyhow::bail!("loaders.errors.unsupported"),
    })
}

/// Metadata has a total deadline in addition to the file client's read timeout.
/// Check each streamed chunk so responses without Content-Length stay bounded.
pub(crate) async fn fetch_resource(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
) -> Result<Vec<u8>> {
    tokio::time::timeout(timeout, async {
        let mut response = client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| anyhow::anyhow!("loaders.errors.network"))?;
        ensure!(
            response
                .content_length()
                .is_none_or(|length| length <= MAX_METADATA_BYTES as u64),
            "loaders.errors.response"
        );
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("loaders.errors.network"))?
        {
            ensure!(
                chunk.len() <= MAX_METADATA_BYTES - bytes.len(),
                "loaders.errors.response"
            );
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    })
    .await
    .map_err(|_| anyhow::anyhow!("loaders.errors.network"))?
}

pub(super) async fn versions_from_url(
    client: &reqwest::Client,
    loader: &str,
    game: &str,
    url: &str,
    timeout: Duration,
) -> Result<Vec<LoaderVersion>> {
    let bytes = fetch_resource(client, url, timeout).await?;
    let versions = if matches!(loader, "fabric" | "quilt") {
        let entries: Vec<MetaLoaderEntry> = serde_json::from_slice(&bytes)
            .map_err(|_| anyhow::anyhow!("loaders.errors.response"))?;
        entries
            .into_iter()
            .map(|entry| {
                let version = entry.loader.version;
                let stable = entry
                    .loader
                    .stable
                    .unwrap_or_else(|| loader == "quilt" && numeric_release(&version, 3));
                LoaderVersion { version, stable }
            })
            .collect()
    } else {
        let metadata: MavenMetadataBody = quick_xml::de::from_reader(bytes.as_slice())
            .map_err(|_| anyhow::anyhow!("loaders.errors.response"))?;
        metadata
            .versioning
            .versions
            .version
            .into_iter()
            .filter_map(|version| match loader {
                "forge" => {
                    // Preserve the entire loader suffix, including beta labels.
                    let (coordinate_game, suffix) = version.split_once('-')?;
                    (coordinate_game == game && !suffix.is_empty()).then(|| LoaderVersion {
                        version: suffix.to_owned(),
                        stable: !suffix.contains("beta"),
                    })
                }
                "neoforge" => (infer_neoforge_game_version(&version).as_deref() == Some(game))
                    .then(|| LoaderVersion {
                        stable: !version.ends_with("-beta"),
                        version,
                    }),
                _ => None,
            })
            .collect()
    };
    Ok(normalize_versions(loader, versions))
}

#[derive(Deserialize)]
struct MetaLoaderEntry {
    loader: MetaLoaderVersion,
}

#[derive(Deserialize)]
struct MetaLoaderVersion {
    version: String,
    #[serde(default)]
    stable: Option<bool>,
}

fn numeric_release(version: &str, expected_parts: usize) -> bool {
    let parts = version.split('.').collect::<Vec<_>>();
    parts.len() == expected_parts
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

fn infer_neoforge_game_version(loader_version: &str) -> Option<String> {
    let core = loader_version
        .strip_suffix("-beta")
        .unwrap_or(loader_version);
    let parts = core.split('.').collect::<Vec<_>>();
    if parts
        .iter()
        .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    let [major, minor, ..] = parts.as_slice() else {
        return None;
    };
    let major = major.parse::<u32>().ok()?;
    let minor = minor.parse::<u32>().ok()?;
    if major >= 26 {
        let [_, _, hotfix, _build] = parts.as_slice() else {
            return None;
        };
        return Some(
            MinecraftVersion::year_release(major, minor, hotfix.parse().ok()?)
                .into_id()
                .to_string(),
        );
    }
    if parts.len() != 3 {
        return None;
    }
    Some(if minor == 0 {
        format!("1.{major}")
    } else {
        MinecraftVersion::legacy_release(1, major, minor)
            .into_id()
            .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    async fn read_request(connection: &mut tokio::net::TcpStream) {
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = connection.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            assert!(request.len() <= 16 * 1024);
        }
    }

    #[tokio::test]
    async fn metadata_bounds_advertised_and_streamed_responses() {
        for advertised in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/metadata", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut connection, _) = listener.accept().await.unwrap();
                read_request(&mut connection).await;
                let headers = if advertised {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        MAX_METADATA_BYTES + 1
                    )
                } else {
                    "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_owned()
                };
                connection.write_all(headers.as_bytes()).await.unwrap();
                if !advertised {
                    let chunk = vec![b'x'; 1024 * 1024];
                    for _ in 0..9 {
                        if connection.write_all(&chunk).await.is_err() {
                            break;
                        }
                    }
                }
            });
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let error = fetch_resource(&client, &url, Duration::from_secs(5))
                .await
                .unwrap_err();
            assert_eq!(error.to_string(), "loaders.errors.response");
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[tokio::test]
    async fn metadata_deadline_covers_a_continuously_streaming_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/metadata", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            read_request(&mut connection).await;
            connection
                .write_all(
                    b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            loop {
                if connection.write_all(b"1\r\nx\r\n").await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let error = fetch_resource(&client, &url, Duration::from_millis(150))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "loaders.errors.network");
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}
