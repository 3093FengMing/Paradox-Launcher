use super::*;
pub(super) fn run_controlled_child() {
    use std::io::Write;
    println!("PARADOX_CHILD_READY");
    std::io::stdout().flush().unwrap();
    loop {
        let mut command = String::new();
        if std::io::stdin().read_line(&mut command).unwrap() == 0 {
            break;
        }
        match command.trim() {
            "log" => {
                println!("session-secret: game output");
                std::io::stdout().flush().unwrap();
            }
            "exit" => break,
            _ => panic!("unexpected child instruction"),
        }
    }
}

pub(super) fn spawn_controlled_child() -> tokio::process::Child {
    let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--ignored",
            "--exact",
            "launch::tests::controlled_process_child",
            "--nocapture",
            "--test-threads=1",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.spawn().unwrap()
}

pub(super) async fn collect_child_lines(
    child: &mut tokio::process::Child,
) -> mpsc::UnboundedReceiver<String> {
    let mut stdout = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
    loop {
        let line = stdout
            .next_line()
            .await
            .unwrap()
            .expect("child must announce readiness");
        if line.contains("PARADOX_CHILD_READY") {
            break;
        }
    }
    let (sender, receiver) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Some(line) = stdout.next_line().await.unwrap() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}
