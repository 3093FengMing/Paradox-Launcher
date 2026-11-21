//! Validate reusable targets and stream content checksums without buffering files.

use super::{Artifact, Checksum, DownloadError};
use anyhow::Context;
use sha2::Digest;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

pub(super) async fn validated_target_size(
    artifact: &Artifact,
    cancellation: &CancellationToken,
) -> std::result::Result<Option<u64>, DownloadError> {
    if cancellation.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    // Existence alone is insufficient evidence for a reusable download.
    if artifact.expected_size.is_none() && artifact.checksum.is_none() {
        return Ok(None);
    }
    let metadata = match tokio::fs::metadata(&artifact.target).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(anyhow::Error::from(error)
                .context("无法检查下载目标")
                .into());
        }
    };
    if !metadata.is_file()
        || artifact
            .expected_size
            .is_some_and(|size| size != metadata.len())
    {
        return Ok(None);
    }
    if artifact.checksum.is_none() {
        return Ok(Some(metadata.len()));
    }
    let mut file = tokio::fs::File::open(&artifact.target)
        .await
        .context("无法读取已有下载文件")?;
    let mut hash = ContentHash::new(artifact.checksum.as_ref());
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = tokio::select! {
            biased;
            () = cancellation.cancelled() => return Err(DownloadError::Cancelled),
            result = file.read(&mut buffer) => result.context("无法校验已有下载文件")?,
        };
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash
        .matches(artifact.checksum.as_ref())
        .then_some(metadata.len()))
}

pub(super) enum ContentHash {
    None,
    Sha1(sha1::Sha1),
    Sha256(sha2::Sha256),
}

impl ContentHash {
    pub(super) fn new(checksum: Option<&Checksum>) -> Self {
        match checksum {
            None => Self::None,
            Some(Checksum::Sha1(_)) => Self::Sha1(sha1::Sha1::new()),
            Some(Checksum::Sha256(_)) => Self::Sha256(sha2::Sha256::new()),
        }
    }

    pub(super) fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::None => {}
            Self::Sha1(hash) => hash.update(bytes),
            Self::Sha256(hash) => hash.update(bytes),
        }
    }

    pub(super) fn matches(self, checksum: Option<&Checksum>) -> bool {
        match (self, checksum) {
            (Self::None, None) => true,
            (Self::Sha1(hash), Some(expected)) => expected.matches(&hex::encode(hash.finalize())),
            (Self::Sha256(hash), Some(expected)) => expected.matches(&hex::encode(hash.finalize())),
            _ => false,
        }
    }
}
