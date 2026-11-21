//! Supervise the owned game, retry stops, and drain final log output.

use super::LaunchController;
use anyhow::{Result, anyhow};
use std::{
    future::Future,
    panic::{AssertUnwindSafe, catch_unwind},
    process::ExitStatus,
};
use tokio::sync::mpsc;

pub(super) struct GameExit {
    pub(super) status: ExitStatus,
    pub(super) stopped: bool,
}

pub(super) enum ProcessEvent<'a> {
    Running,
    StopFailed,
    Log(&'a str, &'a str),
}

pub(super) fn supervise_owned<P: GameProcess, L>(
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

pub(super) trait GameProcess {
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

pub(super) async fn supervise_process<P, L>(
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
    // Child exit can precede its reader tasks publishing buffered pipe data.
    // Wait for EOF so the terminal event follows the final game logs. Bound the
    // drain because a descendant on Unix may keep an inherited pipe open.
    let drain_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(1);
    if lines_open {
        loop {
            match tokio::time::timeout_at(drain_deadline, lines.recv()).await {
                Ok(Some(line)) => log_line("game", line_text(&line)),
                Ok(None) => break,
                Err(_) => {
                    log_line(
                        "warn",
                        "游戏已退出，但日志管道未及时关闭，已停止等待剩余日志",
                    );
                    break;
                }
            }
        }
    }
    Ok(GameExit { status, stopped })
}
