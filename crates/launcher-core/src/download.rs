use std::{
    collections::{HashMap, VecDeque},
    error::Error,
    fmt,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, ensure};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, BufWriter},
    task::JoinSet,
};
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
        if cancellation.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let errors = errors.lock().expect("download errors poisoned");
        if !errors.is_empty() {
            let first = &errors[0];
            return Err(DownloadError::Failed(format!(
                "{} 个文件下载失败；{first}",
                errors.len()
            )));
        }
        let snapshot = progress.snapshot();
        Ok(DownloadSummary {
            total_files,
            downloaded_files: snapshot.downloaded_files,
            reused_files: snapshot.reused_files,
            transferred_bytes: snapshot.transferred_bytes,
        })
    }

    async fn download_artifact(
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
                    return Err(DownloadError::Cancelled);
                }
                Err(DownloadError::Failed(error)) => {
                    progress.end_attempt(id);
                    last_error = error;
                }
            }
            if attempt < self.options.max_retries {
                let delay = Duration::from_millis(250 * (1u64 << attempt.min(5)));
                tokio::select! {
                    biased;
                    () = cancellation.cancelled() => return Err(DownloadError::Cancelled),
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
        let flush = output.flush().await.context("无法完成下载临时文件写入");
        drop(output);
        let size = result?;
        flush?;
        if cancellation.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        temporary_path
            .persist(&artifact.target)
            .map_err(|error| anyhow::anyhow!("无法提交下载文件：{}", error.error))?;
        Ok(size)
    }
}

async fn validated_target_size(
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

enum ContentHash {
    None,
    Sha1(sha1::Sha1),
    Sha256(sha2::Sha256),
}

impl ContentHash {
    fn new(checksum: Option<&Checksum>) -> Self {
        match checksum {
            None => Self::None,
            Some(Checksum::Sha1(_)) => Self::Sha1(sha1::Sha1::new()),
            Some(Checksum::Sha256(_)) => Self::Sha256(sha2::Sha256::new()),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::None => {}
            Self::Sha1(hash) => hash.update(bytes),
            Self::Sha256(hash) => hash.update(bytes),
        }
    }

    fn matches(self, checksum: Option<&Checksum>) -> bool {
        match (self, checksum) {
            (Self::None, None) => true,
            (Self::Sha1(hash), Some(expected)) => {
                expected.matches(&format!("{:x}", hash.finalize()))
            }
            (Self::Sha256(hash), Some(expected)) => {
                expected.matches(&format!("{:x}", hash.finalize()))
            }
            _ => false,
        }
    }
}

struct ProgressState {
    progress: DownloadProgress,
    active: HashMap<usize, u64>,
    samples: VecDeque<(Instant, u64)>,
    started: Instant,
}

struct ProgressSink {
    state: Mutex<ProgressState>,
    emission: Mutex<Option<Instant>>,
    callback: Box<dyn Fn(DownloadProgress) + Send + Sync>,
}

impl ProgressSink {
    fn new(
        progress: DownloadProgress,
        callback: impl Fn(DownloadProgress) + Send + Sync + 'static,
    ) -> Self {
        Self {
            state: Mutex::new(ProgressState {
                progress,
                active: HashMap::new(),
                samples: VecDeque::new(),
                started: Instant::now(),
            }),
            emission: Mutex::new(None),
            callback: Box::new(callback),
        }
    }

    fn emit(&self) {
        self.emit_inner(false);
    }

    fn emit_inner(&self, force: bool) {
        let mut emission = self
            .emission
            .lock()
            .expect("download progress emission poisoned");
        if !force && emission.is_some_and(|last| last.elapsed() < Duration::from_millis(150)) {
            return;
        }
        (self.callback)(self.snapshot());
        *emission = Some(Instant::now());
    }

    fn snapshot(&self) -> DownloadProgress {
        let mut state = self.state.lock().expect("download progress poisoned");
        let now = Instant::now();
        while state
            .samples
            .front()
            .is_some_and(|(instant, _)| now.duration_since(*instant) >= Duration::from_secs(1))
        {
            state.samples.pop_front();
        }
        let recent_bytes: u64 = state.samples.iter().map(|(_, bytes)| bytes).sum();
        let seconds = now
            .duration_since(state.started)
            .as_secs_f64()
            .clamp(0.001, 1.0);
        state.progress.bytes_per_second = (recent_bytes as f64 / seconds) as u64;
        state.progress.clone()
    }

    fn begin(&self, id: usize, path: &Path) {
        {
            let mut state = self.state.lock().expect("download progress poisoned");
            state.active.insert(id, 0);
            state.progress.current_file = Some(display_file(path));
        }
        self.emit();
    }

    fn transferred(&self, id: usize, bytes: u64) {
        let mut state = self.state.lock().expect("download progress poisoned");
        *state.active.entry(id).or_default() += bytes;
        state.progress.active_bytes = state.progress.active_bytes.saturating_add(bytes);
        state.progress.transferred_bytes = state.progress.transferred_bytes.saturating_add(bytes);
        state.samples.push_back((Instant::now(), bytes));
        while state
            .samples
            .front()
            .is_some_and(|(instant, _)| instant.elapsed() >= Duration::from_secs(1))
        {
            state.samples.pop_front();
        }
    }

    fn end_attempt(&self, id: usize) {
        let mut state = self.state.lock().expect("download progress poisoned");
        let active = state.active.remove(&id).unwrap_or_default();
        state.progress.active_bytes = state.progress.active_bytes.saturating_sub(active);
    }

    fn completed(&self, id: usize, size: u64, reused: bool) {
        {
            let mut state = self.state.lock().expect("download progress poisoned");
            let active = state.active.remove(&id).unwrap_or_default();
            state.progress.active_bytes = state.progress.active_bytes.saturating_sub(active);
            state.progress.completed_files += 1;
            state.progress.completed_bytes = state.progress.completed_bytes.saturating_add(size);
            if reused {
                state.progress.reused_files += 1;
            } else {
                state.progress.downloaded_files += 1;
            }
        }
        self.emit();
    }

    fn failed(&self) {
        self.state
            .lock()
            .expect("download progress poisoned")
            .progress
            .failed_files += 1;
        self.emit();
    }

    fn finish(&self) {
        {
            let mut state = self.state.lock().expect("download progress poisoned");
            state.active.clear();
            state.progress.active_bytes = 0;
            state.progress.current_file = None;
        }
        self.emit_inner(true);
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
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::net::TcpListener;

    use super::*;

    fn test_options() -> NetworkOptions {
        NetworkOptions {
            max_concurrent_downloads: 2,
            max_retries: 1,
            timeout_seconds: 3,
            ..NetworkOptions::default()
        }
    }

    fn checksum(bytes: &[u8]) -> Checksum {
        Checksum::Sha256(format!("{:x}", sha2::Sha256::digest(bytes)))
    }

    async fn serve(
        responses: Vec<Vec<u8>>,
    ) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let server_count = count.clone();
        let server = tokio::spawn(async move {
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request).await;
                server_count.fetch_add(1, Ordering::SeqCst);
                let _ = stream.write_all(&response).await;
            }
        });
        (format!("http://{address}/file"), count, server)
    }

    fn response(bytes: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        )
        .into_bytes();
        response.extend_from_slice(bytes);
        response
    }

    #[tokio::test]
    async fn valid_files_are_reused_without_network_and_corrupt_files_retry() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("中文 空格.bin");
        let good = b"complete file";
        let bad = b"corrupt! file";
        assert_eq!(good.len(), bad.len());
        let (url, count, server) = serve(vec![response(bad), response(good)]).await;
        let artifact = Artifact {
            url,
            target: target.clone(),
            expected_size: Some(good.len() as u64),
            checksum: Some(checksum(good)),
        };
        let engine = DownloadEngine::new(test_options()).unwrap();
        let snapshots = Arc::new(Mutex::new(Vec::<DownloadProgress>::new()));
        let collected = snapshots.clone();
        let summary = engine
            .download(
                vec![artifact.clone()],
                CancellationToken::new(),
                move |value| {
                    collected.lock().unwrap().push(value);
                },
            )
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), good);
        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert_eq!(summary.transferred_bytes, (good.len() + bad.len()) as u64);
        let last = snapshots.lock().unwrap().last().unwrap().clone();
        assert_eq!(last.completed_bytes, good.len() as u64);
        assert_eq!(last.completed_files, 1);
        assert_eq!(last.active_bytes, 0);
        let reused = engine
            .download(vec![artifact], CancellationToken::new(), |_| {})
            .await
            .unwrap();
        assert_eq!(reused.reused_files, 1);
        assert_eq!(reused.transferred_bytes, 0);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn failed_download_preserves_existing_target_and_cleans_staging() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("existing.bin");
        std::fs::write(&target, b"previous contents").unwrap();
        let (url, _, server) = serve(vec![response(b"wrong"), response(b"wrong")]).await;
        let result = DownloadEngine::new(test_options())
            .unwrap()
            .download(
                vec![Artifact {
                    url,
                    target: target.clone(),
                    expected_size: Some(5),
                    checksum: Some(checksum(b"right")),
                }],
                CancellationToken::new(),
                |_| {},
            )
            .await;
        server.await.unwrap();
        assert!(matches!(result, Err(DownloadError::Failed(_))));
        assert_eq!(std::fs::read(&target).unwrap(), b"previous contents");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn cancellation_waits_for_cleanup_and_keeps_no_partial_target() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("cancelled.bin");
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/slow", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await;
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            for _ in 0..1024 {
                if stream.write_all(&[1u8; 1024]).await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        });
        let cancellation = CancellationToken::new();
        let cancel_from_callback = cancellation.clone();
        let result = DownloadEngine::new(test_options())
            .unwrap()
            .download(
                vec![Artifact {
                    url,
                    target: target.clone(),
                    expected_size: Some(1048576),
                    checksum: None,
                }],
                cancellation,
                move |progress| {
                    if progress.transferred_bytes > 0 {
                        cancel_from_callback.cancel();
                    }
                },
            )
            .await;
        assert!(matches!(result, Err(DownloadError::Cancelled)));
        assert!(!target.exists());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn truncated_stream_retries_and_identical_tasks_are_deduplicated() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("resumed.bin");
        let (url, count, server) = serve(vec![
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nab".to_vec(),
            response(b"abcde"),
        ])
        .await;
        let artifact = Artifact {
            url,
            target: target.clone(),
            expected_size: Some(5),
            checksum: Some(checksum(b"abcde")),
        };
        let summary = DownloadEngine::new(test_options())
            .unwrap()
            .download(
                vec![artifact.clone(), artifact],
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(summary.total_files, 1);
        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert_eq!(std::fs::read(target).unwrap(), b"abcde");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn downloads_respect_the_configured_concurrency_limit() {
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let server_active = active.clone();
        let server_maximum = maximum.clone();
        let server = tokio::spawn(async move {
            let mut requests = JoinSet::new();
            for _ in 0..6 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let active = server_active.clone();
                let maximum = server_maximum.clone();
                requests.spawn(async move {
                    let mut request = [0u8; 4096];
                    let _ = stream.read(&mut request).await;
                    let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(now, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    stream.write_all(&response(b"payload")).await.unwrap();
                    active.fetch_sub(1, Ordering::SeqCst);
                });
            }
            while let Some(result) = requests.join_next().await {
                result.unwrap();
            }
        });
        let artifacts = (0..6)
            .map(|index| Artifact {
                url: url.clone(),
                target: directory.path().join(format!("{index}.bin")),
                expected_size: Some(7),
                checksum: Some(checksum(b"payload")),
            })
            .collect();
        let summary = DownloadEngine::new(test_options())
            .unwrap()
            .download(artifacts, CancellationToken::new(), |_| {})
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(summary.downloaded_files, 6);
        assert_eq!(maximum.load(Ordering::SeqCst), 2);
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn server_errors_retry_and_sha1_game_artifacts_are_verified() {
        let directory = tempfile::tempdir().unwrap();
        let (url, count, server) = serve(vec![
            b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_vec(),
            response(b"minecraft artifact"),
        ])
        .await;
        let target = directory.path().join("game.jar");
        let result = DownloadEngine::new(test_options())
            .unwrap()
            .download(
                vec![Artifact {
                    url,
                    target: target.clone(),
                    expected_size: Some(18),
                    checksum: Some(Checksum::Sha1(format!(
                        "{:x}",
                        sha1::Sha1::digest(b"minecraft artifact")
                    ))),
                }],
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert_eq!(result.downloaded_files, 1);
        assert_eq!(std::fs::read(target).unwrap(), b"minecraft artifact");
    }

    #[tokio::test]
    async fn cancelling_a_queue_does_not_start_remaining_artifacts() {
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/slow", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let server_requests = requests.clone();
        let server_stop = CancellationToken::new();
        let server_token = server_stop.clone();
        let server = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                let connection = tokio::select! {
                    biased;
                    () = server_token.cancelled() => break,
                    connection = listener.accept() => connection.unwrap(),
                };
                let (mut stream, _) = connection;
                server_requests.fetch_add(1, Ordering::SeqCst);
                connections.spawn(async move {
                    let mut request = [0u8; 4096];
                    let _ = stream.read(&mut request).await;
                    if stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n").await.is_err() {
                        return;
                    }
                    for _ in 0..1024 {
                        if stream.write_all(&[1u8; 1024]).await.is_err() {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                });
            }
            while let Some(result) = connections.join_next().await {
                result.unwrap();
            }
        });
        let cancellation = CancellationToken::new();
        let callback_cancel = cancellation.clone();
        let artifacts = (0..20)
            .map(|index| Artifact {
                url: url.clone(),
                target: directory.path().join(format!("{index}.bin")),
                expected_size: Some(1048576),
                checksum: None,
            })
            .collect();
        let result = DownloadEngine::new(test_options())
            .unwrap()
            .download(artifacts, cancellation, move |progress| {
                if progress.transferred_bytes > 0 {
                    callback_cancel.cancel();
                }
            })
            .await;
        assert!(matches!(result, Err(DownloadError::Cancelled)));
        assert!((1..=2).contains(&requests.load(Ordering::SeqCst)));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        server_stop.cancel();
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
    }
}
