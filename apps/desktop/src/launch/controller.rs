//! Serialize launch, cancellation and terminal publication with the busy slot.

use anyhow::{Result, anyhow};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LaunchPhase {
    Preparing,
    Running,
    Cancelling,
}

pub(super) struct LaunchSession {
    pub(super) phase: LaunchPhase,
    cancellation: CancellationToken,
    stop: mpsc::Sender<()>,
}

#[derive(Default)]
pub struct LaunchController {
    pub(super) session: Mutex<Option<LaunchSession>>,
}

pub(super) struct LaunchGuard {
    controller: Arc<LaunchController>,
    busy: Arc<AtomicBool>,
    completed: bool,
}

impl LaunchGuard {
    pub(super) fn finish(mut self, notify: impl FnOnce()) {
        let mut session = self
            .controller
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *session = None;
        self.busy.store(false, Ordering::Release);
        self.completed = true;
        // begin takes this lock before claiming busy, so a new launch can only
        // register after the previous terminal event has been published.
        notify();
    }
}

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        *self
            .controller
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
        self.busy.store(false, Ordering::Release);
    }
}

impl LaunchController {
    pub(super) fn begin(
        self: &Arc<Self>,
        busy: Arc<AtomicBool>,
    ) -> Result<(LaunchGuard, CancellationToken, mpsc::Receiver<()>)> {
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| anyhow!("已有安装或游戏进程正在运行"))?;
        let cancellation = CancellationToken::new();
        let (sender, receiver) = mpsc::channel(1);
        *session = Some(LaunchSession {
            phase: LaunchPhase::Preparing,
            cancellation: cancellation.clone(),
            stop: sender,
        });
        Ok((
            LaunchGuard {
                controller: Arc::clone(self),
                busy,
                completed: false,
            },
            cancellation,
            receiver,
        ))
    }

    pub fn is_active(&self) -> bool {
        self.session
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
    }

    pub fn request_stop(&self, notify: impl FnOnce()) -> Result<()> {
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let session = session
            .as_mut()
            .ok_or_else(|| anyhow!("没有运行中的游戏"))?;
        let changed = session.phase != LaunchPhase::Cancelling;
        if changed {
            session.phase = LaunchPhase::Cancelling;
            session.cancellation.cancel();
        }
        // A pending request already asks the supervisor to stop. After a failed
        // kill the channel is empty again, so another request retries the kill.
        match session.stop.try_send(()) {
            Ok(())
            | Err(mpsc::error::TrySendError::Full(()))
            | Err(mpsc::error::TrySendError::Closed(())) => {}
        }
        if changed {
            notify();
        }
        Ok(())
    }

    pub(super) fn announce_preparing(&self, notify: impl FnOnce()) {
        let session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if session
            .as_ref()
            .is_some_and(|session| session.phase == LaunchPhase::Preparing)
        {
            notify();
        }
    }

    pub(super) fn spawn_if_active<T>(
        &self,
        spawn: impl FnOnce() -> Result<T>,
    ) -> Result<Option<T>> {
        let session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let session = session
            .as_ref()
            .ok_or_else(|| anyhow!("没有运行中的游戏"))?;
        if session.cancellation.is_cancelled() {
            return Ok(None);
        }
        spawn().map(Some)
    }

    pub(super) fn announce_running(&self, notify: impl FnOnce()) -> bool {
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(session) = session.as_mut() else {
            return false;
        };
        if session.cancellation.is_cancelled() {
            return false;
        }
        session.phase = LaunchPhase::Running;
        notify();
        true
    }

    pub(super) fn stop_failed(&self, notify: impl FnOnce()) {
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(session) = session.as_mut() else {
            return;
        };
        // A newer pending stop still owns the Cancelling state. Otherwise let
        // the user retry while the supervisor retains ownership of the child.
        if session.stop.capacity() == 0 {
            return;
        }
        session.phase = LaunchPhase::Running;
        notify();
    }
}
