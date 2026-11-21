use super::*;
pub(super) fn run_fixture() {
    let Ok(mode) = std::env::var("PARADOX_PROCESS_FIXTURE") else {
        return;
    };
    match mode.as_str() {
        "oversized-stdout" | "oversized-stderr" => oversized_stream(&mode),
        "echo" => echo_selected_process(),
        "wait" => wait_for_release(),
        "tree" | "early" => spawn_descendant(&mode),
        _ => {}
    }
}

fn oversized_stream(mode: &str) {
    use std::io::Write;
    let marker = std::env::var_os("PARADOX_FIXTURE_MARKER").unwrap();
    let release = std::env::var_os("PARADOX_FIXTURE_RELEASE").unwrap();
    std::fs::write(marker, std::process::id().to_string()).unwrap();
    while !Path::new(&release).exists() {
        std::thread::sleep(Duration::from_millis(10));
    }
    let bytes = vec![b'j'; MAX_PROBE_OUTPUT_BYTES as usize + 1];
    let mut output: Box<dyn Write> = if mode == "oversized-stdout" {
        Box::new(std::io::stdout())
    } else {
        Box::new(std::io::stderr())
    };
    let _ = output.write_all(&bytes);
    let _ = output.flush();
    std::thread::sleep(Duration::from_secs(60));
}

fn echo_selected_process() {
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
}

fn spawn_descendant(mode: &str) {
    let marker = std::env::var_os("PARADOX_FIXTURE_MARKER").unwrap();
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
}

fn wait_for_release() {
    let marker = std::env::var_os("PARADOX_FIXTURE_MARKER").unwrap();
    std::fs::write(marker, std::process::id().to_string()).unwrap();
    let Some(release) = std::env::var_os("PARADOX_FIXTURE_RELEASE") else {
        std::thread::sleep(Duration::from_secs(60));
        return;
    };
    while !Path::new(&release).exists() {
        std::thread::sleep(Duration::from_millis(10));
    }
}

pub(super) async fn fixture_command(root: &Path) -> LaunchCommand {
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
pub(super) struct TrackedProcess(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl TrackedProcess {
    pub(super) fn open(pid: u32) -> Self {
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
    pub(super) fn alive(&self) -> bool {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::Threading::WaitForSingleObject(self.0.as_raw_handle(), 0)
                == windows_sys::Win32::Foundation::WAIT_TIMEOUT
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
                windows_sys::Win32::System::Threading::TerminateProcess(self.0.as_raw_handle(), 1);
                windows_sys::Win32::System::Threading::WaitForSingleObject(
                    self.0.as_raw_handle(),
                    windows_sys::Win32::System::Threading::INFINITE,
                );
            }
        }
    }
}
