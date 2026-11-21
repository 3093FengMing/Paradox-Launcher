use super::*;
#[tokio::test]
async fn probe_output_keeps_complete_streams_within_the_size_limit() {
    for size in [0, 64, MAX_PROBE_OUTPUT_BYTES as usize] {
        let bytes = vec![b'j'; size];
        assert_eq!(read_output(bytes.as_slice()).await.unwrap(), bytes);
    }
}

#[tokio::test]
async fn probe_output_rejects_oversized_streams_without_reading_them_to_eof() {
    let bytes = vec![b'j'; MAX_PROBE_OUTPUT_BYTES as usize + 2];
    let mut input = bytes.as_slice();
    let error = read_output(&mut input).await.unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert!(error.to_string().contains("Java 检测输出超出大小限制"));
    assert_eq!(input, b"j", "read only one byte beyond the limit");
}

#[cfg(windows)]
#[tokio::test]
async fn oversized_probe_stream_reaps_its_process_before_returning() {
    for mode in ["oversized-stdout", "oversized-stderr"] {
        let temporary = tempfile::tempdir().unwrap();
        let marker = temporary.path().join("probe.pid");
        let release = temporary.path().join("release");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "process::tests::process_fixture", "--nocapture"])
            .env("PARADOX_PROCESS_FIXTURE", mode)
            .env("PARADOX_FIXTURE_MARKER", &marker)
            .env("PARADOX_FIXTURE_RELEASE", &release);
        let work = tokio::spawn(probe_output(command, Duration::from_secs(6)));
        tokio::time::timeout(Duration::from_secs(5), async {
            while !marker.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let process =
            TrackedProcess::open(std::fs::read_to_string(marker).unwrap().parse().unwrap());
        assert!(process.alive());
        std::fs::write(release, b"emit output").unwrap();
        let error = tokio::time::timeout(Duration::from_secs(3), work)
            .await
            .expect("oversized output must terminate before the probe deadline")
            .unwrap()
            .unwrap_err();
        assert!(error.to_string().contains("Java 检测输出超出大小限制"));
        assert!(
            !process.alive(),
            "the probe must be reaped before returning"
        );
    }
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
