// Content rollback regressions, kept in content::tests.
#[test]
fn failed_update_publication_restores_removed_version_and_registry() {
    let (_temp, _settings, _profile, root) = instance();
    write_content(&root, "mods/old.jar.disabled", b"old");
    register(&root, "mods/old.jar.disabled", old_record());
    let before = fs::read(root.join(REGISTRY)).unwrap();
    let stage = tempfile::tempdir().unwrap();
    write_content(stage.path(), "mods/new.jar.disabled", b"new");
    fs::write(stage.path().join(REGISTRY), b"{}").unwrap();

    assert!(
        commit(
            &root,
            stage.path(),
            &[
                "mods/new.jar.disabled".into(),
                REGISTRY.into(),
                "missing".into()
            ],
            &["mods/old.jar.disabled".into()],
        )
        .is_err()
    );

    assert_eq!(
        fs::read(root.join("mods/old.jar.disabled")).unwrap(),
        b"old"
    );
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert!(!root.join("mods/new.jar.disabled").exists());
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}
#[test]
fn invalid_paths_and_download_urls_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    for name in ["../x", "C:/x", "x\\y", "/x", "mods/CON.jar"] {
        assert!(path(temp.path(), name).is_err());
    }
    let mut file = RemoteFile {
        url: "https://cdn.modrinth.com/a.jar".into(),
        filename: "a.jar".into(),
        size: 10,
        primary: true,
        hashes: BTreeMap::from([("sha1".into(), "a".repeat(40))]),
    };
    validate_remote(&file).unwrap();
    file.url = "http://evil.invalid/a".into();
    assert!(validate_remote(&file).is_err());
}
#[test]
fn rollback_path_failures_continue_restoration_and_preserve_unrestored_backups() {
    let (_temp, _settings, _profile, root) = instance();
    let backups = tempfile::tempdir_in(&root).unwrap();
    let backup_path = backups.path().to_owned();
    write_content(&root, "mods/published.jar", b"new");
    write_content(backups.path(), "mods/restored.jar", b"original");
    write_content(backups.path(), "mods/blocked.jar", b"recover this");
    fs::create_dir_all(root.join("mods/blocked.jar")).unwrap();

    let error = rollback(
        &root,
        backups,
        &["mods/published.jar".into(), "../invalid".into()],
        &[
            "mods/restored.jar".into(),
            "mods/blocked.jar".into(),
            "../invalid".into(),
        ],
    )
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("content.errors.recovery: {}", backup_path.display())
    );
    assert!(!root.join("mods/published.jar").exists());
    assert_eq!(
        fs::read(root.join("mods/restored.jar")).unwrap(),
        b"original"
    );
    assert_eq!(
        fs::read(backup_path.join("mods/blocked.jar")).unwrap(),
        b"recover this"
    );
    assert!(root.join("mods/blocked.jar").is_dir());
}

#[test]
fn failed_publication_restores_all_original_files() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a"), b"old").unwrap();
    fs::write(stage.path().join("a"), b"new").unwrap();
    assert!(
        commit(
            root.path(),
            stage.path(),
            &["a".into(), "missing".into()],
            &[]
        )
        .is_err()
    );
    assert_eq!(fs::read(root.path().join("a")).unwrap(), b"old");
}
