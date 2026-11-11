use std::{
    path::Path,
    process::{ExitStatus, Output, Stdio},
    time::Duration,
};

use anyhow::{Context, Result, ensure};
use elemental::core::launcher::command::LaunchCommand;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader},
    process::{Child, Command},
    sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel},
};
use tokio_util::sync::CancellationToken;

#[cfg(windows)]
mod windows_job;

/// Process ownership includes Windows wrapper descendants, even after the
/// selected executable exits. Its job is bound before any child code executes.
pub struct OwnedChild {
    inner: Child,
    status: Option<ExitStatus>,
    #[cfg(windows)]
    root_pid: u32,
    #[cfg(windows)]
    job: windows_job::ProcessJob,
}

impl OwnedChild {
    pub fn id(&self) -> Option<u32> {
        if let Some(pid) = self.inner.id() {
            return Some(pid);
        }
        #[cfg(windows)]
        if self.job.active_processes().is_ok_and(|count| count > 0) {
            return Some(self.root_pid);
        }
        None
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        if self.status.is_none() {
            self.status = self.inner.try_wait()?;
        }
        #[cfg(windows)]
        if self.job.active_processes()? > 0 {
            return Ok(None);
        }
        Ok(self.status)
    }

    pub async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        if self.status.is_none() {
            self.status = Some(self.inner.wait().await?);
        }
        #[cfg(windows)]
        while self.job.active_processes()? > 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.status
            .ok_or_else(|| std::io::Error::other("进程没有退出状态"))
    }

    pub async fn kill(&mut self) -> std::io::Result<()> {
        #[cfg(windows)]
        self.job.terminate()?;
        #[cfg(not(windows))]
        self.inner.kill().await?;
        self.wait().await?;
        Ok(())
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            let _ = self.job.terminate();
            // Also covers setup failure before AssignProcessToJobObject.
            let _ = self.inner.start_kill();
            self.job.wait_empty_blocking();
            if let Some(handle) = self.inner.raw_handle() {
                windows_job::wait_process(handle);
            }
        }
    }
}

pub(crate) fn spawn_owned_command(command: &mut Command) -> std::io::Result<OwnedChild> {
    command.kill_on_drop(true);
    #[cfg(windows)]
    let job = windows_job::ProcessJob::new()?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }
    let child = command.spawn()?;
    #[cfg(windows)]
    let root_pid = child
        .id()
        .ok_or_else(|| std::io::Error::other("新进程没有 PID"))?;
    let child = OwnedChild {
        inner: child,
        status: None,
        #[cfg(windows)]
        root_pid,
        #[cfg(windows)]
        job,
    };
    #[cfg(windows)]
    child.job.assign_and_resume(&child.inner, child.root_pid)?;
    Ok(child)
}

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

/// Stop the owned game process and reap it before reporting completion.
/// Windows wrappers may create a child JVM, so stop their complete process tree.
pub async fn kill_process_tree<P: ProcessTree + ?Sized>(child: &mut P) -> std::io::Result<()> {
    child.kill_tree().await
}

pub trait ProcessTree {
    fn kill_tree(&mut self) -> impl std::future::Future<Output = std::io::Result<()>>;
}

impl ProcessTree for OwnedChild {
    async fn kill_tree(&mut self) -> std::io::Result<()> {
        self.kill().await
    }
}

impl ProcessTree for Child {
    async fn kill_tree(&mut self) -> std::io::Result<()> {
        let child = self;
        #[cfg(windows)]
        {
            if child.try_wait()?.is_some() {
                return Ok(());
            }
            let Some(pid) = child.id() else {
                return Ok(());
            };
            let output = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000)
                .kill_on_drop(true)
                .output()
                .await?;
            if !output.status.success() && child.try_wait()?.is_none() {
                return Err(std::io::Error::other("无法终止 Java 进程树"));
            }
            child.wait().await?;
            Ok(())
        }
        #[cfg(not(windows))]
        child.kill().await
    }
}

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
pub(crate) async fn probe_output(mut command: Command, timeout: Duration) -> Result<Output> {
    let cancellation = CancellationToken::new();
    let mut probe_owner = ProbeCancellation {
        token: cancellation.clone(),
        owner: None,
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let owner = std::thread::Builder::new()
        .name("java-probe-owner".into())
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()?;
                runtime.block_on(async {
                    ensure!(!cancellation.is_cancelled(), "Java 检测已取消");
                    command
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .kill_on_drop(true);
                    let mut child =
                        spawn_owned_command(&mut command).context("无法运行 Java 检测命令")?;
                    let stdout = child.inner.stdout.take().context("Java 检测缺少 stdout")?;
                    let stderr = child.inner.stderr.take().context("Java 检测缺少 stderr")?;
                    let stdout = tokio::spawn(read_output(stdout));
                    let stderr = tokio::spawn(read_output(stderr));
                    let deadline = tokio::time::Instant::now() + timeout;
                    let status = tokio::select! {
                        biased;
                        () = cancellation.cancelled() => {
                            kill_process_tree(&mut child).await?;
                            anyhow::bail!("Java 检测已取消");
                        }
                        () = tokio::time::sleep_until(deadline) => {
                            kill_process_tree(&mut child).await?;
                            anyhow::bail!("Java 检测超时");
                        }
                        status = child.wait() => status?,
                    };
                    tokio::select! {
                        biased;
                        () = cancellation.cancelled() => anyhow::bail!("Java 检测已取消"),
                        () = tokio::time::sleep_until(deadline) => anyhow::bail!("Java 检测超时"),
                        result = async { Ok(Output {
                            status,
                            stdout: stdout.await.context("Java stdout 读取线程失败")??,
                            stderr: stderr.await.context("Java stderr 读取线程失败")??,
                        }) } => result,
                    }
                })
            })();
            let _ = sender.send(result);
        })
        .context("无法创建 Java 检测工作线程")?;
    probe_owner.owner = Some(owner);
    receiver.await.context("Java 检测工作线程异常退出")?
}

async fn read_output<R: AsyncRead + Unpin>(mut reader: R) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).await?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::java::JavaInstallation;

    #[test]
    fn process_fixture() {
        let Ok(mode) = std::env::var("PARADOX_PROCESS_FIXTURE") else {
            return;
        };
        if mode == "echo" {
            use std::io::Write;
            println!(
                "selected={}",
                std::env::current_exe()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
            );
            println!(
                "cwd={}",
                crate::sdk::java_compatible_path(&std::env::current_dir().unwrap()).display()
            );
            println!(
                "environment={}",
                std::env::var("PARADOX_FIXTURE_ENV").unwrap()
            );
            eprintln!("stderr-fixture");
            std::io::stdout()
                .write_all(b"non-utf8-\xff\r\nstdout-after-invalid\n")
                .unwrap();
        } else if mode == "wait" || mode == "tree" || mode == "early" {
            let marker = std::env::var_os("PARADOX_FIXTURE_MARKER").unwrap();
            if mode == "tree" || mode == "early" {
                let mut command = std::process::Command::new(std::env::current_exe().unwrap());
                command
                    .args(["--exact", "process::tests::process_fixture", "--nocapture"])
                    .env("PARADOX_PROCESS_FIXTURE", "wait")
                    .env(
                        "PARADOX_FIXTURE_MARKER",
                        Path::new(&marker).with_extension("descendant"),
                    );
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x0800_0000);
                }
                let mut descendant = command.spawn().unwrap();
                std::fs::write(&marker, descendant.id().to_string()).unwrap();
                if mode == "early" {
                    std::process::exit(0);
                }
                let _ = descendant.wait();
            } else {
                std::fs::write(marker, std::process::id().to_string()).unwrap();
                if let Some(release) = std::env::var_os("PARADOX_FIXTURE_RELEASE") {
                    while !Path::new(&release).exists() {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                } else {
                    std::thread::sleep(Duration::from_secs(60));
                }
            }
        }
    }

    async fn fixture_command(root: &Path) -> LaunchCommand {
        let home = root.join("runtime");
        std::fs::create_dir_all(home.join("bin")).unwrap();
        let default = home
            .join("bin")
            .join(format!("java{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&default, b"must never be executed").unwrap();
        std::fs::write(home.join("release"), b"JAVA_VERSION=\"21.0.1\"\n").unwrap();
        let installation = JavaInstallation {
            executable: default,
            java_home: home,
            major_version: 21,
            version: "21.0.1".into(),
            vendor: "fixture".into(),
            architecture: std::env::consts::ARCH.into(),
            source: "manual".into(),
        };
        let runtime = crate::runtime::elemental_runtime_options(&installation, 21)
            .await
            .unwrap()
            .runtime_override
            .unwrap();
        LaunchCommand::new(
            runtime,
            vec!["--exact".into()],
            "process::tests::process_fixture".into(),
            vec!["--nocapture".into()],
        )
    }

    #[cfg(windows)]
    struct TrackedProcess(std::os::windows::io::OwnedHandle);

    #[cfg(windows)]
    impl TrackedProcess {
        fn open(pid: u32) -> Self {
            use std::os::windows::io::FromRawHandle;
            use windows_sys::Win32::System::Threading::{
                OpenProcess, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
            };
            let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid) };
            assert!(
                !handle.is_null(),
                "cannot open controlled descendant: {}",
                std::io::Error::last_os_error()
            );
            Self(unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(handle) })
        }
        fn alive(&self) -> bool {
            use std::os::windows::io::AsRawHandle;
            unsafe {
                windows_sys::Win32::System::Threading::WaitForSingleObject(
                    self.0.as_raw_handle(),
                    0,
                ) == windows_sys::Win32::Foundation::WAIT_TIMEOUT
            }
        }
    }

    #[cfg(windows)]
    impl Drop for TrackedProcess {
        fn drop(&mut self) {
            use std::os::windows::io::AsRawHandle;
            // This retained handle identifies our exact fixture process. Clean
            // it even when a RED assertion fails, without a PID reuse race.
            if self.alive() {
                unsafe {
                    windows_sys::Win32::System::Threading::TerminateProcess(
                        self.0.as_raw_handle(),
                        1,
                    );
                    windows_sys::Win32::System::Threading::WaitForSingleObject(
                        self.0.as_raw_handle(),
                        windows_sys::Win32::System::Threading::INFINITE,
                    );
                }
            }
        }
    }

    #[cfg(windows)]
    async fn early_wrapper(root: &Path) -> (LoggedChild, TrackedProcess) {
        let marker = root.join("early-started");
        let command = fixture_command(root)
            .await
            .with_env("PARADOX_PROCESS_FIXTURE".into(), "early".into())
            .with_env(
                "PARADOX_FIXTURE_MARKER".into(),
                marker.to_string_lossy().into_owned(),
            )
            .with_env(
                "PARADOX_FIXTURE_RELEASE".into(),
                root.join("release-child").to_string_lossy().into_owned(),
            );
        let mut process = spawn_command_logged(command, &std::env::current_exe().unwrap()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !marker.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(&marker).unwrap().parse().unwrap();
        let descendant = TrackedProcess::open(pid);
        // Reap just the wrapper to demonstrate that the actual JVM remains.
        assert!(process.child.inner.wait().await.unwrap().success());
        assert!(descendant.alive());
        (process, descendant)
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn early_wrapper_wait_tracks_descendant_until_its_natural_exit() {
        let temporary = tempfile::tempdir().unwrap();
        let (mut process, descendant) = early_wrapper(temporary.path()).await;
        assert!(process.child.try_wait().unwrap().is_none());
        assert!(process.child.id().is_some());
        assert!(
            tokio::time::timeout(Duration::from_millis(80), process.child.wait())
                .await
                .is_err()
        );
        assert!(descendant.alive());
        std::fs::write(temporary.path().join("release-child"), b"exit").unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(5), process.child.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
        assert!(!descendant.alive());
        assert!(process.child.id().is_none());
        tokio::time::timeout(Duration::from_secs(5), async {
            while process.lines.recv().await.is_some() {}
        })
        .await
        .unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn early_wrapper_stop_terminates_and_reaps_descendant() {
        let temporary = tempfile::tempdir().unwrap();
        let (mut process, descendant) = early_wrapper(temporary.path()).await;
        kill_process_tree(&mut process.child).await.unwrap();
        assert!(!descendant.alive());
        assert!(process.child.try_wait().unwrap().is_some());
        assert!(process.child.id().is_none());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn early_wrapper_drop_terminates_descendant_before_returning() {
        let temporary = tempfile::tempdir().unwrap();
        let (process, descendant) = early_wrapper(temporary.path()).await;
        drop(process);
        assert!(!descendant.alive());
    }

    #[cfg(windows)]
    #[test]
    fn cancelled_early_wrapper_probe_reaps_descendant_before_runtime_drop() {
        let temporary = tempfile::tempdir().unwrap();
        let marker = temporary.path().join("early-probe-started");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let descendant = runtime.block_on(async {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "process::tests::process_fixture", "--nocapture"])
                .env("PARADOX_PROCESS_FIXTURE", "early")
                .env("PARADOX_FIXTURE_MARKER", &marker)
                .env("PARADOX_FIXTURE_RELEASE", temporary.path().join("release-child"));
            let probe = probe_output(command, Duration::from_secs(30));
            tokio::pin!(probe);
            tokio::select! {
                result = &mut probe => panic!("probe exited while descendant should be running: {result:?}"),
                () = async { tokio::time::timeout(Duration::from_secs(5), async {
                    while !marker.exists() { tokio::time::sleep(Duration::from_millis(10)).await; }
                }).await.unwrap(); } => {}
            }
            let pid = std::fs::read_to_string(marker).unwrap().parse().unwrap();
            let descendant = TrackedProcess::open(pid);
            assert!(descendant.alive());
            descendant
        });
        assert!(
            !descendant.alive(),
            "cancelled probe returned before descendant was terminated"
        );
        drop(runtime);
        assert!(!descendant.alive());
    }

    #[tokio::test]
    async fn spawn_uses_selected_executable_cwd_environment_and_both_log_sources() {
        let temporary = tempfile::tempdir().unwrap();
        let selected = temporary
            .path()
            .join(format!("selected-javaw{}", std::env::consts::EXE_SUFFIX));
        std::fs::copy(std::env::current_exe().unwrap(), &selected).unwrap();
        let command = fixture_command(temporary.path())
            .await
            .with_cwd(temporary.path().to_owned())
            .with_env("PARADOX_PROCESS_FIXTURE".into(), "echo".into())
            .with_env("PARADOX_FIXTURE_ENV".into(), "retained value".into());
        assert_ne!(command.program(), selected);
        let mut process = spawn_command_logged(command, &selected).unwrap();
        assert!(process.child.wait().await.unwrap().success());
        let mut lines = Vec::new();
        while let Some(line) = tokio::time::timeout(Duration::from_secs(5), process.lines.recv())
            .await
            .unwrap()
        {
            lines.push(line);
        }
        for expected in [
            format!(
                "selected={}",
                selected.file_name().unwrap().to_string_lossy()
            ),
            format!(
                "cwd={}",
                crate::sdk::java_compatible_path(temporary.path()).display()
            ),
            "environment=retained value".into(),
            "non-utf8-�".into(),
            "stdout-after-invalid".into(),
        ] {
            assert!(
                lines
                    .iter()
                    .any(|line| line.source == ProcessLogSource::Stdout && line.line == expected),
                "missing {expected}"
            );
        }
        assert!(
            lines.iter().any(
                |line| line.source == ProcessLogSource::Stderr && line.line == "stderr-fixture"
            )
        );
    }

    #[tokio::test]
    async fn stop_reaps_the_owned_process_and_closes_log_streams() {
        let temporary = tempfile::tempdir().unwrap();
        let marker = temporary.path().join("started");
        let command = fixture_command(temporary.path())
            .await
            .with_env("PARADOX_PROCESS_FIXTURE".into(), "wait".into())
            .with_env(
                "PARADOX_FIXTURE_MARKER".into(),
                marker.to_string_lossy().into_owned(),
            );
        let mut process = spawn_command_logged(command, &std::env::current_exe().unwrap()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !marker.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        kill_process_tree(&mut process.child).await.unwrap();
        assert!(process.child.try_wait().unwrap().is_some());
        tokio::time::timeout(Duration::from_secs(5), async {
            while process.lines.recv().await.is_some() {}
        })
        .await
        .unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn stop_reaps_wrapper_descendant_jvm_processes() {
        let temporary = tempfile::tempdir().unwrap();
        let marker = temporary.path().join("started");
        let descendant = marker.with_extension("descendant");
        let command = fixture_command(temporary.path())
            .await
            .with_env("PARADOX_PROCESS_FIXTURE".into(), "tree".into())
            .with_env(
                "PARADOX_FIXTURE_MARKER".into(),
                marker.to_string_lossy().into_owned(),
            );
        let mut process = spawn_command_logged(command, &std::env::current_exe().unwrap()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !descendant.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(&descendant).unwrap();
        kill_process_tree(&mut process.child).await.unwrap();
        assert!(process.child.try_wait().unwrap().is_some());
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .creation_flags(0x0800_0000)
            .output()
            .await
            .unwrap();
        assert!(!String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\"")));
        tokio::time::timeout(Duration::from_secs(5), async {
            while process.lines.recv().await.is_some() {}
        })
        .await
        .unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn cancelled_java_probe_is_reaped_after_awaiting_runtime_is_dropped() {
        let temporary = tempfile::tempdir().unwrap();
        let marker = temporary.path().join("probe-started");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args(["--exact", "process::tests::process_fixture", "--nocapture"])
                .env("PARADOX_PROCESS_FIXTURE", "wait")
                .env("PARADOX_FIXTURE_MARKER", &marker)
                .creation_flags(0x0800_0000);
            let probe = probe_output(command, Duration::from_secs(30));
            tokio::pin!(probe);
            tokio::select! {
                result = &mut probe => panic!("probe exited before cancellation: {result:?}"),
                () = async { tokio::time::timeout(Duration::from_secs(5), async {
                    while !marker.exists() { tokio::time::sleep(Duration::from_millis(10)).await; }
                }).await.unwrap(); } => {}
            }
        });
        drop(runtime);
        let pid = std::fs::read_to_string(marker).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
                .creation_flags(0x0800_0000)
                .output()
                .unwrap();
            if !String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\"")) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "cancelled probe {pid} is still running"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
