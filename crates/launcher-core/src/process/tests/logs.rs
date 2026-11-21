use super::*;
#[tokio::test]
async fn spawn_uses_selected_executable_cwd_environment_and_both_log_sources() {
    let temporary = tempfile::tempdir().unwrap();
    #[cfg(not(unix))]
    let requested_cwd = temporary.path().to_owned();
    #[cfg(unix)]
    let alias_root = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    let requested_cwd = {
        let alias = alias_root.path().join("requested-cwd");
        std::os::unix::fs::symlink(temporary.path(), &alias).unwrap();
        alias
    };
    let selected = temporary
        .path()
        .join(format!("selected-javaw{}", std::env::consts::EXE_SUFFIX));
    std::fs::copy(std::env::current_exe().unwrap(), &selected).unwrap();
    let command = fixture_command(temporary.path())
        .await
        .with_cwd(requested_cwd.clone())
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
    let reported_cwd = lines
        .iter()
        .find(|line| line.source == ProcessLogSource::Stdout && line.line.starts_with("cwd="))
        .expect("missing working directory output")
        .line
        .strip_prefix("cwd=")
        .unwrap();
    // macOS /var temporary paths resolve through /private/var in the child.
    assert_eq!(
        std::fs::canonicalize(reported_cwd).unwrap(),
        std::fs::canonicalize(&requested_cwd).unwrap(),
        "the child must run in the requested working directory"
    );
    assert!(
        lines
            .iter()
            .any(|line| line.source == ProcessLogSource::Stderr && line.line == "stderr-fixture")
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
