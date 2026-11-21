// Content transfer regressions, kept in content::tests.
async fn serve_file(bytes: &'static [u8]) -> (String, tokio::task::JoinHandle<()>) {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/new.jar", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            request.push(stream.read_u8().await.unwrap());
            assert!(request.len() <= 8192);
        }
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        stream.write_all(header.as_bytes()).await.unwrap();
        stream.write_all(bytes).await.unwrap();
    });
    (url, server)
}

#[tokio::test]
async fn downloaded_mod_updates_preserve_enabled_state() {
    for suffix in [".disabled", ""] {
        let (_temp, settings, profile, root) = instance();
        let previous = format!("mods/old.jar{suffix}");
        write_content(&root, &previous, b"old");
        register(&root, &previous, old_record());
        let (url, server) = serve_file(b"new").await;

        install_files(
            &settings,
            &profile,
            "mod",
            new_plan("new.jar", &url),
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();

        let entries = list(&settings, &profile, "mods").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, format!("new.jar{suffix}"));
        assert_eq!(entries[0].enabled, suffix.is_empty());
        assert_eq!(
            entries[0].record.as_ref().unwrap().version_id,
            "new-version"
        );
        assert_eq!(
            fs::read(root.join(format!("mods/new.jar{suffix}"))).unwrap(),
            b"new"
        );
        assert!(!root.join(previous).exists());
        assert_eq!(registry(&root).unwrap().len(), 1);
    }
}
