use super::*;
#[tokio::test]
async fn cancellation_during_a_retry_retains_the_already_observed_failure() {
    let temporary = tempfile::tempdir().unwrap();
    let target = temporary.path().join("retry.bin");
    std::fs::write(&target, b"old").unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/retry", listener.local_addr().unwrap());
    let cancellation = CancellationToken::new();
    let stop_server = cancellation.clone();
    let (second_request, started) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut first, _) = listener.accept().await.unwrap();
        let mut request = [0u8; 4096];
        assert!(first.read(&mut request).await.unwrap() > 0);
        first.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        drop(first);
        let (mut second, _) = listener.accept().await.unwrap();
        assert!(second.read(&mut request).await.unwrap() > 0);
        second_request.send(()).unwrap();
        stop_server.cancelled().await;
    });
    let token = cancellation.clone();
    let artifact = Artifact {
        url,
        target: target.clone(),
        expected_size: Some(5),
        checksum: None,
    };
    let download = tokio::spawn(async move {
        DownloadEngine::new(test_options())
            .unwrap()
            .download(vec![artifact], token, |_| {})
            .await
    });
    tokio::time::timeout(Duration::from_secs(3), started)
        .await
        .unwrap()
        .unwrap();
    cancellation.cancel();
    let result = download.await.unwrap();
    server.await.unwrap();
    let Err(DownloadError::Failed(message)) = result else {
        panic!("the first attempt failure was hidden: {result:?}");
    };
    assert!(message.contains("服务器返回下载错误"), "{message}");
    assert_eq!(std::fs::read(target).unwrap(), b"old");
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn cancellation_after_a_download_failure_preserves_the_public_api_error() {
    let directory = tempfile::tempdir().unwrap();
    let parent = directory.path().join("parent-is-file");
    std::fs::write(&parent, b"keep").unwrap();
    let cancellation = CancellationToken::new();
    let request_cancel = cancellation.clone();
    let result = DownloadEngine::new(NetworkOptions {
        max_retries: 0,
        max_concurrent_downloads: 1,
        ..test_options()
    })
    .unwrap()
    .download(
        vec![Artifact {
            url: "http://127.0.0.1:1/file".into(),
            target: parent.join("file.bin"),
            expected_size: None,
            checksum: None,
        }],
        cancellation,
        move |progress| {
            if progress.failed_files > 0 {
                request_cancel.cancel();
            }
        },
    )
    .await;
    let Err(DownloadError::Failed(message)) = result else {
        panic!("a real filesystem failure must survive cancellation: {result:?}");
    };
    assert!(message.contains("无法创建下载目录"), "{message}");
    assert_eq!(std::fs::read(&parent).unwrap(), b"keep");
}

#[tokio::test]
async fn cancellation_after_all_files_are_committed_keeps_the_public_api_success() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("completed.bin");
    std::fs::write(&target, b"ready").unwrap();
    let cancellation = CancellationToken::new();
    let request_cancel = cancellation.clone();
    let result = DownloadEngine::new(test_options())
        .unwrap()
        .download(
            vec![Artifact {
                url: "http://127.0.0.1:1/file".into(),
                target: target.clone(),
                expected_size: Some(5),
                checksum: Some(checksum(b"ready")),
            }],
            cancellation,
            move |progress| {
                if progress.completed_files == 1 {
                    request_cancel.cancel();
                }
            },
        )
        .await
        .unwrap();
    assert_eq!(result.reused_files, 1);
    assert_eq!(std::fs::read(target).unwrap(), b"ready");
}

#[tokio::test]
async fn cancellation_waits_for_cleanup_and_keeps_no_partial_target() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("cancelled.bin");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/slow", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = [0u8; 4096];
        let _ = stream.read(&mut request).await;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        for _ in 0..1024 {
            if stream.write_all(&[1u8; 1024]).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });
    let cancellation = CancellationToken::new();
    let cancel_from_callback = cancellation.clone();
    let result = DownloadEngine::new(test_options())
        .unwrap()
        .download(
            vec![Artifact {
                url,
                target: target.clone(),
                expected_size: Some(1048576),
                checksum: None,
            }],
            cancellation,
            move |progress| {
                if progress.transferred_bytes > 0 {
                    cancel_from_callback.cancel();
                }
            },
        )
        .await;
    assert!(matches!(result, Err(DownloadError::Cancelled)));
    assert!(!target.exists());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn cancelling_a_queue_does_not_start_remaining_artifacts() {
    let directory = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/slow", listener.local_addr().unwrap());
    let requests = Arc::new(AtomicUsize::new(0));
    let server_requests = requests.clone();
    let server_stop = CancellationToken::new();
    let server_token = server_stop.clone();
    let server = tokio::spawn(async move {
        let mut connections = JoinSet::new();
        loop {
            let connection = tokio::select! {
                biased;
                () = server_token.cancelled() => break,
                connection = listener.accept() => connection.unwrap(),
            };
            let (mut stream, _) = connection;
            server_requests.fetch_add(1, Ordering::SeqCst);
            connections.spawn(async move {
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request).await;
                if stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .is_err()
                {
                    return;
                }
                for _ in 0..1024 {
                    if stream.write_all(&[1u8; 1024]).await.is_err() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            });
        }
        while let Some(result) = connections.join_next().await {
            result.unwrap();
        }
    });
    let cancellation = CancellationToken::new();
    let callback_cancel = cancellation.clone();
    let artifacts = (0..20)
        .map(|index| Artifact {
            url: url.clone(),
            target: directory.path().join(format!("{index}.bin")),
            expected_size: Some(1048576),
            checksum: None,
        })
        .collect();
    let result = DownloadEngine::new(test_options())
        .unwrap()
        .download(artifacts, cancellation, move |progress| {
            if progress.transferred_bytes > 0 {
                callback_cancel.cancel();
            }
        })
        .await;
    assert!(matches!(result, Err(DownloadError::Cancelled)));
    assert!((1..=2).contains(&requests.load(Ordering::SeqCst)));
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    server_stop.cancel();
    tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
}
