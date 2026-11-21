// SDK catalog behavior regressions; included in sdk::tests.
#[tokio::test]
async fn vanilla_catalog_only_reads_the_manifest_and_preserves_release_kinds() {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap().join("minecraft");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let releases = [
        ("1.21.2", "release"),
        ("26w45a", "snapshot"),
        ("b1.7.3", "old_beta"),
        ("1.21.10", "release"),
    ]
    .into_iter()
    .map(|(id, kind)| {
        serde_json::json!({
            "id": id,
            "type": kind,
            "url": format!("https://piston-meta.mojang.com/unavailable/{id}.json"),
            "time": "2026-11-07T00:00:00Z",
            "releaseTime": "2026-11-07T00:00:00Z",
            "sha1": "0".repeat(40),
            "complianceLevel": 1,
        })
    })
    .collect::<Vec<_>>();
    let manifest = serde_json::json!({
        "latest": {"release": "1.21.10", "snapshot": "26w45a"},
        "versions": releases,
    })
    .to_string();
    let server = tokio::spawn(async move {
        let (mut connection, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 4096];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = connection.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            assert!(request.len() <= 16 * 1024);
        }
        let request = String::from_utf8(request).unwrap();
        let target = request.split_ascii_whitespace().nth(1).unwrap().to_owned();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{manifest}",
            manifest.len(),
        );
        connection.write_all(response.as_bytes()).await.unwrap();
        // Close the listener after the manifest. Any per-version metadata
        // request would fail, so successful catalog loading proves it is lazy.
        drop(listener);
        target
    });
    let mut settings = Settings {
        game_directory: root.clone(),
        ..Settings::default()
    };
    settings.network.mirror_url = format!("{origin}/mirror");
    settings.network.proxy_url = origin.clone();
    settings.network.timeout_seconds = 1;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        ElementalService::new(&settings).unwrap().catalog(),
    )
    .await
    .unwrap();
    let target = server.await.unwrap();
    let manifest_path = "/mirror/mc/game/version_manifest_v2.json";
    assert!(target == manifest_path || target == format!("{origin}{manifest_path}"));
    let versions = result.unwrap();
    assert_eq!(versions.len(), 4);
    assert_eq!(versions[0].id, "1.21.10");
    assert_eq!(versions[1].id, "1.21.2");
    for (id, kind) in [
        ("1.21.2", "release"),
        ("26w45a", "snapshot"),
        ("b1.7.3", "old_beta"),
        ("1.21.10", "release"),
    ] {
        assert_eq!(
            versions
                .iter()
                .find(|version| version.id == id)
                .unwrap()
                .kind,
            kind
        );
    }
    assert!(!root.exists());
}
