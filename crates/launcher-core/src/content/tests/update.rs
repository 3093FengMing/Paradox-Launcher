// Content update regressions, kept in content::tests.
#[tokio::test]
async fn reused_files_refresh_records_and_remove_old_versions() {
    for (category, directory, extension) in [
        ("mod", "mods", "jar"),
        ("mod", "mods", "jar.disabled"),
        ("resourcepack", "resourcepacks", "zip"),
        ("shader", "shaderpacks", "zip"),
    ] {
        let (_temp, settings, profile, root) = instance();
        let previous = format!("{directory}/old.{extension}");
        let target = format!("{directory}/new.{extension}");
        write_content(&root, &previous, b"old");
        write_content(&root, &target, b"new");
        register(&root, &previous, old_record());
        let filename = if category == "mod" {
            "new.jar"
        } else {
            "new.zip"
        };

        install_files(
            &settings,
            &profile,
            category,
            new_plan(filename, "https://cdn.modrinth.com/new"),
            CancellationToken::new(),
            |progress| assert_eq!(progress.total_files, 0, "matching file must not download"),
        )
        .await
        .unwrap();

        let records = registry(&root).unwrap();
        assert!(
            !records.contains_key(&previous),
            "old version must be unregistered"
        );
        assert_eq!(records.len(), 1);
        assert_eq!(records[&target].version_id, "new-version");
        assert_eq!(records[&target].title, "New version");
        assert!(!root.join(previous).exists());
        assert_eq!(fs::read(root.join(target)).unwrap(), b"new");
    }
}

#[tokio::test]
async fn unchanged_filename_and_bytes_still_refresh_version_metadata() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/new.jar", b"new");
    register(&root, "mods/new.jar", old_record());

    install_files(
        &settings,
        &profile,
        "mod",
        new_plan("new.jar", "https://cdn.modrinth.com/new.jar"),
        CancellationToken::new(),
        |progress| assert_eq!(progress.total_files, 0),
    )
    .await
    .unwrap();

    let records = registry(&root).unwrap();
    assert_eq!(records["mods/new.jar"].version_id, "new-version");
    assert_eq!(
        records["mods/new.jar"].sha1,
        "c2a6b03f190dfb2b4aa91f8af8d477a9bc3401dc"
    );
    assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"new");
}
