//! Bound Java probe output and keep a dedicated owner alive through cancellation.

use super::{kill_process_tree, spawn_owned_command};
use anyhow::{Context, Result, ensure};
use std::{
    process::{Output, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;

pub(super) const MAX_PROBE_OUTPUT_BYTES: u64 = 1024 * 1024;

struct ProbeCancellation {
    token: CancellationToken,
    owner: Option<std::thread::JoinHandle<()>>,
}

impl Drop for ProbeCancellation {
    fn drop(&mut self) {
        self.token.cancel();
        // These probes already run in a background task. Settle their dedicated
        // owner before cancellation releases the caller's installation/launch
        // slot, including when that caller is dropping its Tokio runtime.
        if let Some(owner) = self.owner.take() {
            let _ = owner.join();
        }
    }
}

/// Java discovery futures can be dropped together with their caller's runtime.
/// A short-lived owner thread keeps its runtime alive until the probe is killed
/// and reaped, even when the awaiting future has been cancelled.
pub(crate) async fn probe_output(command: Command, timeout: Duration) -> Result<Output> {
    let cancellation = CancellationToken::new();
    let mut probe_owner = ProbeCancellation {
        token: cancellation.clone(),
        owner: None,
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let owner = std::thread::Builder::new()
        .name("java-probe-owner".into())
        .spawn(move || {
            let result = run_probe_owner(command, timeout, cancellation);
            let _ = sender.send(result);
        })
        .context("无法创建 Java 检测工作线程")?;
    probe_owner.owner = Some(owner);
    receiver.await.context("Java 检测工作线程异常退出")?
}

fn run_probe_owner(
    command: Command,
    timeout: Duration,
    cancellation: CancellationToken,
) -> Result<Output> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(collect_probe(command, timeout, cancellation))
}

async fn collect_probe(
    mut command: Command,
    timeout: Duration,
    cancellation: CancellationToken,
) -> Result<Output> {
    ensure!(!cancellation.is_cancelled(), "Java 检测已取消");
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = spawn_owned_command(&mut command).context("无法运行 Java 检测命令")?;
    let stdout = child.inner.stdout.take().context("Java 检测缺少 stdout")?;
    let stderr = child.inner.stderr.take().context("Java 检测缺少 stderr")?;
    let result = tokio::select! {
        biased;
        () = cancellation.cancelled() => Err(anyhow::anyhow!("Java 检测已取消")),
        () = tokio::time::sleep(timeout) => Err(anyhow::anyhow!("Java 检测超时")),
        result = async {
            // Poll streams and process completion together so an oversized
            // or broken stream stops its owner promptly.
            let (status, stdout, stderr) = tokio::try_join!(child.wait(), read_output(stdout), read_output(stderr))?;
            Ok::<_, anyhow::Error>(Output { status, stdout, stderr })
        } => result,
    };
    let Err(error) = result else {
        return result;
    };
    if let Err(cleanup) = kill_process_tree(&mut child).await {
        return Err(error.context(format!("无法结束 Java 检测进程：{cleanup}")));
    }
    Err(error)
}

pub(super) async fn read_output<R: AsyncRead + Unpin>(reader: R) -> std::io::Result<Vec<u8>> {
    // A selected Java wrapper may emit arbitrary data. Read one byte beyond the
    // bound to distinguish oversized output from a complete properties stream.
    let mut bytes = Vec::new();
    reader
        .take(MAX_PROBE_OUTPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() as u64 > MAX_PROBE_OUTPUT_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Java 检测输出超出大小限制",
        ));
    }
    Ok(bytes)
}
