use super::*;
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
