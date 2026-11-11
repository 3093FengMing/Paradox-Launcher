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
    command
        .arg("--install-loader")
        .arg(request.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    let mut child = command.spawn().context("loaders.errors.worker")?;
    #[cfg(windows)]
    let job = match job::bind(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error);
        }
    };
    #[cfg(unix)]
    let job = job::Group(child.id().context("loaders.errors.worker")?);
    let mut stderr = child.stderr.take().context("loaders.errors.worker")?;
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
            // Closing the job/process group terminates all installation descendants.
            drop(job);
            // Always reap the worker and stderr reader, even when it exits
            // concurrently with the kill request or that request fails.
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
    drop(job);
    let bytes = reader.await??;
    ensure!(
        status.success(),
        "loaders.errors.worker: {}",
        String::from_utf8_lossy(&bytes)
    );
    Ok(())
}

#[cfg(windows)]
mod job {
    use anyhow::{Result, ensure};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    pub fn bind(child: &tokio::process::Child) -> Result<OwnedHandle> {
        // Own the job handle immediately, and close it on every error path.
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        ensure!(!raw.is_null(), "loaders.errors.worker");
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&info) as u32,
            )
        };
        ensure!(ok != 0, "loaders.errors.worker");
        let child = child
            .raw_handle()
            .ok_or_else(|| anyhow::anyhow!("loaders.errors.worker"))?;
        ensure!(
            unsafe { AssignProcessToJobObject(handle.as_raw_handle(), child) } != 0,
            "loaders.errors.worker"
        );
        Ok(handle)
    }
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
