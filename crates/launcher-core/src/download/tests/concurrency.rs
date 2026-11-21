use super::*;
#[tokio::test]
async fn downloads_respect_the_configured_concurrency_limit() {
    let directory = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/file", listener.local_addr().unwrap());
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let server_active = active.clone();
    let server_maximum = maximum.clone();
    let server = tokio::spawn(async move {
        let mut requests = JoinSet::new();
        for _ in 0..6 {
            let (mut stream, _) = listener.accept().await.unwrap();
            let active = server_active.clone();
            let maximum = server_maximum.clone();
            requests.spawn(async move {
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request).await;
                let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(100)).await;
                stream.write_all(&response(b"payload")).await.unwrap();
                active.fetch_sub(1, Ordering::SeqCst);
            });
        }
        while let Some(result) = requests.join_next().await {
            result.unwrap();
        }
    });
    let artifacts = (0..6)
        .map(|index| Artifact {
            url: url.clone(),
            target: directory.path().join(format!("{index}.bin")),
            expected_size: Some(7),
            checksum: Some(checksum(b"payload")),
        })
        .collect();
    let summary = DownloadEngine::new(test_options())
        .unwrap()
        .download(artifacts, CancellationToken::new(), |_| {})
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(summary.downloaded_files, 6);
    assert_eq!(maximum.load(Ordering::SeqCst), 2);
    assert_eq!(active.load(Ordering::SeqCst), 0);
}
