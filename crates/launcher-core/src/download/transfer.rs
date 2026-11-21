//! Retry one artifact, commit validated staging, and preserve cleanup failures.

use super::{
    Artifact, DownloadEngine, DownloadError, display_file,
    progress::ProgressSink,
    validation::{ContentHash, validated_target_size},
};
use anyhow::{Context, ensure};
use futures_util::StreamExt;
use std::time::Duration;
use tokio::io::{AsyncWrite, AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;

impl DownloadEngine {
    pub(super) async fn download_artifact(
        &self,
        id: usize,
        artifact: &Artifact,
        cancellation: &CancellationToken,
        progress: &ProgressSink,
    ) -> std::result::Result<(), DownloadError> {
        if let Some(size) = validated_target_size(artifact, cancellation).await? {
            progress.completed(id, size, true);
            return Ok(());
        }
        let mut last_error = String::new();
        for attempt in 0..=self.options.max_retries {
            if cancellation.is_cancelled() {
                if !last_error.is_empty() {
                    break;
                }
                return Err(DownloadError::Cancelled);
            }
            progress.begin(id, &artifact.target);
            match self.transfer(id, artifact, cancellation, progress).await {
                Ok(size) => {
                    progress.completed(id, size, false);
                    return Ok(());
                }
                Err(DownloadError::Cancelled) => {
                    progress.end_attempt(id);
                    if !last_error.is_empty() {
                        break;
                    }
                    return Err(DownloadError::Cancelled);
                }
                Err(DownloadError::Failed(error)) => {
                    progress.end_attempt(id);
                    last_error = error;
                    if cancellation.is_cancelled() {
                        break;
                    }
                }
            }
            if attempt < self.options.max_retries {
                let delay = Duration::from_millis(250 * (1u64 << attempt.min(5)));
                tokio::select! {
                    biased;
                    () = cancellation.cancelled() => break,
                    () = tokio::time::sleep(delay) => {}
                }
            }
        }
        Err(DownloadError::Failed(format!(
            "{}：{last_error}",
            display_file(&artifact.target)
        )))
    }

    async fn transfer(
        &self,
        id: usize,
        artifact: &Artifact,
        cancellation: &CancellationToken,
        progress: &ProgressSink,
    ) -> std::result::Result<u64, DownloadError> {
        let parent = artifact.target.parent().context("下载目标没有父目录")?;
        tokio::select! {
            biased;
            () = cancellation.cancelled() => return Err(DownloadError::Cancelled),
            result = tokio::fs::create_dir_all(parent) => result.context("无法创建下载目录")?,
        }
        let temporary = tempfile::Builder::new()
            .prefix(".paradox-download-")
            .suffix(".part")
            .tempfile_in(parent)
            .context("无法创建下载临时文件")?;
        let (file, temporary_path) = temporary.into_parts();
        let mut output = BufWriter::with_capacity(128 * 1024, tokio::fs::File::from_std(file));
        let transfer = async {
            let response = self
                .client
                .get(&artifact.url)
                .send()
                .await
                .context("请求下载文件失败")?
                .error_for_status()
                .context("服务器返回下载错误")?;
            let mut stream = response.bytes_stream();
            let mut hash = ContentHash::new(artifact.checksum.as_ref());
            let mut size = 0u64;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.context("下载连接中断")?;
                size = size
                    .checked_add(chunk.len() as u64)
                    .context("下载文件过大")?;
                progress.transferred(id, chunk.len() as u64);
                if let Some(expected) = artifact.expected_size {
                    ensure!(size <= expected, "下载内容超过预期文件大小");
                }
                hash.update(&chunk);
                output.write_all(&chunk).await.context("无法写入下载文件")?;
            }
            output.flush().await.context("无法刷新下载文件")?;
            if let Some(expected) = artifact.expected_size {
                ensure!(
                    size == expected,
                    "下载文件大小不匹配：预期 {expected}，实际 {size}"
                );
            }
            ensure!(hash.matches(artifact.checksum.as_ref()), "下载文件校验失败");
            Ok::<_, anyhow::Error>(size)
        };
        let result = tokio::select! {
            biased;
            () = cancellation.cancelled() => Err(DownloadError::Cancelled),
            result = transfer => result.map_err(DownloadError::from),
        };
        // Await any in-flight Tokio file write before dropping its Windows
        // handle. A cancelled transfer may still have a buffered write.
        let result = finish_transfer_output(output, result).await;
        let size = match result {
            Ok(size) if !cancellation.is_cancelled() => size,
            Ok(_) => return Err(discard_temporary(temporary_path, DownloadError::Cancelled)),
            Err(error) => return Err(discard_temporary(temporary_path, error)),
        };
        if let Err(error) = temporary_path.persist(&artifact.target) {
            return Err(discard_temporary(
                error.path,
                DownloadError::Failed(format!("无法提交下载文件：{}", error.error)),
            ));
        }
        Ok(size)
    }
}

/// Join the writer before classifying cancellation, and retain both execution
/// and flush errors when they fail together.
pub(super) async fn finish_transfer_output(
    mut output: impl AsyncWrite + Unpin,
    result: std::result::Result<u64, DownloadError>,
) -> std::result::Result<u64, DownloadError> {
    let flush = output.flush().await.context("无法完成下载临时文件写入");
    drop(output);
    match flush {
        Ok(()) => result,
        Err(error) => Err(append_failure(result.err(), error)),
    }
}

fn append_failure(previous: Option<DownloadError>, error: anyhow::Error) -> DownloadError {
    DownloadError::Failed(match previous {
        Some(DownloadError::Failed(previous)) => format!("{previous}；{error:#}"),
        _ => format!("{error:#}"),
    })
}

pub(super) fn discard_temporary(path: tempfile::TempPath, result: DownloadError) -> DownloadError {
    match path.close().context("无法移除下载临时文件") {
        Ok(()) => result,
        Err(error) => append_failure(Some(result), error),
    }
}
