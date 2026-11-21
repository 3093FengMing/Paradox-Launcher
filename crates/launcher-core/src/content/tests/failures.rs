// Content failures regressions, kept in content::tests.
#[tokio::test]
async fn oversized_update_registry_preserves_mod_files_and_registered_version() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/old.jar.disabled", b"old");
    write_content(&root, "mods/new.jar.disabled", b"new");
    register(&root, "mods/old.jar.disabled", old_record());
    let before = fs::read(root.join(REGISTRY)).unwrap();
    let mut plan = new_plan("new.jar", "https://cdn.modrinth.com/new.jar");
    plan[0].0.name = "a".repeat(MAX_REGISTRY_BYTES);

    let error = install_files(
        &settings,
        &profile,
        "mod",
        plan,
        CancellationToken::new(),
        |progress| assert_eq!(progress.total_files, 0),
    )
    .await
    .unwrap_err();

    assert_eq!(error.to_string(), "content.errors.registry");
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert_eq!(
        registry(&root).unwrap()["mods/old.jar.disabled"].version_id,
        "old-version"
    );
    assert_eq!(
        fs::read(root.join("mods/old.jar.disabled")).unwrap(),
        b"old"
    );
    assert_eq!(
        fs::read(root.join("mods/new.jar.disabled")).unwrap(),
        b"new"
    );
    assert_eq!(fs::read_dir(root.join("mods")).unwrap().count(), 2);
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}

#[tokio::test]
async fn failed_update_download_preserves_disabled_file_and_registry() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/old.jar.disabled", b"old");
    register(&root, "mods/old.jar.disabled", old_record());
    let before = fs::read(root.join(REGISTRY)).unwrap();
    let (url, server) = serve_file(b"bad").await;

    assert!(
        install_files(
            &settings,
            &profile,
            "mod",
            new_plan("new.jar", &url),
            CancellationToken::new(),
            |_| {},
        )
        .await
        .is_err()
    );
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        fs::read(root.join("mods/old.jar.disabled")).unwrap(),
        b"old"
    );
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert_eq!(fs::read_dir(root.join("mods")).unwrap().count(), 1);
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}

#[tokio::test]
async fn cancelled_reused_update_preserves_old_file_and_registry() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/old.jar.disabled", b"old");
    write_content(&root, "mods/new.jar.disabled", b"new");
    register(&root, "mods/old.jar.disabled", old_record());
    let before = fs::read(root.join(REGISTRY)).unwrap();
    let cancellation = CancellationToken::new();
    let cancel_at_download = cancellation.clone();

    assert!(
        install_files(
            &settings,
            &profile,
            "mod",
            new_plan("new.jar", "https://cdn.modrinth.com/new.jar"),
            cancellation,
            move |progress| {
                assert_eq!(progress.total_files, 0);
                cancel_at_download.cancel();
            },
        )
        .await
        .is_err()
    );

    assert_eq!(
        fs::read(root.join("mods/old.jar.disabled")).unwrap(),
        b"old"
    );
    assert_eq!(
        fs::read(root.join("mods/new.jar.disabled")).unwrap(),
        b"new"
    );
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}
