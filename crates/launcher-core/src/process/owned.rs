//! Own spawned processes through natural exit, explicit stop, and unwinding.

#[cfg(windows)]
use super::windows_job;
use std::process::ExitStatus;
#[cfg(windows)]
use std::time::Duration;
use tokio::process::{Child, Command};

/// Process ownership includes Windows wrapper descendants, even after the
/// selected executable exits. Its job is bound before any child code executes.
pub struct OwnedChild {
    pub(super) inner: Child,
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

    /// Take the child's piped stderr for bounded worker diagnostics.
    /// The child retains ownership of its process tree until wait, kill or drop.
    pub fn take_stderr(&mut self) -> Option<tokio::process::ChildStderr> {
        self.inner.stderr.take()
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

/// Spawn a command with process-tree ownership before child code executes.
///
/// Windows creates it suspended, binds a kill-on-close Job, and only then
/// resumes its primary thread. Setup errors reap the suspended process. Waiting
/// includes descendants, and kill/drop finishes tree cleanup before returning.
/// Other platforms retain Tokio child ownership; callers may add a process group.
pub fn spawn_owned_command(command: &mut Command) -> std::io::Result<OwnedChild> {
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
