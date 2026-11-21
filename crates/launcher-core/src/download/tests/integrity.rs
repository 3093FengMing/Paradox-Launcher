use super::*;
#[tokio::test]
async fn valid_files_are_reused_without_network_and_corrupt_files_retry() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("中文 空格.bin");
    let good = b"complete file";
    let bad = b"corrupt! file";
    assert_eq!(good.len(), bad.len());
    let (url, count, server) = serve(vec![response(bad), response(good)]).await;
    let artifact = Artifact {
        url,
        target: target.clone(),
        expected_size: Some(good.len() as u64),
        checksum: Some(checksum(good)),
    };
    let engine = DownloadEngine::new(test_options()).unwrap();
    let snapshots = Arc::new(Mutex::new(Vec::<DownloadProgress>::new()));
    let collected = snapshots.clone();
    let summary = engine
        .download(
            vec![artifact.clone()],
            CancellationToken::new(),
            move |value| {
                collected.lock().unwrap().push(value);
            },
        )
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), good);
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(summary.transferred_bytes, (good.len() + bad.len()) as u64);
    let last = snapshots.lock().unwrap().last().unwrap().clone();
    assert_eq!(last.completed_bytes, good.len() as u64);
    assert_eq!(last.completed_files, 1);
    assert_eq!(last.active_bytes, 0);
    let reused = engine
        .download(vec![artifact], CancellationToken::new(), |_| {})
        .await
        .unwrap();
    assert_eq!(reused.reused_files, 1);
    assert_eq!(reused.transferred_bytes, 0);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn failed_download_preserves_existing_target_and_cleans_staging() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("existing.bin");
    std::fs::write(&target, b"previous contents").unwrap();
    let (url, _, server) = serve(vec![response(b"wrong"), response(b"wrong")]).await;
    let result = DownloadEngine::new(test_options())
        .unwrap()
        .download(
            vec![Artifact {
                url,
                target: target.clone(),
                expected_size: Some(5),
                checksum: Some(checksum(b"right")),
            }],
            CancellationToken::new(),
            |_| {},
        )
        .await;
    server.await.unwrap();
    assert!(matches!(result, Err(DownloadError::Failed(_))));
    assert_eq!(std::fs::read(&target).unwrap(), b"previous contents");
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn truncated_stream_retries_and_identical_tasks_are_deduplicated() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("resumed.bin");
    let (url, count, server) = serve(vec![
        b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nab".to_vec(),
        response(b"abcde"),
    ])
    .await;
    let artifact = Artifact {
        url,
        target: target.clone(),
        expected_size: Some(5),
        checksum: Some(checksum(b"abcde")),
    };
    let summary = DownloadEngine::new(test_options())
        .unwrap()
        .download(
            vec![artifact.clone(), artifact],
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(summary.total_files, 1);
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(std::fs::read(target).unwrap(), b"abcde");
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn server_errors_retry_and_sha1_game_artifacts_are_verified() {
    let directory = tempfile::tempdir().unwrap();
    let (url, count, server) = serve(vec![
        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            .to_vec(),
        response(b"minecraft artifact"),
    ])
    .await;
    let target = directory.path().join("game.jar");
    let result = DownloadEngine::new(test_options())
        .unwrap()
        .download(
            vec![Artifact {
                url,
                target: target.clone(),
                expected_size: Some(18),
                checksum: Some(Checksum::Sha1(hex::encode(sha1::Sha1::digest(
                    b"minecraft artifact",
                )))),
            }],
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(result.downloaded_files, 1);
    assert_eq!(std::fs::read(target).unwrap(), b"minecraft artifact");
}
