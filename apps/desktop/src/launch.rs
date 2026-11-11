use std::{
    future::Future,
    panic::{AssertUnwindSafe, catch_unwind},
    path::Path,
    process::ExitStatus,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Result, anyhow};
use paradox_core::{AppConfig, ElementalService, GameProfile, accounts::AccountsManager};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    AppState,
    commands::{activity, java, log, profile, sdk_runtime, snapshot},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LaunchPhase {
    Preparing,
    Running,
    Cancelling,
}

struct LaunchSession {
    phase: LaunchPhase,
    cancellation: CancellationToken,
    stop: mpsc::Sender<()>,
}

#[derive(Default)]
pub struct LaunchController {
    session: Mutex<Option<LaunchSession>>,
}

struct LaunchGuard {
    controller: Arc<LaunchController>,
    busy: Arc<AtomicBool>,
    completed: bool,
}

impl LaunchGuard {
    fn finish(mut self, notify: impl FnOnce()) {
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
    fn begin(
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

    fn announce_preparing(&self, notify: impl FnOnce()) {
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

    fn spawn_if_active<T>(&self, spawn: impl FnOnce() -> Result<T>) -> Result<Option<T>> {
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

    fn announce_running(&self, notify: impl FnOnce()) -> bool {
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

    fn stop_failed(&self, notify: impl FnOnce()) {
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

fn finish_credentials<T>(
    credential: Result<T>,
    cancellation: &CancellationToken,
) -> Result<Option<T>> {
    match credential {
        Err(error) if error.root_cause().to_string() == "auth.errors.cancelled" => Ok(None),
        Err(error) => Err(error),
        Ok(_) if cancellation.is_cancelled() => Ok(None),
        Ok(credential) => Ok(Some(credential)),
    }
}

async fn prepare_until_cancelled<T>(
    cancellation: &CancellationToken,
    preparation: impl Future<Output = Result<T>>,
) -> Result<Option<T>> {
    tokio::select! {
        biased;
        () = cancellation.cancelled() => Ok(None),
        result = preparation => result.map(Some),
    }
}

pub fn start(key: &str, app: tauri::AppHandle, state: &AppState) -> Result<()> {
    let controller = Arc::clone(&state.launch);
    let (guard, cancellation, stop) = controller.begin(Arc::clone(&state.busy))?;
    let config = snapshot(state).map_err(anyhow::Error::msg)?;
    let profile = profile(&config, key).map_err(anyhow::Error::msg)?;
    let managed_runtime_root = java::managed_root(state);
    let accounts = Arc::clone(&state.accounts);
    controller
        .announce_preparing(|| activity(&app, "launch", "started", "正在检查 Java 并构建启动命令"));
    tauri::async_runtime::spawn_blocking(move || {
        let result = catch_unwind(AssertUnwindSafe(|| {
            run_game(
                &app,
                &config,
                &profile,
                &managed_runtime_root,
                &accounts,
                &controller,
                &cancellation,
                stop,
            )
        }))
        .unwrap_or_else(|_| Err(anyhow!("启动工作线程异常退出")));
        guard.finish(|| report_exit(&app, result));
    });
    Ok(())
}

pub fn request_stop(app: &tauri::AppHandle, controller: &LaunchController) -> Result<()> {
    controller.request_stop(|| activity(app, "launch", "cancelling", "正在停止启动或游戏进程"))
}

enum LaunchExit {
    Cancelled,
    Exited(GameExit),
}

struct GameExit {
    status: ExitStatus,
    stopped: bool,
}

#[allow(clippy::too_many_arguments)]
fn run_game(
    app: &tauri::AppHandle,
    config: &AppConfig,
    profile: &GameProfile,
    managed_runtime_root: &Path,
    accounts: &AccountsManager,
    controller: &LaunchController,
    cancellation: &CancellationToken,
    mut stop: mpsc::Receiver<()>,
) -> Result<LaunchExit> {
    let runtime = sdk_runtime()?;
    if cancellation.is_cancelled() {
        return Ok(LaunchExit::Cancelled);
    }
    let effective = profile.effective_settings(&config.settings)?;
    let service = ElementalService::new(&effective)?;
    // Refresh persists rotating credentials cooperatively before returning.
    // Dropping that future at cancellation could lose the replacement token.
    let credential =
        runtime.block_on(accounts.selected_credential(&effective.network, cancellation));
    let Some(credential) = finish_credentials(credential, cancellation)? else {
        return Ok(LaunchExit::Cancelled);
    };
    let secret = credential
        .as_ref()
        .map(|credential| credential.access_token.clone());
    let result = (|| {
        let prepared = runtime.block_on(prepare_until_cancelled(
            cancellation,
            service.prepare_authenticated_launch(
                profile,
                &effective,
                managed_runtime_root,
                credential,
            ),
        ))?;
        let Some(prepared) = prepared else {
            return Ok(LaunchExit::Cancelled);
        };
        let process = {
            let _entered = runtime.enter();
            controller.spawn_if_active(|| prepared.spawn())?
        };
        let Some(mut process) = process else {
            return Ok(LaunchExit::Cancelled);
        };
        supervise_owned(
            &runtime,
            controller,
            &mut process.child,
            &mut process.lines,
            &mut stop,
            |line| &line.line,
            |event| match event {
                ProcessEvent::Running => {
                    controller.announce_running(|| {
                        activity(
                            app,
                            "launch",
                            "running",
                            &format!("{} 已启动", profile.name),
                        )
                    });
                }
                ProcessEvent::StopFailed => controller
                    .stop_failed(|| activity(app, "launch", "running", "停止游戏失败，请重试")),
                ProcessEvent::Log(level, message) => {
                    log(app, level, &redact(message, secret.as_deref()))
                }
            },
        )
        .map(LaunchExit::Exited)
    })();
    redact_failure(result, secret.as_deref())
}

enum ProcessEvent<'a> {
    Running,
    StopFailed,
    Log(&'a str, &'a str),
}

fn supervise_owned<P: GameProcess, L>(
    runtime: &tokio::runtime::Runtime,
    controller: &LaunchController,
    child: &mut P,
    lines: &mut mpsc::UnboundedReceiver<L>,
    stop: &mut mpsc::Receiver<()>,
    line_text: impl Fn(&L) -> &str,
    emit: impl Fn(ProcessEvent<'_>),
) -> Result<GameExit> {
    // The worker owns the child outside every unwinding future, including the
    // initial running announcement. Cleanup must reap it before releasing busy.
    let mut announce = true;
    let mut supervision_error = None;
    loop {
        let result = catch_unwind(AssertUnwindSafe(|| {
            if announce {
                announce = false;
                emit(ProcessEvent::Running);
            }
            runtime.block_on(supervise_process(
                child,
                lines,
                stop,
                &line_text,
                |level, message| emit(ProcessEvent::Log(level, message)),
                || emit(ProcessEvent::StopFailed),
            ))
        }));
        match result {
            Ok(Ok(exit)) => return supervision_error.map_or(Ok(exit), Err),
            Ok(Err(error)) => {
                supervision_error = Some(error);
                let _ = controller.request_stop(|| {});
                // Retry failed waits without a tight error loop or dropping
                // ownership. The close path retains its 15-second deadline.
                runtime.block_on(async {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                });
            }
            Err(_) => {
                supervision_error = Some(anyhow!("游戏进程监督线程异常退出"));
                let _ = controller.request_stop(|| {});
            }
        }
    }
}

trait GameProcess {
    fn wait(&mut self) -> impl Future<Output = std::io::Result<ExitStatus>>;
    fn kill(&mut self) -> impl Future<Output = std::io::Result<()>>;
}

impl GameProcess for paradox_core::process::OwnedChild {
    async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.wait().await
    }
    async fn kill(&mut self) -> std::io::Result<()> {
        self.kill().await
    }
}

impl GameProcess for tokio::process::Child {
    async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.wait().await
    }
    async fn kill(&mut self) -> std::io::Result<()> {
        paradox_core::process::kill_process_tree(self).await
    }
}

async fn supervise_process<P, L>(
    child: &mut P,
    lines: &mut mpsc::UnboundedReceiver<L>,
    stop: &mut mpsc::Receiver<()>,
    line_text: impl Fn(&L) -> &str,
    log_line: impl Fn(&str, &str),
    stop_failed: impl Fn(),
) -> Result<GameExit>
where
    P: GameProcess,
{
    let mut lines_open = true;
    let mut stop_open = true;
    let mut stopped = false;
    let status = loop {
        tokio::select! {
            biased;
            request = stop.recv(), if stop_open => {
                match request {
                    Some(()) => match child.kill().await {
                        Ok(()) => { stopped = true; log_line("info", "已停止游戏进程"); }
                        Err(error) => {
                            log_line("error", &format!("停止游戏失败：{error}"));
                            stop_failed();
                        }
                    },
                    None => stop_open = false,
                }
            }
            exit = child.wait() => break exit?,
            line = lines.recv(), if lines_open => match line {
                Some(line) => log_line("game", line_text(&line)),
                None => lines_open = false,
            },
        }
    };
    while let Ok(line) = lines.try_recv() {
        log_line("game", line_text(&line));
    }
    Ok(GameExit { status, stopped })
}

fn redact(line: &str, secret: Option<&str>) -> String {
    match secret {
        Some(token) if !token.is_empty() => line.replace(token, "[REDACTED]"),
        _ => line.to_owned(),
    }
}

fn redact_failure<T>(result: Result<T>, secret: Option<&str>) -> Result<T> {
    result.map_err(|error| anyhow!(redact(&format!("{error:#}"), secret)))
}

fn report_exit(app: &tauri::AppHandle, result: Result<LaunchExit>) {
    match result {
        Ok(LaunchExit::Cancelled) => activity(app, "launch", "finished", "启动已取消"),
        Ok(LaunchExit::Exited(exit)) if exit.stopped => {
            activity(app, "launch", "finished", "游戏已停止")
        }
        Ok(LaunchExit::Exited(exit)) => activity(
            app,
            "launch",
            if exit.status.success() {
                "finished"
            } else {
                "error"
            },
            &format!("游戏进程已退出：{}", exit.status),
        ),
        Err(error) => activity(
            app,
            "launch",
            "error",
            &format!("启动或等待游戏进程失败：{error:#}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    #[test]
    #[ignore = "controlled subprocess fixture; launched only by lifecycle tests"]
    fn controlled_process_child() {
        use std::io::Write;
        println!("PARADOX_CHILD_READY");
        std::io::stdout().flush().unwrap();
        loop {
            let mut command = String::new();
            if std::io::stdin().read_line(&mut command).unwrap() == 0 {
                break;
            }
            match command.trim() {
                "log" => {
                    println!("session-secret: game output");
                    std::io::stdout().flush().unwrap();
                }
                "exit" => break,
                _ => panic!("unexpected child instruction"),
            }
        }
    }

    fn spawn_controlled_child() -> tokio::process::Child {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--ignored",
                "--exact",
                "launch::tests::controlled_process_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command.spawn().unwrap()
    }

    async fn collect_child_lines(
        child: &mut tokio::process::Child,
    ) -> mpsc::UnboundedReceiver<String> {
        let mut stdout = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
        loop {
            let line = stdout
                .next_line()
                .await
                .unwrap()
                .expect("child must announce readiness");
            if line.contains("PARADOX_CHILD_READY") {
                break;
            }
        }
        let (sender, receiver) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Some(line) = stdout.next_line().await.unwrap() {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        receiver
    }

    #[tokio::test]
    async fn cancellation_before_preparation_does_not_poll_preparation() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let polled = AtomicBool::new(false);
        let result = prepare_until_cancelled(&cancellation, async {
            polled.store(true, Ordering::Release);
            Ok(())
        })
        .await
        .unwrap();
        assert!(
            result.is_none(),
            "a cancelled preparation must not produce a command"
        );
        assert!(!polled.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn cancellation_during_preparation_discards_the_ready_command() {
        let cancellation = CancellationToken::new();
        let (entered, entered_rx) = tokio::sync::oneshot::channel();
        let (finish, finish_rx) = tokio::sync::oneshot::channel();
        let work = prepare_until_cancelled(&cancellation, async {
            entered.send(()).unwrap();
            finish_rx.await.unwrap();
            Ok(())
        });
        let stop = async {
            entered_rx.await.unwrap();
            cancellation.cancel();
            let _ = finish.send(());
        };
        let (result, ()) = tokio::join!(work, stop);
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn cancellation_wins_when_preparation_and_stop_are_both_ready() {
        let cancellation = CancellationToken::new();
        let (finish, finish_rx) = tokio::sync::oneshot::channel();
        finish.send(()).unwrap();
        cancellation.cancel();
        let result = prepare_until_cancelled(&cancellation, async {
            finish_rx.await.unwrap();
            Ok(())
        })
        .await
        .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn stopping_preparation_prevents_spawn_and_holds_busy_until_completion() {
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let (guard, cancellation, _stop) = control.begin(Arc::clone(&busy)).unwrap();
        control.request_stop(|| {}).unwrap();
        let spawned = AtomicBool::new(false);
        assert!(
            control
                .spawn_if_active(|| {
                    spawned.store(true, Ordering::Release);
                    Ok(())
                })
                .unwrap()
                .is_none()
        );
        assert!(!spawned.load(Ordering::Acquire));
        assert!(cancellation.is_cancelled());
        assert!(control.is_active());
        assert!(busy.load(Ordering::Acquire));
        drop(guard);
        assert!(!control.is_active());
        assert!(!busy.load(Ordering::Acquire));
    }

    #[test]
    fn repeated_stop_coalesces_a_full_channel_and_announces_cancelling_once() {
        let control = Arc::new(LaunchController::default());
        let (_guard, _cancellation, mut stop) =
            control.begin(Arc::new(AtomicBool::new(false))).unwrap();
        let announcements = AtomicUsize::new(0);
        for _ in 0..3 {
            control
                .request_stop(|| {
                    announcements.fetch_add(1, Ordering::AcqRel);
                })
                .unwrap();
        }
        assert_eq!(announcements.load(Ordering::Acquire), 1);
        assert!(stop.try_recv().is_ok());
        assert!(stop.try_recv().is_err());
    }

    #[test]
    fn panic_in_cancelling_announcement_still_signals_the_game_supervisor() {
        let control = Arc::new(LaunchController::default());
        let (_guard, cancellation, mut stop) =
            control.begin(Arc::new(AtomicBool::new(false))).unwrap();
        let result = catch_unwind(AssertUnwindSafe(|| {
            control.request_stop(|| panic!("controlled cancelling notification failure"))
        }));
        assert!(result.is_err());
        assert!(cancellation.is_cancelled());
        assert!(
            stop.try_recv().is_ok(),
            "the supervisor must receive the accepted stop even if notification fails"
        );
    }

    #[test]
    fn terminal_publication_precedes_a_new_launch_and_releases_busy_for_it() {
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let (guard, _, _stop) = control.begin(Arc::clone(&busy)).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let (start, start_rx) = std::sync::mpsc::channel();
        let (at_boundary, boundary_rx) = std::sync::mpsc::channel();
        let (published, published_rx) = std::sync::mpsc::channel();
        let next = std::thread::spawn({
            let control = Arc::clone(&control);
            let busy = Arc::clone(&busy);
            let events = Arc::clone(&events);
            move || {
                start_rx.recv().unwrap();
                // Probe acquisition to coordinate this boundary without sleeps:
                // if the terminal publisher owns the lock, begin must wait.
                let blocked = control.session.try_lock().is_err();
                if blocked {
                    at_boundary.send(()).unwrap();
                    published_rx.recv().unwrap();
                }
                let work = control.begin(busy).unwrap();
                events.lock().unwrap().push("started");
                if !blocked {
                    at_boundary.send(()).unwrap();
                }
                work
            }
        });
        guard.finish(|| {
            assert!(
                !busy.load(Ordering::Acquire),
                "next launch must see busy released after publication"
            );
            start.send(()).unwrap();
            boundary_rx.recv().unwrap();
            events.lock().unwrap().push("finished");
            let _ = published.send(());
        });
        let next_work = next.join().unwrap();
        assert_eq!(*events.lock().unwrap(), ["finished", "started"]);
        assert!(control.is_active());
        assert!(busy.load(Ordering::Acquire));
        drop(next_work);
        assert!(!busy.load(Ordering::Acquire));
    }

    #[test]
    fn stopping_after_spawn_suppresses_running_announcement() {
        let control = Arc::new(LaunchController::default());
        let (_guard, _cancellation, _stop) =
            control.begin(Arc::new(AtomicBool::new(false))).unwrap();
        assert!(control.spawn_if_active(|| Ok(())).unwrap().is_some());
        control.request_stop(|| {}).unwrap();
        let announced = AtomicBool::new(false);
        assert!(!control.announce_running(|| {
            announced.store(true, Ordering::Release);
        }));
        assert!(!announced.load(Ordering::Acquire));
    }

    #[test]
    fn unwinding_clears_control_and_busy() {
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let result = std::panic::catch_unwind({
            let control = Arc::clone(&control);
            let busy = Arc::clone(&busy);
            move || {
                let (_guard, _, _stop) = control.begin(busy).unwrap();
                control
                    .spawn_if_active::<()>(|| panic!("controlled spawn failure"))
                    .unwrap();
            }
        });
        assert!(result.is_err());
        assert!(!control.is_active());
        assert!(!busy.load(Ordering::Acquire));
    }

    #[test]
    fn cancelling_credentials_does_not_hide_vault_failure() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let result = finish_credentials::<()>(Err(anyhow!("auth.errors.storage")), &cancellation);
        assert_eq!(result.unwrap_err().to_string(), "auth.errors.storage");
    }

    #[test]
    fn cooperative_credential_cancellation_is_a_normal_terminal_result() {
        let result = finish_credentials::<()>(
            Err(anyhow!("auth.errors.cancelled")),
            &CancellationToken::new(),
        );
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn failed_kill_restores_retryable_state_and_allows_a_new_stop_announcement() {
        let control = Arc::new(LaunchController::default());
        let (_guard, cancellation, mut stop) =
            control.begin(Arc::new(AtomicBool::new(false))).unwrap();
        control.announce_running(|| {});
        let announcements = AtomicUsize::new(0);
        control
            .request_stop(|| {
                announcements.fetch_add(1, Ordering::AcqRel);
            })
            .unwrap();
        stop.try_recv().unwrap();
        control.stop_failed(|| {});
        assert_eq!(
            control.session.lock().unwrap().as_ref().unwrap().phase,
            LaunchPhase::Running
        );
        assert!(
            cancellation.is_cancelled(),
            "preparation stays cancelled after spawn"
        );
        control
            .request_stop(|| {
                announcements.fetch_add(1, Ordering::AcqRel);
            })
            .unwrap();
        assert_eq!(announcements.load(Ordering::Acquire), 2);
        assert!(stop.try_recv().is_ok());
    }

    #[test]
    fn failed_kill_does_not_replace_a_newer_pending_stop_with_running() {
        let control = Arc::new(LaunchController::default());
        let (_guard, _cancellation, mut stop) =
            control.begin(Arc::new(AtomicBool::new(false))).unwrap();
        control.request_stop(|| {}).unwrap();
        stop.try_recv().unwrap();
        control.request_stop(|| {}).unwrap();
        let announced = AtomicBool::new(false);
        control.stop_failed(|| {
            announced.store(true, Ordering::Release);
        });
        assert!(!announced.load(Ordering::Acquire));
        assert_eq!(
            control.session.lock().unwrap().as_ref().unwrap().phase,
            LaunchPhase::Cancelling
        );
    }

    #[tokio::test]
    async fn stop_racing_spawn_reaps_the_real_child_before_busy_is_released() {
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let stopper = std::thread::spawn({
            let control = Arc::clone(&control);
            let barrier = Arc::clone(&barrier);
            move || {
                barrier.wait();
                control.request_stop(|| {}).unwrap();
            }
        });
        let mut child = control
            .spawn_if_active(|| {
                let child = spawn_controlled_child();
                // The stop races the protected spawn boundary, then is accepted
                // as soon as spawn releases the mutex.
                barrier.wait();
                Ok(child)
            })
            .unwrap()
            .unwrap();
        stopper.join().unwrap();
        assert!(!control.announce_running(|| panic!("stopped game announced running")));
        let mut lines = collect_child_lines(&mut child).await;
        assert!(busy.load(Ordering::Acquire));
        let exit = supervise_process(
            &mut child,
            &mut lines,
            &mut stop,
            String::as_str,
            |_, _| {},
            || {},
        )
        .await
        .unwrap();
        assert!(exit.stopped);
        assert!(child.id().is_none(), "the child must be reaped");
        assert!(busy.load(Ordering::Acquire));
        drop(guard);
        assert!(!busy.load(Ordering::Acquire));
        assert!(!control.is_active());
    }

    struct FailFirstKill {
        child: tokio::process::Child,
        failure: Option<tokio::sync::oneshot::Sender<()>>,
    }

    impl GameProcess for FailFirstKill {
        async fn wait(&mut self) -> std::io::Result<ExitStatus> {
            self.child.wait().await
        }
        async fn kill(&mut self) -> std::io::Result<()> {
            if let Some(failure) = self.failure.take() {
                let _ = failure.send(());
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "controlled kill failure",
                ));
            }
            self.child.kill().await
        }
    }

    #[tokio::test]
    async fn failed_kill_keeps_real_child_supervised_and_a_retry_reaps_it() {
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
        let mut child = spawn_controlled_child();
        let mut lines = collect_child_lines(&mut child).await;
        let (failure, failed) = tokio::sync::oneshot::channel();
        let mut process = FailFirstKill {
            child,
            failure: Some(failure),
        };
        control.announce_running(|| {});
        control.request_stop(|| {}).unwrap();
        let retry = async {
            failed.await.unwrap();
            assert!(busy.load(Ordering::Acquire));
            assert!(control.is_active());
            assert_eq!(
                control.session.lock().unwrap().as_ref().unwrap().phase,
                LaunchPhase::Running
            );
            control.request_stop(|| {}).unwrap();
        };
        let work = supervise_process(
            &mut process,
            &mut lines,
            &mut stop,
            String::as_str,
            |_, _| {},
            || control.stop_failed(|| {}),
        );
        let (exit, ()) = tokio::join!(work, retry);
        assert!(exit.unwrap().stopped);
        assert!(process.child.id().is_none());
        assert!(busy.load(Ordering::Acquire));
        drop(guard);
        assert!(!busy.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn natural_child_exit_preserves_logs_and_redacts_the_access_token() {
        let control = Arc::new(LaunchController::default());
        let (_guard, _cancellation, mut stop) =
            control.begin(Arc::new(AtomicBool::new(false))).unwrap();
        let mut child = spawn_controlled_child();
        let mut lines = collect_child_lines(&mut child).await;
        let mut stdin = child.stdin.take().unwrap();
        let messages = Mutex::new(Vec::new());
        let logged = tokio::sync::Notify::new();
        let work = supervise_process(
            &mut child,
            &mut lines,
            &mut stop,
            String::as_str,
            |level, line| {
                messages
                    .lock()
                    .unwrap()
                    .push((level.to_owned(), redact(line, Some("session-secret"))));
                if line.contains("game output") {
                    logged.notify_one();
                }
            },
            || {},
        );
        let finish = async {
            stdin.write_all(b"log\n").await.unwrap();
            logged.notified().await;
            stdin.write_all(b"exit\n").await.unwrap();
        };
        let (exit, ()) = tokio::join!(work, finish);
        let exit = exit.unwrap();
        assert!(exit.status.success());
        assert!(!exit.stopped);
        assert!(child.id().is_none());
        let messages = messages.into_inner().unwrap();
        assert!(
            messages
                .iter()
                .any(|(level, line)| level == "game" && line == "[REDACTED]: game output")
        );
        assert!(
            messages
                .iter()
                .all(|(_, line)| !line.contains("session-secret"))
        );
    }

    #[test]
    fn panic_in_running_announcement_reaps_real_child_before_clearing_busy() {
        let runtime = sdk_runtime().unwrap();
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
        let mut child = {
            let _entered = runtime.enter();
            spawn_controlled_child()
        };
        let mut lines = runtime.block_on(collect_child_lines(&mut child));
        let result = supervise_owned(
            &runtime,
            &control,
            &mut child,
            &mut lines,
            &mut stop,
            String::as_str,
            |event| {
                if let ProcessEvent::Running = event {
                    control.announce_running(|| panic!("controlled announcement panic"));
                }
            },
        );
        assert!(result.is_err());
        assert!(child.id().is_none());
        assert!(busy.load(Ordering::Acquire));
        drop(guard);
        assert!(!busy.load(Ordering::Acquire));
        assert!(!control.is_active());
    }

    struct FailFirstWait {
        child: tokio::process::Child,
        failed: bool,
    }

    impl GameProcess for FailFirstWait {
        async fn wait(&mut self) -> std::io::Result<ExitStatus> {
            if !self.failed {
                self.failed = true;
                return Err(std::io::Error::other("controlled wait failure"));
            }
            self.child.wait().await
        }
        async fn kill(&mut self) -> std::io::Result<()> {
            self.child.kill().await
        }
    }

    #[test]
    fn failed_wait_on_worker_reaps_real_child_before_returning_the_error() {
        let runtime = sdk_runtime().unwrap();
        let control = Arc::new(LaunchController::default());
        let busy = Arc::new(AtomicBool::new(false));
        let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
        let mut child = {
            let _entered = runtime.enter();
            spawn_controlled_child()
        };
        let mut lines = runtime.block_on(collect_child_lines(&mut child));
        let mut process = FailFirstWait {
            child,
            failed: false,
        };
        let result = supervise_owned(
            &runtime,
            &control,
            &mut process,
            &mut lines,
            &mut stop,
            String::as_str,
            |_| {},
        );
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("controlled wait failure")
        );
        assert!(process.child.id().is_none());
        assert!(busy.load(Ordering::Acquire));
        drop(guard);
        assert!(!busy.load(Ordering::Acquire));
    }

    #[test]
    fn launch_failure_redacts_tokens_from_the_entire_error_chain() {
        let error =
            anyhow!("command rejected session-secret").context("launch failed: session-secret");
        let error = redact_failure::<()>(Err(error), Some("session-secret")).unwrap_err();
        let message = format!("{error:#}");
        assert!(!message.contains("session-secret"));
        assert!(message.contains("command rejected [REDACTED]"));
        assert!(message.contains("launch failed: [REDACTED]"));
    }
}
