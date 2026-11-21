//! Schedule artifact downloads while owning every worker through its final result.

mod progress;
mod transfer;
mod validation;
use progress::ProgressSink;

use std::{
    collections::{HashMap, VecDeque},
    error::Error,
    fmt,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::network::NetworkOptions;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "algorithm", content = "value", rename_all = "lowercase")]
pub enum Checksum {
    Sha1(String),
    Sha256(String),
}

impl Checksum {
    fn validate(&self) -> Result<()> {
        let (value, length) = match self {
            Self::Sha1(value) => (value, 40),
            Self::Sha256(value) => (value, 64),
        };
        ensure!(
            value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "下载文件校验值格式无效"
        );
        Ok(())
    }

    fn matches(&self, actual: &str) -> bool {
        let expected = match self {
            Self::Sha1(value) | Self::Sha256(value) => value,
        };
        expected.eq_ignore_ascii_case(actual)
    }
}

#[derive(Clone, Debug)]
pub struct Artifact {
    pub url: String,
    pub target: PathBuf,
    pub expected_size: Option<u64>,
    pub checksum: Option<Checksum>,
}

impl Artifact {
    fn validate(&self) -> Result<()> {
        let url = reqwest::Url::parse(&self.url).context("下载地址格式无效")?;
        ensure!(
            matches!(url.scheme(), "http" | "https") && url.host_str().is_some(),
            "下载地址必须使用 http:// 或 https://"
        );
        ensure!(self.target.is_absolute(), "下载目标必须是绝对路径");
        ensure!(
            !self
                .target
                .components()
                .any(|part| part == Component::ParentDir),
            "下载目标不能包含上级目录跳转"
        );
        ensure!(self.target.file_name().is_some(), "下载目标必须是文件路径");
        if let Some(checksum) = &self.checksum {
            checksum.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct DownloadProgress {
    pub total_files: u32,
    pub completed_files: u32,
    pub downloaded_files: u32,
    pub reused_files: u32,
    pub failed_files: u32,
    /// Bytes actually received, including repeated transfers after a retry.
    pub transferred_bytes: u64,
    /// Bytes belonging to files whose final contents have been validated.
    pub completed_bytes: u64,
    /// Bytes in current attempts. Resets for a file when that attempt retries.
    pub active_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: u64,
    pub current_file: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct DownloadSummary {
    pub total_files: u32,
    pub downloaded_files: u32,
    pub reused_files: u32,
    pub transferred_bytes: u64,
}

#[derive(Debug)]
pub enum DownloadError {
    Cancelled,
    Failed(String),
}

impl fmt::Display for DownloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("下载已取消"),
            Self::Failed(message) => formatter.write_str(message),
        }
    }
}

impl Error for DownloadError {}

impl From<anyhow::Error> for DownloadError {
    fn from(error: anyhow::Error) -> Self {
        Self::Failed(format!("{error:#}"))
    }
}

#[derive(Clone)]
pub struct DownloadEngine {
    options: NetworkOptions,
    client: reqwest::Client,
}

impl DownloadEngine {
    pub fn new(options: NetworkOptions) -> Result<Self> {
        let client = options.build_client()?;
        Ok(Self { options, client })
    }

    /// The return value is delivered only after all workers have finished and
    /// their staging files have been closed and removed or committed.
    pub async fn download(
        &self,
        artifacts: Vec<Artifact>,
        cancellation: CancellationToken,
        on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
    ) -> std::result::Result<DownloadSummary, DownloadError> {
        let mut targets = HashMap::<PathBuf, usize>::new();
        let mut unique = Vec::<Artifact>::new();
        for artifact in artifacts {
            artifact.validate()?;
            let key = target_key(&artifact.target);
            if let Some(index) = targets.get(&key) {
                let previous = &unique[*index];
                if previous.url != artifact.url
                    || previous.expected_size != artifact.expected_size
                    || previous.checksum != artifact.checksum
                {
                    return Err(DownloadError::Failed(
                        "下载计划对同一目标包含冲突内容".into(),
                    ));
                }
                continue;
            }
            targets.insert(key, unique.len());
            unique.push(artifact);
        }
        let total_files = u32::try_from(unique.len()).context("下载计划文件数超出支持范围")?;
        let total_bytes = unique.iter().try_fold(0u64, |total, artifact| {
            total.checked_add(artifact.expected_size?)
        });
        let progress = Arc::new(ProgressSink::new(
            DownloadProgress {
                total_files,
                total_bytes,
                ..DownloadProgress::default()
            },
            on_progress,
        ));
        progress.emit();
        if cancellation.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let queue = Arc::new(Mutex::new(
            unique.into_iter().enumerate().collect::<VecDeque<_>>(),
        ));
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let reporter_stop = CancellationToken::new();
        let _reporter_guard = reporter_stop.clone().drop_guard();
        let reporter_token = reporter_stop.clone();
        let reporter_progress = progress.clone();
        let reporter = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(200));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    () = reporter_token.cancelled() => break,
                    _ = interval.tick() => reporter_progress.emit(),
                }
            }
        });
        let mut workers = JoinSet::new();
        let worker_count = self.options.max_concurrent_downloads.min(total_files);
        for _ in 0..worker_count {
            let engine = self.clone();
            let queue = queue.clone();
            let progress = progress.clone();
            let cancellation = cancellation.clone();
            let errors = errors.clone();
            workers.spawn(async move {
                loop {
                    if cancellation.is_cancelled() {
                        break;
                    }
                    let next = queue.lock().expect("download queue poisoned").pop_front();
                    let Some((id, artifact)) = next else {
                        break;
                    };
                    match engine
                        .download_artifact(id, &artifact, &cancellation, &progress)
                        .await
                    {
                        Ok(()) => {}
                        Err(DownloadError::Cancelled) => break,
                        Err(DownloadError::Failed(message)) => {
                            progress.failed();
                            errors
                                .lock()
                                .expect("download errors poisoned")
                                .push(message);
                        }
                    }
                }
            });
        }
        while let Some(result) = workers.join_next().await {
            if let Err(error) = result {
                errors
                    .lock()
                    .expect("download errors poisoned")
                    .push(format!("下载工作线程失败：{error}"));
            }
        }
        reporter_stop.cancel();
        let _ = reporter.await;
        progress.finish();
        let errors = errors.lock().expect("download errors poisoned");
        if !errors.is_empty() {
            let first = &errors[0];
            return Err(DownloadError::Failed(format!(
                "{} 个文件下载失败；{first}",
                errors.len()
            )));
        }
        let snapshot = progress.snapshot();
        // Cancellation can arrive from the final progress callback. Completed
        // files and collected failures are execution results, so preserve them.
        if cancellation.is_cancelled() && snapshot.completed_files != total_files {
            return Err(DownloadError::Cancelled);
        }
        Ok(DownloadSummary {
            total_files,
            downloaded_files: snapshot.downloaded_files,
            reused_files: snapshot.reused_files,
            transferred_bytes: snapshot.transferred_bytes,
        })
    }
}

fn display_file(path: &Path) -> String {
    path.file_name().map_or_else(
        || "下载文件".into(),
        |name| name.to_string_lossy().into_owned(),
    )
}

fn target_key(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests;
