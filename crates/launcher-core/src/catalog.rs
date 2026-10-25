use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};

use crate::GameVersion;

const CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_CACHE_BYTES: u64 = 8 * 1024 * 1024;
pub const DEFAULT_CATALOG_TTL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource {
    Network,
    Cache,
}

/// The timestamp uses Unix seconds so the desktop and web preview can share it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CatalogSnapshot {
    pub versions: Vec<GameVersion>,
    pub fetched_at: u64,
    pub source: CatalogSource,
    pub stale: bool,
}

impl CatalogSnapshot {
    pub fn network(versions: Vec<GameVersion>) -> Result<Self> {
        validate_versions(&versions)?;
        Ok(Self {
            versions,
            fetched_at: unix_seconds()?,
            source: CatalogSource::Network,
            stale: false,
        })
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct StoredCatalog {
    schema_version: u32,
    fetched_at: u64,
    versions: Vec<GameVersion>,
}

#[derive(Clone, Debug)]
pub struct CatalogCache {
    path: PathBuf,
    ttl: Duration,
}

impl CatalogCache {
    pub fn new(path: impl Into<PathBuf>, ttl: Duration) -> Self {
        Self {
            path: path.into(),
            ttl,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// A stale cache is returned explicitly, allowing a caller to fall back to
    /// it after a network error. Invalid files are reported and left untouched.
    pub fn load(&self) -> Result<Option<CatalogSnapshot>> {
        self.load_at(unix_seconds()?)
    }

    fn load_at(&self, now: u64) -> Result<Option<CatalogSnapshot>> {
        let metadata = match fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("无法读取版本目录缓存"),
        };
        ensure!(metadata.len() <= MAX_CACHE_BYTES, "版本目录缓存大小异常");
        let contents = fs::read(&self.path).context("无法读取版本目录缓存")?;
        let stored: StoredCatalog =
            serde_json::from_slice(&contents).context("版本目录缓存损坏")?;
        ensure!(
            stored.schema_version == CACHE_SCHEMA_VERSION,
            "不支持的版本目录缓存格式"
        );
        validate_versions(&stored.versions)?;
        // A future timestamp can follow a system clock adjustment. Treat it as
        // stale instead of allowing an unbounded fresh-cache period.
        let stale =
            stored.fetched_at > now || now.saturating_sub(stored.fetched_at) >= self.ttl.as_secs();
        Ok(Some(CatalogSnapshot {
            versions: stored.versions,
            fetched_at: stored.fetched_at,
            source: CatalogSource::Cache,
            stale,
        }))
    }

    /// Validate before creating the temporary file, then atomically replace the
    /// previous cache. A cache write error does not invalidate a network result.
    pub fn save(&self, snapshot: &CatalogSnapshot) -> Result<()> {
        validate_versions(&snapshot.versions)?;
        let parent = self.path.parent().context("缓存路径没有父目录")?;
        fs::create_dir_all(parent).context("无法创建版本目录缓存目录")?;
        let stored = StoredCatalog {
            schema_version: CACHE_SCHEMA_VERSION,
            fetched_at: snapshot.fetched_at,
            versions: snapshot.versions.clone(),
        };
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer(&mut temporary, &stored)?;
        temporary.write_all(b"\n")?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&self.path)
            .context("无法原子替换版本目录缓存")?;
        Ok(())
    }
}

fn unix_seconds() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("系统时间早于 Unix 纪元")?
        .as_secs())
}

fn validate_versions(versions: &[GameVersion]) -> Result<()> {
    ensure!(
        !versions.is_empty() && versions.len() <= 50_000,
        "版本目录为空或数量异常"
    );
    ensure!(
        versions.iter().all(|version| {
            !version.id.is_empty()
                && version.id.len() <= 160
                && !version.id.chars().any(char::is_control)
                && !version.kind.is_empty()
                && version.kind.len() <= 40
                && !version.kind.chars().any(char::is_control)
        }),
        "版本目录包含无效条目"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(fetched_at: u64) -> CatalogSnapshot {
        CatalogSnapshot {
            versions: vec![GameVersion {
                id: "1.21.1".into(),
                kind: "release".into(),
            }],
            fetched_at,
            source: CatalogSource::Network,
            stale: false,
        }
    }

    #[test]
    fn cache_expires_at_ttl_and_marks_future_timestamps_stale() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CatalogCache::new(
            directory.path().join("catalog.json"),
            Duration::from_secs(60),
        );
        cache.save(&snapshot(100)).unwrap();
        let fresh = cache.load_at(159).unwrap().unwrap();
        assert!(!fresh.stale);
        assert_eq!(fresh.source, CatalogSource::Cache);
        assert_eq!(fresh.versions[0].id, "1.21.1");
        assert!(cache.load_at(160).unwrap().unwrap().stale);
        assert!(cache.load_at(99).unwrap().unwrap().stale);
    }

    #[test]
    fn corrupt_cache_is_preserved_and_can_be_replaced_by_valid_network_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("catalog.json");
        let cache = CatalogCache::new(&path, DEFAULT_CATALOG_TTL);
        fs::write(&path, b"{invalid}").unwrap();
        assert!(cache.load_at(100).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{invalid}");
        cache.save(&snapshot(100)).unwrap();
        assert_eq!(cache.load_at(101).unwrap().unwrap().versions.len(), 1);
    }

    #[test]
    fn missing_cache_returns_none_and_invalid_results_preserve_saved_data() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CatalogCache::new(
            directory.path().join("cache/catalog.json"),
            DEFAULT_CATALOG_TTL,
        );
        assert!(cache.load_at(100).unwrap().is_none());
        cache.save(&snapshot(100)).unwrap();
        let mut invalid = snapshot(200);
        invalid.versions.clear();
        assert!(cache.save(&invalid).is_err());
        assert_eq!(cache.load_at(201).unwrap().unwrap().fetched_at, 100);
    }

    #[test]
    fn unknown_cache_schema_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("catalog.json");
        let cache = CatalogCache::new(&path, DEFAULT_CATALOG_TTL);
        let data = StoredCatalog {
            schema_version: 999,
            fetched_at: 100,
            versions: snapshot(100).versions,
        };
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        assert!(cache.load_at(101).is_err());
    }
}
