//! Stream stdout and stderr from the selected game executable.

use super::{OwnedChild, spawn_owned_command};
use anyhow::{Context, Result, ensure};
use elemental::core::launcher::command::LaunchCommand;
use std::{path::Path, process::Stdio};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::Command,
    sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessLogSource {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessLogLine {
    pub source: ProcessLogSource,
    pub line: String,
}

/// The caller owns this child until wait/kill has reaped it. Reader tasks finish
/// at stream EOF, allowing the existing supervisor to drain both log sources.
pub struct LoggedChild {
    pub child: OwnedChild,
    pub lines: UnboundedReceiver<ProcessLogLine>,
}

pub(crate) fn spawn_command_logged(
    command: LaunchCommand,
    executable: &Path,
) -> Result<LoggedChild> {
    ensure!(
        executable.is_absolute(),
        "Java 可执行文件路径必须为绝对路径"
    );
    let mut process = Command::new(executable);
    process.args(command.arguments());
    if let Some(cwd) = command.cwd {
        process.current_dir(cwd);
    }
    process.envs(command.env);
    process
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    // Do not format the command: its arguments can contain a launch credential.
    let mut child = spawn_owned_command(&mut process).context("无法创建所选 Java 进程")?;
    let (sender, lines) = unbounded_channel();
    if let Some(stdout) = child.inner.stdout.take() {
        spawn_log_reader(ProcessLogSource::Stdout, stdout, sender.clone());
    }
    if let Some(stderr) = child.inner.stderr.take() {
        spawn_log_reader(ProcessLogSource::Stderr, stderr, sender.clone());
    }
    drop(sender);
    Ok(LoggedChild { child, lines })
}

fn spawn_log_reader<R>(source: ProcessLogSource, reader: R, sender: UnboundedSender<ProcessLogLine>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            match reader.read_until(b'\n', &mut bytes).await {
                Ok(0) => return,
                Ok(_) => {
                    if bytes.last() == Some(&b'\n') {
                        bytes.pop();
                    }
                    if bytes.last() == Some(&b'\r') {
                        bytes.pop();
                    }
                    let line = String::from_utf8_lossy(&bytes).into_owned();
                    if sender.send(ProcessLogLine { source, line }).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(ProcessLogLine {
                        source,
                        line: format!("读取游戏日志失败：{error}"),
                    });
                    return;
                }
            }
        }
    });
}
