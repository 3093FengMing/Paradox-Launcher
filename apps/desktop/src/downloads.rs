//! Serialize queue execution, cancellation, progress, and terminal history.

mod execution;
mod request;
use execution::run_request;
pub use request::{DownloadKind, DownloadRequest, DownloadStatus, DownloadTask};

use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Context, Result, anyhow, ensure};
use paradox_core::download::DownloadProgress;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

const MAX_PENDING_TASKS: usize = 32;
const MAX_RETAINED_TASKS: usize = 100;

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
    pub fn original_request(&self, id: &str) -> Result<DownloadRequest> {
        let state = self.state.lock().map_err(|_| anyhow!("下载队列锁不可用"))?;
        state
            .entries
            .iter()
            .find(|entry| entry.task.id == id)
            .map(|entry| entry.request.clone())
            .context("下载任务不存在")
    }
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
            DownloadKind::Content => "正在检查内容版本、依赖与文件冲突",
            DownloadKind::Pack => "正在读取整合包并检查文件",
        }
        .into();
        Ok(Some(Work {
            id: entry.task.id.clone(),
            request: entry.request.clone(),
            cancellation: entry.cancellation.clone(),
        }))
    }

    fn run_queue(&self, app: &tauri::AppHandle, busy: &AtomicBool) -> Result<()> {
        // The serialized queue owns blocking file work and isolated installer
        // workers; SDK futures no longer require a non-Send compatibility bridge.
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
        // Cancellation is a request, not an execution result. A committed
        // success or recovery/cleanup failure can race with that request.
        match result {
            Ok(message) => {
                entry.task.status = DownloadStatus::Completed;
                entry.task.message = message;
            }
            Err(error) => {
                if matches!(
                    error
                        .root_cause()
                        .downcast_ref::<paradox_core::download::DownloadError>(),
                    Some(paradox_core::download::DownloadError::Cancelled)
                ) {
                    entry.task.status = DownloadStatus::Cancelled;
                    entry.task.message = "下载已取消".into();
                } else {
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

fn log(app: &tauri::AppHandle, level: &str, message: &str) {
    crate::commands::log(app, level, message);
}

fn new_task_id() -> String {
    use std::sync::atomic::AtomicU64;
    static NEXT_TASK: AtomicU64 = AtomicU64::new(1);
    format!("download-{}", NEXT_TASK.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests;
