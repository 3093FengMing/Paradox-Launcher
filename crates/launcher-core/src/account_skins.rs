//! Public Minecraft skin images cached separately from account credentials.
use crate::{auth::Account, network::NetworkOptions};
use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    future::Future,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};

const MAX_SKIN_BYTES: usize = 1024 * 1024;

pub struct AccountSkinCache {
    directory: PathBuf,
}

impl AccountSkinCache {
    pub fn new(config_path: &Path) -> Self {
        Self {
            directory: config_path
                .parent()
                .unwrap_or(Path::new("."))
                .join("account-skins"),
        }
    }

    pub async fn skin(
        &self,
        account: &Account,
        network: &NetworkOptions,
    ) -> Result<Option<String>> {
        self.skin_with(account, || async {
            download_png(account.skin_url.as_deref().unwrap_or_default(), network).await
        })
        .await
        .map_err(|_| anyhow::anyhow!("auth.errors.skin"))
    }

    async fn skin_with<F, Fut>(&self, account: &Account, fetch: F) -> Result<Option<String>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Vec<u8>>>,
    {
        account.validate()?;
        let Some(url) = &account.skin_url else {
            return Ok(None);
        };
        validate_url(url)?;
        let id = uuid::Uuid::parse_str(&account.id)?.to_string();
        let directory = self.directory.join(id);
        let mut failed_url = cache_lock(&directory)?.lock_owned().await;
        tokio::fs::create_dir_all(&directory).await?;
        for path in [&self.directory, &directory] {
            let metadata = tokio::fs::symlink_metadata(path).await?;
            ensure!(
                metadata.is_dir() && !metadata.file_type().is_symlink(),
                "auth.errors.skin"
            );
        }
        let path = directory.join(format!(
            "{}.png",
            hex::encode(Sha256::digest(url.as_bytes()))
        ));
        if let Ok(bytes) = read_png(&path).await {
            return Ok(Some(data_url(&bytes)));
        }
        // A changed texture or unavailable service must not destroy an offline avatar.
        let previous = read_png(&directory.join("latest.png")).await.ok();
        if failed_url.as_deref() == Some(url) {
            return previous
                .as_deref()
                .map(data_url)
                .map(Some)
                .ok_or_else(|| anyhow::anyhow!("auth.errors.skin"));
        }
        let result = async {
            let bytes = fetch().await?;
            validate_png(&bytes)?;
            persist_png(path, bytes.clone()).await?;
            persist_png(directory.join("latest.png"), bytes.clone()).await?;
            Ok::<_, anyhow::Error>(bytes)
        }
        .await;
        match result {
            Ok(bytes) => {
                *failed_url = None;
                Ok(Some(data_url(&bytes)))
            }
            Err(error) => {
                // All queued consumers share this attempt. A later independent
                // request gets a fresh weakly held state and can retry normally.
                *failed_url = Some(url.clone());
                match previous {
                    Some(bytes) => Ok(Some(data_url(&bytes))),
                    None => Err(error),
                }
            }
        }
    }
}

fn cache_lock(directory: &Path) -> Result<Arc<tokio::sync::Mutex<Option<String>>>> {
    type SkinLocks = Mutex<HashMap<PathBuf, Weak<tokio::sync::Mutex<Option<String>>>>>;
    static LOCKS: OnceLock<SkinLocks> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| anyhow::anyhow!("auth.errors.skin"))?;
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(directory).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(tokio::sync::Mutex::new(None));
    locks.insert(directory.to_owned(), Arc::downgrade(&lock));
    Ok(lock)
}

fn validate_url(raw: &str) -> Result<()> {
    let url = reqwest::Url::parse(raw)?;
    ensure!(
        url.scheme() == "https"
            && url.host_str() == Some("textures.minecraft.net")
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && url.query().is_none()
            && url.fragment().is_none(),
        "auth.errors.skin"
    );
    Ok(())
}

fn validate_png(bytes: &[u8]) -> Result<()> {
    ensure!(bytes.len() <= MAX_SKIN_BYTES, "auth.errors.skin");
    let reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    let (width, height) = reader.into_dimensions()?;
    ensure!(width == 64 && matches!(height, 32 | 64), "auth.errors.skin");
    // Decode as well as inspecting the header: truncated or corrupt PNGs cannot enter the cache.
    image::load_from_memory_with_format(bytes, image::ImageFormat::Png)?;
    Ok(())
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", STANDARD.encode(bytes))
}

async fn read_png(path: &Path) -> Result<Vec<u8>> {
    let metadata = tokio::fs::symlink_metadata(path).await?;
    ensure!(
        metadata.is_file()
            && !metadata.file_type().is_symlink()
            && metadata.len() <= MAX_SKIN_BYTES as u64,
        "auth.errors.skin"
    );
    let bytes = tokio::fs::read(path).await?;
    validate_png(&bytes)?;
    Ok(bytes)
}

async fn persist_png(path: PathBuf, bytes: Vec<u8>) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let parent = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("auth.errors.skin"))?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist(path)?;
        Ok::<_, anyhow::Error>(())
    })
    .await?
}

async fn download_png(url: &str, network: &NetworkOptions) -> Result<Vec<u8>> {
    validate_url(url)?;
    network.validate()?;
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(network.timeout_seconds.into()))
        .user_agent(concat!("ParadoxLauncher/", env!("CARGO_PKG_VERSION")));
    if !network.proxy_url.trim().is_empty() {
        builder = builder.proxy(reqwest::Proxy::all(network.proxy_url.trim())?);
    }
    let mut response = builder.build()?.get(url).send().await?.error_for_status()?;
    ensure!(
        response.status().is_success()
            && response
                .content_length()
                .is_none_or(|size| size <= MAX_SKIN_BYTES as u64),
        "auth.errors.skin"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= MAX_SKIN_BYTES,
            "auth.errors.skin"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use image::{GenericImageView, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    fn account(texture: &str) -> Account {
        Account {
            id: "069a79f4-44e9-4726-a5be-fca90e38aaf5".into(),
            name: "Player".into(),
            skin_url: Some(format!("https://textures.minecraft.net/texture/{texture}")),
        }
    }

    fn skin_png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([12, 34, 56, 255]));
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, ImageFormat::Png).unwrap();
        png.into_inner()
    }

    fn decode_data(data: &str) -> Vec<u8> {
        STANDARD
            .decode(data.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap()
    }

    #[tokio::test]
    async fn skins_are_validated_persisted_and_reused_by_a_new_cache_instance() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.json");
        let cache = AccountSkinCache::new(&config);
        let png = skin_png(64, 64);
        let data = cache
            .skin_with(&account("first"), || async { Ok(png.clone()) })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(decode_data(&data), png);
        let image = image::load_from_memory(&decode_data(&data)).unwrap();
        assert_eq!(image.get_pixel(8, 8), Rgba([12, 34, 56, 255]));
        let reopened = AccountSkinCache::new(&config);
        let cached = reopened
            .skin_with(&account("first"), || async {
                panic!("a valid cached image must not make a network request")
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cached, data);
    }

    #[tokio::test]
    async fn failed_or_malformed_skin_updates_preserve_the_last_valid_image() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.json");
        let cache = AccountSkinCache::new(&config);
        let previous = cache
            .skin_with(&account("old"), || async { Ok(skin_png(64, 32)) })
            .await
            .unwrap()
            .unwrap();
        for bytes in [b"not a PNG".to_vec(), skin_png(128, 128), skin_png(64, 48)] {
            let fallback = cache
                .skin_with(&account("new"), || async { Ok(bytes) })
                .await
                .unwrap()
                .unwrap();
            assert_eq!(fallback, previous);
        }
        let fallback = cache
            .skin_with(&account("new"), || async {
                anyhow::bail!("service unavailable")
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fallback, previous);
        let reopened = AccountSkinCache::new(&config);
        assert_eq!(
            reopened
                .skin_with(&account("old"), || async {
                    panic!("the prior cache must survive a failed update")
                })
                .await
                .unwrap()
                .unwrap(),
            previous
        );
    }

    #[tokio::test]
    async fn invalid_profile_addresses_and_paths_are_rejected_before_fetching() {
        let temp = tempfile::tempdir().unwrap();
        let cache = AccountSkinCache::new(&temp.path().join("config.json"));
        let mut invalid = account("first");
        for url in [
            "https://untrusted.invalid/texture/skin",
            "http://textures.minecraft.net/texture/skin",
            "https://user:secret@textures.minecraft.net/texture/skin",
            "https://textures.minecraft.net:8443/texture/skin",
        ] {
            invalid.skin_url = Some(url.into());
            assert!(
                cache
                    .skin_with(&invalid, || async {
                        panic!("unsafe addresses must not be fetched")
                    })
                    .await
                    .is_err()
            );
        }
        invalid = account("first");
        invalid.id = "../outside".into();
        assert!(
            cache
                .skin_with(&invalid, || async {
                    panic!("invalid identifiers must not reach cache paths")
                })
                .await
                .is_err()
        );
        assert!(!temp.path().join("account-skins").exists());
    }

    #[tokio::test]
    async fn missing_skins_return_none_and_malformed_first_downloads_are_not_cached() {
        let temp = tempfile::tempdir().unwrap();
        let cache = AccountSkinCache::new(&temp.path().join("config.json"));
        let mut no_skin = account("first");
        no_skin.skin_url = None;
        assert!(
            cache
                .skin_with(&no_skin, || async {
                    panic!("profiles without skins must not fetch")
                })
                .await
                .unwrap()
                .is_none()
        );
        for bytes in [
            b"invalid PNG".to_vec(),
            skin_png(64, 48),
            vec![0; 1024 * 1024 + 1],
        ] {
            assert!(
                cache
                    .skin_with(&account("first"), || async { Ok(bytes) })
                    .await
                    .is_err()
            );
        }
        let valid = cache
            .skin_with(&account("first"), || async { Ok(skin_png(64, 64)) })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            image::load_from_memory(&decode_data(&valid))
                .unwrap()
                .dimensions(),
            (64, 64)
        );
    }

    #[tokio::test]
    async fn concurrent_avatar_requests_share_the_same_in_flight_download() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.json");
        let first = AccountSkinCache::new(&config);
        let second = AccountSkinCache::new(&config);
        let account = account("shared");
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
        let (continue_tx, continue_rx) = tokio::sync::oneshot::channel::<()>();
        let first_read = first.skin_with(&account, || async {
            ready_tx.send(()).unwrap();
            continue_rx.await.unwrap();
            Ok(skin_png(64, 64))
        });
        tokio::pin!(first_read);
        tokio::select! {
            biased;
            result = &mut first_read => panic!("the first download must be waiting: {}", result.is_ok()),
            _ = ready_rx => {},
        }
        let second_read = second.skin_with(&account, || async {
            panic!("concurrent avatar requests must reuse the first download")
        });
        tokio::pin!(second_read);
        assert!(futures_util::poll!(&mut second_read).is_pending());
        continue_tx.send(()).unwrap();
        let (first, second) = tokio::join!(first_read, second_read);
        assert_eq!(first.unwrap(), second.unwrap());
    }

    #[tokio::test]
    async fn concurrent_avatar_requests_share_the_fallback_after_a_failed_download() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.json");
        let first = AccountSkinCache::new(&config);
        let previous = first
            .skin_with(&account("old"), || async { Ok(skin_png(64, 64)) })
            .await
            .unwrap();
        let second = AccountSkinCache::new(&config);
        let account = account("new");
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
        let (continue_tx, continue_rx) = tokio::sync::oneshot::channel::<()>();
        let first_read = first.skin_with(&account, || async {
            ready_tx.send(()).unwrap();
            continue_rx.await.unwrap();
            anyhow::bail!("service unavailable")
        });
        tokio::pin!(first_read);
        tokio::select! {
            biased;
            result = &mut first_read => panic!("the first request must be waiting: {}", result.is_ok()),
            _ = ready_rx => {},
        }
        let second_read = second.skin_with(&account, || async {
            panic!("queued avatar requests must reuse a failed request's fallback")
        });
        tokio::pin!(second_read);
        assert!(futures_util::poll!(&mut second_read).is_pending());
        continue_tx.send(()).unwrap();
        let (first, second) = tokio::join!(first_read, second_read);
        assert_eq!(first.unwrap(), previous);
        assert_eq!(second.unwrap(), previous);
    }
}
