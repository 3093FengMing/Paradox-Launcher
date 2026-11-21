// SDK inspection behavior regressions; included in sdk::tests.
#[test]
fn application_sdk_futures_are_send() {
    fn assert_send(_: impl std::future::Future + Send) {}
    let temporary = tempfile::tempdir().unwrap();
    let settings = Settings {
        game_directory: temporary.path().canonicalize().unwrap().join("minecraft"),
        ..Settings::default()
    };
    let service = ElementalService::new(&settings).unwrap();
    let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
    let runtimes = temporary.path().join("runtimes");
    assert_send(service.catalog());
    assert_send(service.inspect());
    assert_send(service.prepare_with_progress(&profile, CancellationToken::new(), |_| {}));
    assert_send(service.prepare_authenticated_launch(&profile, &settings, &runtimes, None));
    assert_send(crate::loaders::prepare(&profile, &settings, &runtimes));
}

#[tokio::test]
async fn inspection_keeps_healthy_instances_and_preserves_corrupt_metadata() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary
        .path()
        .canonicalize()
        .unwrap()
        .join("游戏 library");
    let settings = Settings {
        game_directory: root.clone(),
        ..Settings::default()
    };
    for (key, valid) in [
        ("healthy-b", true),
        ("broken 中文", false),
        ("healthy-a", true),
    ] {
        let instance = root.join("versions").join(key);
        std::fs::create_dir_all(&instance).unwrap();
        let bytes = if valid {
            serde_json::to_vec(
                &vanilla_metadata(&GameProfile::new("Vanilla", "1.21.1").unwrap()).metadata,
            )
            .unwrap()
        } else {
            b"{invalid".to_vec()
        };
        std::fs::write(instance.join(format!("{key}.json")), bytes).unwrap();
        std::fs::write(instance.join(format!("{key}.jar")), b"").unwrap();
    }
    let service = ElementalService::new(&settings).unwrap();
    let report = service.launcher.inspect_instances().await.unwrap();
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.failures[0].instance_name, "broken 中文");
    assert_eq!(
        report.failures[0].path,
        service.settings.game_directory.join("versions/broken 中文")
    );
    let installed = tokio::spawn(async move { service.inspect().await })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        installed
            .iter()
            .map(|instance| instance.instance_key.as_str())
            .collect::<Vec<_>>(),
        ["healthy-a", "healthy-b"]
    );
    assert!(installed.iter().all(|instance| instance.loader == "vanilla"
        && instance.game_version.as_deref() == Some("1.21.1")
        && instance.loader_version.is_none()));
    assert_eq!(
        std::fs::read(root.join("versions/broken 中文/broken 中文.json")).unwrap(),
        b"{invalid"
    );
    for key in ["healthy-a", "broken 中文", "healthy-b"] {
        assert!(!root.join("versions").join(key).join(".elemental").exists());
    }
}

#[tokio::test]
async fn inspection_still_reports_root_directory_errors() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap().join("minecraft");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("versions"), b"not a directory").unwrap();
    let settings = Settings {
        game_directory: root,
        ..Settings::default()
    };
    let error = ElementalService::new(&settings)
        .unwrap()
        .inspect()
        .await
        .unwrap_err();
    assert!(error.to_string().contains("无法扫描本地实例"));
}
