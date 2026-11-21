use super::*;
struct CompletedProcess {
    waited: Option<tokio::sync::oneshot::Sender<()>>,
}

impl GameProcess for CompletedProcess {
    async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        if let Some(waited) = self.waited.take() {
            let _ = waited.send(());
        }
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        Ok(ExitStatus::from_raw(0))
    }

    async fn kill(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn natural_exit_waits_for_reader_to_publish_the_final_log() {
    let (waited, waited_rx) = tokio::sync::oneshot::channel();
    let mut child = CompletedProcess {
        waited: Some(waited),
    };
    let (sender, mut lines) = mpsc::unbounded_channel();
    let (_stop_sender, mut stop) = mpsc::channel(1);
    let messages = Mutex::new(Vec::new());
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
        },
        || {},
    );
    let reader = async {
        waited_rx.await.unwrap();
        tokio::task::yield_now().await;
        sender.send("session-secret: final output".into()).unwrap();
        drop(sender);
    };
    let (exit, ()) = tokio::join!(work, reader);
    assert!(exit.unwrap().status.success());
    assert_eq!(
        messages.into_inner().unwrap(),
        [("game".into(), "[REDACTED]: final output".into())]
    );
}

#[tokio::test]
async fn exit_with_an_open_log_pipe_finishes_with_a_diagnostic() {
    let mut child = CompletedProcess { waited: None };
    let (_sender, mut lines) = mpsc::unbounded_channel::<String>();
    let (_stop_sender, mut stop) = mpsc::channel(1);
    let messages = Mutex::new(Vec::new());
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        supervise_process(
            &mut child,
            &mut lines,
            &mut stop,
            String::as_str,
            |level, line| {
                messages
                    .lock()
                    .unwrap()
                    .push((level.to_owned(), line.to_owned()));
            },
            || {},
        ),
    )
    .await
    .expect("an inherited open pipe must not hold the launch slot indefinitely")
    .unwrap();
    assert!(result.status.success());
    let messages = messages.into_inner().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].0, "warn");
    assert!(messages[0].1.contains("日志管道未及时关闭"));
}

#[test]
fn launch_failure_redacts_tokens_from_the_entire_error_chain() {
    let error = anyhow!("command rejected session-secret").context("launch failed: session-secret");
    let error = redact_failure::<()>(Err(error), Some("session-secret")).unwrap_err();
    let message = format!("{error:#}");
    assert!(!message.contains("session-secret"));
    assert!(message.contains("command rejected [REDACTED]"));
    assert!(message.contains("launch failed: [REDACTED]"));
}
