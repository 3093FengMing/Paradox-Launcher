use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Context, Result, anyhow, ensure};
use paradox_core::{
    AppConfig, ElementalService, GameProfile, Settings, download::DownloadProgress, java,
};
use serde::Serialize;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

const MAX_PENDING_TASKS: usize = 32;
const MAX_RETAINED_TASKS: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    Install,
    Java,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
}

impl DownloadStatus {
    fn is_pending(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Cancelling)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct DownloadTask {
    pub id: String,
    pub kind: DownloadKind,
    pub name: String,
    pub profile_key: Option<String>,
    pub java_major: Option<u32>,
    pub status: DownloadStatus,
    pub message: String,
    pub progress: Option<DownloadProgress>,
}

#[derive(Clone)]
#[expect(
    clippy::large_enum_variant,
    reason = "Requests own typed configuration snapshots and the queue has a fixed task limit."
)]
pub enum DownloadRequest {
    Install {
        config: AppConfig,
        profile: GameProfile,
    },
    Java {
        settings: Settings,
        major: u32,
        managed_root: PathBuf,
    },
}

impl DownloadRequest {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Install { config, profile } => {
                config.validate()?;
                profile.effective_settings(&config.settings)?;
            }
            Self::Java {
                settings,
                major,
                managed_root,
            } => {
                settings.validate()?;
                ensure!((8..=99).contains(major), "Java 下载版本无效");
                ensure!(java::download_supported(), "当前平台不支持 Java 自动下载");
                ensure!(managed_root.is_absolute(), "Java 存储目录必须是绝对路径");
            }
        }
        Ok(())
    }

    fn same_target(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Install { profile: left, .. }, Self::Install { profile: right, .. }) => {
                left.instance_key == right.instance_key
            }
            (Self::Java { major: left, .. }, Self::Java { major: right, .. }) => left == right,
            _ => false,
        }
    }

    fn task(&self) -> DownloadTask {
        let (kind, name, profile_key, java_major) = match self {
            Self::Install { profile, .. } => (
                DownloadKind::Install,
                profile.name.clone(),
                Some(profile.instance_key.clone()),
                None,
            ),
            Self::Java { major, .. } => (
                DownloadKind::Java,
                format!("Java {major}"),
                None,
                Some(*major),
            ),
        };
        DownloadTask {
            id: new_task_id(),
            kind,
            name,
            profile_key,
            java_major,
            status: DownloadStatus::Queued,
            message: "等待下载".into(),
            progress: None,
        }
    }
}

struct Entry {
    task: DownloadTask,
    request: DownloadRequest,
    cancellation: CancellationToken,
}

#[derive(Default)]
struct QueueState {
    entries: VecDeque<Entry>,
    worker_running: bool,
}

struct Work {
    id: String,
    request: DownloadRequest,
    cancellation: CancellationToken,
}

#[derive(Clone, Default)]
pub struct DownloadManager {
    state: Arc<Mutex<QueueState>>,
    emission: Arc<Mutex<()>>,
}

impl DownloadManager {
    pub fn list(&self) -> Result<Vec<DownloadTask>> {
        let state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        Ok(state
            .entries
            .iter()
            .map(|entry| entry.task.clone())
            .collect())
    }

    pub fn has_pending(&self) -> bool {
        self.state.lock().map_or(true, |state| {
            state
                .entries
                .iter()
                .any(|entry| entry.task.status.is_pending())
        })
    }

    pub fn enqueue(
        &self,
        app: tauri::AppHandle,
        request: DownloadRequest,
        busy: Arc<AtomicBool>,
    ) -> Result<DownloadTask> {
        request.validate()?;
        let (task, start_worker) = self.insert(request, &busy)?;
        self.publish(&app);
        if start_worker {
            let manager = self.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let result = catch_unwind(AssertUnwindSafe(|| manager.run_queue(&app, &busy)));
                let error = match result {
                    Ok(Ok(())) => return,
                    Ok(Err(error)) => format!("下载队列工作线程失败：{error:#}"),
                    Err(_) => "下载队列工作线程异常，队列已停止".into(),
                };
                manager.fail_pending(&error, &busy);
                manager.publish(&app);
                log(&app, "error", &error);
            });
        }
        Ok(task)
    }

    pub fn cancel(&self, id: &str, app: &tauri::AppHandle) -> Result<()> {
        let cancelled = self.cancel_task(id)?;
        self.publish(app);
        if let Some(task) = cancelled {
            log(app, "info", &format!("{}：{}", task.name, task.message));
        }
        Ok(())
    }

    pub fn retry(
        &self,
        id: &str,
        app: tauri::AppHandle,
        busy: Arc<AtomicBool>,
    ) -> Result<DownloadTask> {
        let request = self.retry_request(id)?;
        self.enqueue(app, request, busy)
    }

    fn retry_request(&self, id: &str) -> Result<DownloadRequest> {
        let state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        let entry = state
            .entries
            .iter()
            .find(|entry| entry.task.id == id)
            .context("下载任务不存在")?;
        ensure!(
            matches!(
                entry.task.status,
                DownloadStatus::Failed | DownloadStatus::Cancelled
            ),
            "只有失败或已取消的任务可以重试"
        );
        Ok(entry.request.clone())
    }

    pub fn cancel_all(&self, app: &tauri::AppHandle) {
        let cancelled = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            let mut cancelled = Vec::new();
            for entry in &mut state.entries {
                if entry.task.status.is_pending() {
                    entry.cancellation.cancel();
                    if entry.task.status == DownloadStatus::Queued {
                        entry.task.status = DownloadStatus::Cancelled;
                        entry.task.message = "排队任务已取消".into();
                        cancelled.push(entry.task.clone());
                    } else {
                        entry.task.status = DownloadStatus::Cancelling;
                        entry.task.message = "正在停止下载并清理临时文件".into();
                    }
                }
            }
            cancelled
        };
        self.publish(app);
        for task in cancelled {
            log(app, "info", &format!("{}：{}", task.name, task.message));
        }
    }

    fn insert(&self, request: DownloadRequest, busy: &AtomicBool) -> Result<(DownloadTask, bool)> {
        let mut state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        if let Some(existing) = state
            .entries
            .iter()
            .find(|entry| entry.task.status.is_pending() && entry.request.same_target(&request))
        {
            return Ok((existing.task.clone(), false));
        }
        ensure!(
            state
                .entries
                .iter()
                .filter(|entry| entry.task.status.is_pending())
                .count()
                < MAX_PENDING_TASKS,
            "下载队列已满，请等待或取消已有任务"
        );
        let start_worker = !state.worker_running;
        if start_worker {
            busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map_err(|_| anyhow!("游戏或其他任务正在运行，请结束后再下载"))?;
            state.worker_running = true;
        }
        while state.entries.len() >= MAX_RETAINED_TASKS {
            let Some(index) = state
                .entries
                .iter()
                .position(|entry| !entry.task.status.is_pending())
            else {
                break;
            };
            state.entries.remove(index);
        }
        let task = request.task();
        state.entries.push_back(Entry {
            task: task.clone(),
            request,
            cancellation: CancellationToken::new(),
        });
        Ok((task, start_worker))
    }

    fn cancel_task(&self, id: &str) -> Result<Option<DownloadTask>> {
        let mut state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        let entry = state
            .entries
            .iter_mut()
            .find(|entry| entry.task.id == id)
            .context("下载任务不存在")?;
        ensure!(entry.task.status.is_pending(), "下载任务已经结束");
        entry.cancellation.cancel();
        if entry.task.status == DownloadStatus::Queued {
            entry.task.status = DownloadStatus::Cancelled;
            entry.task.message = "排队任务已取消".into();
            Ok(Some(entry.task.clone()))
        } else {
            entry.task.status = DownloadStatus::Cancelling;
            entry.task.message = "正在停止下载并清理临时文件".into();
            Ok(None)
        }
    }

    fn take_next(&self, busy: &AtomicBool) -> Result<Option<Work>> {
        let mut state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        let Some(entry) = state
            .entries
            .iter_mut()
            .find(|entry| entry.task.status == DownloadStatus::Queued)
        else {
            // Serialize releasing busy with enqueue's claim. A previous worker
            // must not clear the flag after a new worker has already claimed it.
            state.worker_running = false;
            busy.store(false, Ordering::Release);
            return Ok(None);
        };
        entry.task.status = DownloadStatus::Running;
        entry.task.message = match entry.task.kind {
            DownloadKind::Install => "正在解析游戏文件与下载计划",
            DownloadKind::Java => "正在查询 Java 下载信息",
        }
        .into();
        Ok(Some(Work {
            id: entry.task.id.clone(),
            request: entry.request.clone(),
            cancellation: entry.cancellation.clone(),
        }))
    }

    fn run_queue(&self, app: &tauri::AppHandle, busy: &AtomicBool) -> Result<()> {
        // Elemental's non-Send futures are created and polled on this worker.
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .context("无法创建下载工作运行时")?;
        while let Some(work) = self.take_next(busy)? {
            self.publish(app);
            let manager = self.clone();
            let progress_app = app.clone();
            let progress_id = work.id.clone();
            let result = runtime.block_on(run_request(
                work.request,
                work.cancellation,
                move |progress| manager.update_progress(&progress_id, progress, &progress_app),
            ));
            let task = self.finish_task(&work.id, result)?;
            self.publish(app);
            log(
                app,
                if task.status == DownloadStatus::Failed {
                    "error"
                } else {
                    "info"
                },
                &format!("{}：{}", task.name, task.message),
            );
        }
        Ok(())
    }

    fn finish_task(&self, id: &str, result: Result<String>) -> Result<DownloadTask> {
        let mut state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        let entry = state
            .entries
            .iter_mut()
            .find(|entry| entry.task.id == id)
            .context("运行中的下载任务不存在")?;
        if entry.cancellation.is_cancelled() {
            entry.task.status = DownloadStatus::Cancelled;
            entry.task.message = "下载已取消，临时文件已清理".into();
        } else {
            match result {
                Ok(message) => {
                    entry.task.status = DownloadStatus::Completed;
                    entry.task.message = message;
                }
                Err(error) => {
                    entry.task.status = DownloadStatus::Failed;
                    entry.task.message = format!("{error:#}");
                }
            }
        }
        Ok(entry.task.clone())
    }

    fn update_progress(&self, id: &str, progress: DownloadProgress, app: &tauri::AppHandle) {
        {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            let Some(entry) = state.entries.iter_mut().find(|entry| entry.task.id == id) else {
                return;
            };
            if !matches!(
                entry.task.status,
                DownloadStatus::Running | DownloadStatus::Cancelling
            ) {
                return;
            }
            if entry.task.status == DownloadStatus::Running {
                entry.task.message = if progress.total_files > 0
                    && progress.completed_files == progress.total_files
                {
                    "文件已下载，正在完成安装".into()
                } else if progress.transferred_bytes == 0 && progress.reused_files > 0 {
                    "正在校验已有文件".into()
                } else if let Some(file) = &progress.current_file {
                    format!("正在下载：{file}")
                } else {
                    "正在准备下载".into()
                };
            }
            entry.task.progress = Some(progress);
        }
        self.publish(app);
    }

    fn fail_pending(&self, message: &str, busy: &AtomicBool) {
        // Recover only for worker-failure cleanup so shutdown cannot remain
        // permanently blocked by a poisoned queue after an unexpected panic.
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for entry in &mut state.entries {
            if entry.task.status.is_pending() {
                entry.cancellation.cancel();
                entry.task.status = DownloadStatus::Failed;
                entry.task.message = message.into();
            }
        }
        state.worker_running = false;
        busy.store(false, Ordering::Release);
        self.state.clear_poison();
    }

    fn publish(&self, app: &tauri::AppHandle) {
        // Snapshot after acquiring the emission lock. Concurrent completion and
        // cancellation events cannot publish older state after newer state.
        let Ok(_emission) = self.emission.lock() else {
            return;
        };
        if let Ok(tasks) = self.list() {
            let _ = app.emit("launcher://downloads", tasks);
        }
    }
}

async fn run_request(
    request: DownloadRequest,
    cancellation: CancellationToken,
    on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<String> {
    match request {
        DownloadRequest::Install { config, profile } => {
            let settings = profile.effective_settings(&config.settings)?;
            ElementalService::new(&settings)?
                .prepare_with_progress(&profile, cancellation, on_progress)
                .await?;
            Ok("实例安装 / 修复完成".into())
        }
        DownloadRequest::Java {
            settings,
            major,
            managed_root,
        } => {
            let package = tokio::select! {
                biased;
                () = cancellation.cancelled() => return Err(anyhow!("Java 下载已取消")),
                package = java::resolve_package(major, &settings.network) => package?,
            };
            let installation = java::download_and_install(
                &package,
                &managed_root,
                settings.network,
                cancellation,
                on_progress,
            )
            .await?;
            Ok(format!(
                "Java {} 已安装：{}",
                installation.major_version,
                installation.executable.display()
            ))
        }
    }
}

#[derive(Serialize, Clone)]
struct LogEvent<'a> {
    level: &'a str,
    message: &'a str,
}

fn log(app: &tauri::AppHandle, level: &str, message: &str) {
    let _ = app.emit("launcher://log", LogEvent { level, message });
}

fn new_task_id() -> String {
    use std::sync::atomic::AtomicU64;
    static NEXT_TASK: AtomicU64 = AtomicU64::new(1);
    format!("download-{}", NEXT_TASK.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(name: &str) -> DownloadRequest {
        DownloadRequest::Install {
            config: AppConfig::default(),
            profile: GameProfile::new(name, "1.21.1").unwrap(),
        }
    }

    #[test]
    fn queue_claims_busy_once_and_deduplicates_pending_targets() {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        let first_request = request("first");
        let (first, start) = manager.insert(first_request.clone(), &busy).unwrap();
        assert!(start);
        assert!(busy.load(Ordering::Acquire));
        let (duplicate, start) = manager.insert(first_request, &busy).unwrap();
        assert!(!start);
        assert_eq!(first.id, duplicate.id);
        let (_, start) = manager.insert(request("second"), &busy).unwrap();
        assert!(!start);
        assert_eq!(manager.list().unwrap().len(), 2);
        assert!(
            busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        );
    }

    #[test]
    fn game_busy_rejects_the_first_download_without_mutating_queue() {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(true);
        assert!(manager.insert(request("first"), &busy).is_err());
        assert!(manager.list().unwrap().is_empty());
        assert!(!manager.has_pending());
    }

    #[test]
    fn queued_cancellation_preserves_fifo_and_busy_until_the_queue_drains() {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        let (first, _) = manager.insert(request("first"), &busy).unwrap();
        let (second, _) = manager.insert(request("second"), &busy).unwrap();
        let (third, _) = manager.insert(request("third"), &busy).unwrap();
        manager.cancel_task(&second.id).unwrap();
        let work = manager.take_next(&busy).unwrap().unwrap();
        assert_eq!(work.id, first.id);
        manager.finish_task(&work.id, Ok("done".into())).unwrap();
        assert!(busy.load(Ordering::Acquire));
        let work = manager.take_next(&busy).unwrap().unwrap();
        assert_eq!(work.id, third.id);
        manager.finish_task(&work.id, Ok("done".into())).unwrap();
        assert!(manager.take_next(&busy).unwrap().is_none());
        assert!(!busy.load(Ordering::Acquire));
        assert!(!manager.has_pending());
        let (_, start) = manager.insert(request("fourth"), &busy).unwrap();
        assert!(start);
    }

    #[test]
    fn running_cancellation_keeps_busy_until_safe_completion() {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        let (task, _) = manager.insert(request("first"), &busy).unwrap();
        let work = manager.take_next(&busy).unwrap().unwrap();
        assert!(manager.cancel_task(&task.id).unwrap().is_none());
        assert!(work.cancellation.is_cancelled());
        assert_eq!(
            manager.list().unwrap()[0].status,
            DownloadStatus::Cancelling
        );
        assert!(manager.has_pending());
        assert!(busy.load(Ordering::Acquire));
        let task = manager
            .finish_task(&work.id, Err(anyhow!("cancelled")))
            .unwrap();
        assert_eq!(task.status, DownloadStatus::Cancelled);
        assert!(manager.take_next(&busy).unwrap().is_none());
        assert!(!busy.load(Ordering::Acquire));
    }

    #[test]
    fn retries_create_a_new_attempt_behind_existing_queued_work() {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        let (failed, _) = manager.insert(request("first"), &busy).unwrap();
        assert!(manager.retry_request(&failed.id).is_err());
        let work = manager.take_next(&busy).unwrap().unwrap();
        manager
            .finish_task(&work.id, Err(anyhow!("network failed")))
            .unwrap();
        let (second, _) = manager.insert(request("second"), &busy).unwrap();
        let (retry, _) = manager
            .insert(manager.retry_request(&failed.id).unwrap(), &busy)
            .unwrap();
        assert_ne!(retry.id, failed.id);
        assert_eq!(retry.profile_key, failed.profile_key);
        let work = manager.take_next(&busy).unwrap().unwrap();
        assert_eq!(work.id, second.id);
        manager.finish_task(&work.id, Ok("done".into())).unwrap();
        assert_eq!(manager.take_next(&busy).unwrap().unwrap().id, retry.id);
        assert_eq!(manager.list().unwrap()[0].status, DownloadStatus::Failed);
    }

    #[test]
    fn pending_capacity_and_terminal_history_are_bounded() {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        for index in 0..MAX_PENDING_TASKS {
            manager.insert(request(&index.to_string()), &busy).unwrap();
        }
        assert!(manager.insert(request("overflow"), &busy).is_err());
        while let Some(work) = manager.take_next(&busy).unwrap() {
            manager.finish_task(&work.id, Ok("done".into())).unwrap();
        }
        for index in 0..MAX_RETAINED_TASKS + 5 {
            manager
                .insert(request(&format!("later-{index}")), &busy)
                .unwrap();
            let work = manager.take_next(&busy).unwrap().unwrap();
            manager.finish_task(&work.id, Ok("done".into())).unwrap();
            assert!(manager.take_next(&busy).unwrap().is_none());
        }
        assert_eq!(manager.list().unwrap().len(), MAX_RETAINED_TASKS);
        assert!(!manager.has_pending());
    }
}
