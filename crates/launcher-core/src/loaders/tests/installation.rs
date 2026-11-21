#[tokio::test]
async fn installer_download_failure_is_reported_before_reading_the_archive() {
    for family in ["forge", "neoforge"] {
        let temporary = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/installer.jar", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            read_http_request(&mut connection).await;
            connection
                .write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
        });
        let session = installation_test_session().await;
        let installer = InstallerArtifact {
            coordinate: "example:installer:1.0".into(),
            url,
            path: temporary.path().join("installer.jar"),
            expected_size: None,
            sha1: None,
        };
        let installer_error = tokio::time::timeout(
            Duration::from_secs(5),
            prepare_installer_state(
                &session,
                &installer,
                &temporary.path().join("instance"),
                &temporary.path().join("libraries"),
                family,
                &|_| Ok(()),
            ),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert!(matches!(
            &installer_error,
            elemental::driver::error::Error::DownloadInstaller { .. }
        ));
        let error = cancel_preparation_with_error(session, installer_error.into()).await;
        let Some(DownloaderError::SessionFailed { failures, .. }) =
            error.downcast_ref::<DownloaderError>()
        else {
            panic!("the download failure was hidden: {error:#}");
        };
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].phase, DownloadPhase::HttpStatus);
        assert_eq!(failures[0].http_status, Some(500));
        assert_eq!(failures[0].group.as_deref(), Some("installer"));
        assert!(error.to_string().contains("HTTP 500"));
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
    }
}

#[tokio::test]
async fn cancelling_an_active_download_preserves_the_java_error() {
    let temporary = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/library.jar", listener.local_addr().unwrap());
    let (started, request_received) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut connection, _) = listener.accept().await.unwrap();
        read_http_request(&mut connection).await;
        started.send(()).unwrap();
        let mut buffer = [0u8; 1];
        let _ = connection.read(&mut buffer).await;
    });
    let session = installation_test_session().await;
    session
        .submit(DownloadTask::new(url, temporary.path().join("library.jar")))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), request_received)
        .await
        .unwrap()
        .unwrap();
    let error =
        cancel_preparation_with_error(session, anyhow::anyhow!("Java runtime unavailable")).await;
    assert_eq!(error.to_string(), "Java runtime unavailable");
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn cancelling_an_empty_session_preserves_the_metadata_error() {
    let session = installation_test_session().await;
    let error = cancel_preparation_with_error(session, anyhow::anyhow!("Invalid metadata")).await;
    assert_eq!(error.to_string(), "Invalid metadata");
}

const NEOFORGE_METADATA: &[u8] = br#"<metadata><versioning><versions>
    <version>21.0.167</version><version>21.1.265</version><version>21.10.2</version>
    <version>26.1.0.1-beta</version><version>26.1.1.4-beta</version>
    <version>26.1.2.125</version><version>26.1.2.124</version>
    <version>26.3.0.99</version><version>26.3.0.100</version>
    <version>26.3.0.100</version><version>26.3.0.75-beta</version>
    <version>26.3.0.0-alpha.1+snapshot-1</version><version>26.3.1.1</version>
    <version>26.30.0.1</version><version>26.3.0../bad</version>
    </versions></versioning></metadata>"#;

#[tokio::test]
async fn forge_install_rejects_unsupported_legacy_games_before_network_or_writes() {
    let temp = tempfile::tempdir().unwrap();
    let settings = offline_settings(temp.path().canonicalize().unwrap().join("minecraft"));
    for game in ["1.7.10", "1.12.2", "1.13.2", "1.16.5"] {
        let mut profile = GameProfile::new("Legacy Forge", game).unwrap();
        profile.loader = "forge".into();
        profile.loader_version = "36.2.42".into();
        let error = prepare(&profile, &settings, &temp.path().join("runtimes"))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "loaders.errors.compatibility");
    }
    assert!(!settings.game_directory.exists());
}

#[tokio::test]
async fn loader_install_rejects_parent_traversal_before_network_or_file_writes() {
    let temp = tempfile::tempdir().unwrap();
    let settings = offline_settings(
        crate::sdk::java_compatible_path(&temp.path().canonicalize().unwrap())
            .join("minecraft")
            .join("..")
            .join("outside"),
    );
    let error = prepare(&fabric_profile(), &settings, &temp.path().join("runtimes"))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "loaders.errors.path");
    assert!(
        !temp
            .path()
            .canonicalize()
            .unwrap()
            .join("minecraft")
            .exists()
    );
    assert!(!temp.path().join("outside").exists());
}

#[cfg(any(unix, windows))]
#[tokio::test]
async fn loader_install_rejects_linked_versions_before_network_or_file_writes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("minecraft");
    let outside = temp.path().join("outside");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, root.join("versions")).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&outside, root.join("versions")).unwrap();
    let error = prepare(
        &fabric_profile(),
        &offline_settings(root),
        &temp.path().join("runtimes"),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "loaders.errors.path");
    assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
}

#[cfg(any(unix, windows))]
#[test]
fn loader_install_rejects_nested_and_broken_sdk_target_links() {
    for target in [
        "assets/objects",
        "libraries/net/fabricmc",
        ".elemental/fabric",
        "natives",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("minecraft");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let profile = fabric_profile();
        let linked_path = if target.starts_with("assets") || target.starts_with("libraries") {
            root.join(target)
        } else {
            root.join("versions")
                .join(&profile.instance_key)
                .join(target)
        };
        std::fs::create_dir_all(linked_path.parent().unwrap()).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &linked_path).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, &linked_path).unwrap();
        assert_eq!(
            validate_installation_paths(&profile, &offline_settings(root))
                .unwrap_err()
                .to_string(),
            "loaders.errors.path",
            "{target}"
        );
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
    }
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("minecraft");
    let profile = fabric_profile();
    let instance = root.join("versions").join(&profile.instance_key);
    std::fs::create_dir_all(&instance).unwrap();
    let metadata = instance.join(format!("{}.json", profile.instance_key));
    #[cfg(unix)]
    std::os::unix::fs::symlink(temp.path().join("missing.json"), metadata).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(temp.path().join("missing.json"), metadata).unwrap();
    assert_eq!(
        validate_installation_paths(&profile, &offline_settings(root))
            .unwrap_err()
            .to_string(),
        "loaders.errors.path"
    );
    assert!(!temp.path().join("missing.json").exists());
}
