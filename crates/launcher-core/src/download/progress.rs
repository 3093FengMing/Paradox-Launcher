//! Serialize progress snapshots and derive transfer rate from a recent window.

use super::{DownloadProgress, display_file};
use std::{
    collections::{HashMap, VecDeque},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};

struct ProgressState {
    progress: DownloadProgress,
    active: HashMap<usize, u64>,
    samples: VecDeque<(Instant, u64)>,
    started: Instant,
}

pub(super) struct ProgressSink {
    state: Mutex<ProgressState>,
    emission: Mutex<Option<Instant>>,
    callback: Box<dyn Fn(DownloadProgress) + Send + Sync>,
}

impl ProgressSink {
    pub(super) fn new(
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

    pub(super) fn emit(&self) {
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

    pub(super) fn snapshot(&self) -> DownloadProgress {
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

    pub(super) fn begin(&self, id: usize, path: &Path) {
        {
            let mut state = self.state.lock().expect("download progress poisoned");
            state.active.insert(id, 0);
            state.progress.current_file = Some(display_file(path));
        }
        self.emit();
    }

    pub(super) fn transferred(&self, id: usize, bytes: u64) {
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

    pub(super) fn end_attempt(&self, id: usize) {
        let mut state = self.state.lock().expect("download progress poisoned");
        let active = state.active.remove(&id).unwrap_or_default();
        state.progress.active_bytes = state.progress.active_bytes.saturating_sub(active);
    }

    pub(super) fn completed(&self, id: usize, size: u64, reused: bool) {
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

    pub(super) fn failed(&self) {
        self.state
            .lock()
            .expect("download progress poisoned")
            .progress
            .failed_files += 1;
        self.emit();
    }

    pub(super) fn finish(&self) {
        {
            let mut state = self.state.lock().expect("download progress poisoned");
            state.active.clear();
            state.progress.active_bytes = 0;
            state.progress.current_file = None;
        }
        self.emit_inner(true);
    }
}
