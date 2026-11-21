use super::*;
#[tokio::test]
async fn stop_racing_spawn_reaps_the_real_child_before_busy_is_released() {
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let stopper = std::thread::spawn({
        let control = Arc::clone(&control);
        let barrier = Arc::clone(&barrier);
        move || {
            barrier.wait();
            control.request_stop(|| {}).unwrap();
        }
    });
    let mut child = control
        .spawn_if_active(|| {
            let child = spawn_controlled_child();
            // The stop races the protected spawn boundary, then is accepted
            // as soon as spawn releases the mutex.
            barrier.wait();
            Ok(child)
        })
        .unwrap()
        .unwrap();
    stopper.join().unwrap();
    assert!(!control.announce_running(|| panic!("stopped game announced running")));
    let mut lines = collect_child_lines(&mut child).await;
    assert!(busy.load(Ordering::Acquire));
    let exit = supervise_process(
        &mut child,
        &mut lines,
        &mut stop,
        String::as_str,
        |_, _| {},
        || {},
    )
    .await
    .unwrap();
    assert!(exit.stopped);
    assert!(child.id().is_none(), "the child must be reaped");
    assert!(busy.load(Ordering::Acquire));
    drop(guard);
    assert!(!busy.load(Ordering::Acquire));
    assert!(!control.is_active());
}

struct FailFirstKill {
    child: tokio::process::Child,
    failure: Option<tokio::sync::oneshot::Sender<()>>,
}

impl GameProcess for FailFirstKill {
    async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.child.wait().await
    }
    async fn kill(&mut self) -> std::io::Result<()> {
        if let Some(failure) = self.failure.take() {
            let _ = failure.send(());
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "controlled kill failure",
            ));
        }
        self.child.kill().await
    }
}

#[tokio::test]
async fn failed_kill_keeps_real_child_supervised_and_a_retry_reaps_it() {
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
    let mut child = spawn_controlled_child();
    let mut lines = collect_child_lines(&mut child).await;
    let (failure, failed) = tokio::sync::oneshot::channel();
    let mut process = FailFirstKill {
        child,
        failure: Some(failure),
    };
    control.announce_running(|| {});
    control.request_stop(|| {}).unwrap();
    let retry = async {
        failed.await.unwrap();
        assert!(busy.load(Ordering::Acquire));
        assert!(control.is_active());
        assert_eq!(
            control.session.lock().unwrap().as_ref().unwrap().phase,
            LaunchPhase::Running
        );
        control.request_stop(|| {}).unwrap();
    };
    let work = supervise_process(
        &mut process,
        &mut lines,
        &mut stop,
        String::as_str,
        |_, _| {},
        || control.stop_failed(|| {}),
    );
    let (exit, ()) = tokio::join!(work, retry);
    assert!(exit.unwrap().stopped);
    assert!(process.child.id().is_none());
    assert!(busy.load(Ordering::Acquire));
    drop(guard);
    assert!(!busy.load(Ordering::Acquire));
}

#[tokio::test]
async fn natural_child_exit_preserves_logs_and_redacts_the_access_token() {
    let control = Arc::new(LaunchController::default());
    let (_guard, _cancellation, mut stop) =
        control.begin(Arc::new(AtomicBool::new(false))).unwrap();
    let mut child = spawn_controlled_child();
    let mut lines = collect_child_lines(&mut child).await;
    let mut stdin = child.stdin.take().unwrap();
    let messages = Mutex::new(Vec::new());
    let logged = tokio::sync::Notify::new();
    let work = supervise_process(
        &mut child,
        &mut lines,
        &mut stop,
        String::as_str,
        |level, line| {
            messages
                .lock()
                .unwrap()
                .push((level.to_owned(), redact(line, Some("session-secret"))));
            if line.contains("game output") {
                logged.notify_one();
            }
        },
        || {},
    );
    let finish = async {
        stdin.write_all(b"log\n").await.unwrap();
        logged.notified().await;
        stdin.write_all(b"exit\n").await.unwrap();
    };
    let (exit, ()) = tokio::join!(work, finish);
    let exit = exit.unwrap();
    assert!(exit.status.success());
    assert!(!exit.stopped);
    assert!(child.id().is_none());
    let messages = messages.into_inner().unwrap();
    assert!(
        messages
            .iter()
            .any(|(level, line)| level == "game" && line == "[REDACTED]: game output")
    );
    assert!(
        messages
            .iter()
            .all(|(_, line)| !line.contains("session-secret"))
    );
}

#[test]
fn panic_in_running_announcement_reaps_real_child_before_clearing_busy() {
    let runtime = sdk_runtime().unwrap();
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
    let mut child = {
        let _entered = runtime.enter();
        spawn_controlled_child()
    };
    let mut lines = runtime.block_on(collect_child_lines(&mut child));
    let result = supervise_owned(
        &runtime,
        &control,
        &mut child,
        &mut lines,
        &mut stop,
        String::as_str,
        |event| {
            if let ProcessEvent::Running = event {
                control.announce_running(|| panic!("controlled announcement panic"));
            }
        },
    );
    assert!(result.is_err());
    assert!(child.id().is_none());
    assert!(busy.load(Ordering::Acquire));
    drop(guard);
    assert!(!busy.load(Ordering::Acquire));
    assert!(!control.is_active());
}

struct FailFirstWait {
    child: tokio::process::Child,
    failed: bool,
}

impl GameProcess for FailFirstWait {
    async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        if !self.failed {
            self.failed = true;
            return Err(std::io::Error::other("controlled wait failure"));
        }
        self.child.wait().await
    }
    async fn kill(&mut self) -> std::io::Result<()> {
        self.child.kill().await
    }
}

#[test]
fn failed_wait_on_worker_reaps_real_child_before_returning_the_error() {
    let runtime = sdk_runtime().unwrap();
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let (guard, _cancellation, mut stop) = control.begin(Arc::clone(&busy)).unwrap();
    let mut child = {
        let _entered = runtime.enter();
        spawn_controlled_child()
    };
    let mut lines = runtime.block_on(collect_child_lines(&mut child));
    let mut process = FailFirstWait {
        child,
        failed: false,
    };
    let result = supervise_owned(
        &runtime,
        &control,
        &mut process,
        &mut lines,
        &mut stop,
        String::as_str,
        |_| {},
    );
    assert!(
        result
            .err()
            .unwrap()
            .to_string()
            .contains("controlled wait failure")
    );
    assert!(process.child.id().is_none());
    assert!(busy.load(Ordering::Acquire));
    drop(guard);
    assert!(!busy.load(Ordering::Acquire));
}
