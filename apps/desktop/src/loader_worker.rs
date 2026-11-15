use anyhow::{Context, Result, ensure};
use paradox_core::{GameProfile, Settings};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{io::AsyncReadExt, process::Command};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize, Serialize)]
struct Request {
    profile: GameProfile,
    settings: Settings,
    managed_root: PathBuf,
}

pub fn run(path: &Path) -> Result<()> {
    let bytes = std::fs::read(path)?;
    ensure!(bytes.len() <= 256 * 1024, "loaders.errors.response");
    let request: Request = serde_json::from_slice(&bytes)?;
    request.profile.validate()?;
    request.settings.validate()?;
    ensure!(request.managed_root.is_absolute(), "loaders.errors.path");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    runtime.block_on(paradox_core::loaders::prepare(
        &request.profile,
        &request.settings,
        &request.managed_root,
    ))?;
    Ok(())
}

pub async fn install(
    profile: GameProfile,
    settings: Settings,
    managed_root: PathBuf,
    cancellation: CancellationToken,
) -> Result<()> {
    if cancellation.is_cancelled() {
        return Err(paradox_core::download::DownloadError::Cancelled.into());
    }
    let mut request = tempfile::NamedTempFile::new()?;
    serde_json::to_writer(
        request.as_file_mut(),
        &Request {
            profile,
            settings,
            managed_root,
        },
    )?;
    request.as_file().sync_all()?;
    let mut command = Command::new(std::env::current_exe()?);
    command.arg("--install-loader").arg(request.path());
    run_worker(command, cancellation).await
}

async fn run_worker(mut command: Command, cancellation: CancellationToken) -> Result<()> {
    if cancellation.is_cancelled() {
        return Err(paradox_core::download::DownloadError::Cancelled.into());
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    // The shared owner binds the Windows Job before the worker can start an
    // installer or Java processor, and waits even if the wrapper exits first.
    let mut child = paradox_core::process::spawn_owned_command(&mut command)
        .context("loaders.errors.worker")?;
    #[cfg(unix)]
    let job = job::Group(child.id().context("loaders.errors.worker")?);
    let mut stderr = child.take_stderr().context("loaders.errors.worker")?;
    let reader = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let length = stderr.read(&mut buffer).await?;
            if length == 0 {
                break;
            }
            if bytes.len() < 256 * 1024 {
                let remaining = (256 * 1024 - bytes.len()).min(length);
                bytes.extend_from_slice(&buffer[..remaining]);
            }
        }
        Ok::<_, std::io::Error>(bytes)
    });
    let status = tokio::select! {
        biased;
        () = cancellation.cancelled() => {
            #[cfg(unix)]
            drop(job);
            // Kill the owned tree, then reap the worker and stderr reader before
            // reporting cancellation, including early-exited wrapper processes.
            let killed = child.kill().await;
            let reaped = child.wait().await;
            let drained = reader.await;
            reaped.context("loaders.errors.worker")?;
            drained.context("loaders.errors.worker")?.context("loaders.errors.worker")?;
            if let Err(error) = killed
                && error.kind() != std::io::ErrorKind::InvalidInput
            {
                return Err(error).context("loaders.errors.worker");
            }
            return Err(paradox_core::download::DownloadError::Cancelled.into());
        }
        result = child.wait() => result?,
    };
    #[cfg(unix)]
    drop(job);
    let bytes = reader.await??;
    ensure!(
        status.success(),
        "loaders.errors.worker: {}",
        String::from_utf8_lossy(&bytes)
    );
    Ok(())
}

#[cfg(unix)]
mod job {
    pub struct Group(pub u32);
    impl Drop for Group {
        fn drop(&mut self) {
            unsafe {
                libc::kill(-(self.0 as i32), libc::SIGKILL);
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        time::Duration,
    };
    use windows_sys::Win32::{
        Foundation::WAIT_TIMEOUT,
        System::Threading::{
            INFINITE, OpenProcess, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, TerminateProcess,
            WaitForSingleObject,
        },
    };

    #[test]
    fn worker_fixture() {
        let Ok(mode) = std::env::var("PARADOX_LOADER_FIXTURE_MODE") else {
            return;
        };
        let marker = PathBuf::from(std::env::var_os("PARADOX_LOADER_FIXTURE_MARKER").unwrap());
        let release = PathBuf::from(std::env::var_os("PARADOX_LOADER_FIXTURE_RELEASE").unwrap());
        if mode == "descendant" {
            std::fs::write(marker.with_extension("ready"), b"ready").unwrap();
            while !release.exists() {
                std::thread::sleep(Duration::from_millis(10));
            }
        } else {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "loader_worker::tests::worker_fixture",
                    "--nocapture",
                ])
                .env("PARADOX_LOADER_FIXTURE_MODE", "descendant");
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
            let mut descendant = command.spawn().unwrap();
            std::fs::write(marker, descendant.id().to_string()).unwrap();
            if mode == "early" {
                std::process::exit(0);
            }
            assert!(descendant.wait().unwrap().success());
        }
    }

    struct Descendant(OwnedHandle);
    impl Descendant {
        fn open(pid: u32) -> Self {
            let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid) };
            assert!(!handle.is_null(), "{}", std::io::Error::last_os_error());
            Self(unsafe { OwnedHandle::from_raw_handle(handle) })
        }
        fn alive(&self) -> bool {
            unsafe { WaitForSingleObject(self.0.as_raw_handle(), 0) == WAIT_TIMEOUT }
        }
    }
    impl Drop for Descendant {
        fn drop(&mut self) {
            if self.alive() {
                unsafe {
                    TerminateProcess(self.0.as_raw_handle(), 1);
                    WaitForSingleObject(self.0.as_raw_handle(), INFINITE);
                }
            }
        }
    }

    fn fixture_command(root: &Path, mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "loader_worker::tests::worker_fixture",
                "--nocapture",
            ])
            .env("PARADOX_LOADER_FIXTURE_MODE", mode)
            .env("PARADOX_LOADER_FIXTURE_MARKER", root.join("descendant"))
            .env("PARADOX_LOADER_FIXTURE_RELEASE", root.join("release"));
        command
    }

    async fn wait_descendant(root: &Path) -> Descendant {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !root.join("descendant.ready").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(root.join("descendant"))
            .unwrap()
            .parse()
            .unwrap();
        Descendant::open(pid)
    }

    #[tokio::test]
    async fn cancelled_worker_does_not_spawn() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let error = run_worker(Command::new("nonexistent-loader-worker"), cancellation)
            .await
            .unwrap_err();
        assert!(matches!(
            error.downcast_ref::<paradox_core::download::DownloadError>(),
            Some(paradox_core::download::DownloadError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn cancellation_reaps_installer_descendants_before_returning() {
        let root = tempfile::tempdir().unwrap();
        let cancellation = CancellationToken::new();
        let work = tokio::spawn(run_worker(
            fixture_command(root.path(), "wait"),
            cancellation.clone(),
        ));
        let descendant = wait_descendant(root.path()).await;
        assert!(descendant.alive());
        cancellation.cancel();
        let error = tokio::time::timeout(Duration::from_secs(5), work)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(matches!(
            error.downcast_ref::<paradox_core::download::DownloadError>(),
            Some(paradox_core::download::DownloadError::Cancelled)
        ));
        assert!(!descendant.alive());
    }

    #[tokio::test]
    async fn early_worker_exit_waits_for_its_processor_and_reaps_it() {
        let root = tempfile::tempdir().unwrap();
        let work = tokio::spawn(run_worker(
            fixture_command(root.path(), "early"),
            CancellationToken::new(),
        ));
        let descendant = wait_descendant(root.path()).await;
        assert!(descendant.alive());
        assert!(!work.is_finished());
        std::fs::write(root.path().join("release"), b"exit").unwrap();
        tokio::time::timeout(Duration::from_secs(5), work)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(!descendant.alive());
    }

    #[tokio::test]
    async fn dropping_worker_future_reaps_early_exited_wrappers_descendants() {
        let root = tempfile::tempdir().unwrap();
        let work = tokio::spawn(run_worker(
            fixture_command(root.path(), "early"),
            CancellationToken::new(),
        ));
        let descendant = wait_descendant(root.path()).await;
        assert!(descendant.alive());
        work.abort();
        assert!(work.await.unwrap_err().is_cancelled());
        assert!(!descendant.alive());
    }
}
