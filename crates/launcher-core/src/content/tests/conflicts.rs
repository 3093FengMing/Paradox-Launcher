// Content conflicts regressions, kept in content::tests.
#[tokio::test]
async fn matching_file_owned_by_another_project_is_a_conflict() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/new.jar", b"new");
    let mut record = old_record();
    record.project_id = "other-project".into();
    register(&root, "mods/new.jar", record);
    let before = fs::read(root.join(REGISTRY)).unwrap();

    let error = install_files(
        &settings,
        &profile,
        "mod",
        new_plan("new.jar", "https://cdn.modrinth.com/new.jar"),
        CancellationToken::new(),
        |progress| assert_eq!(progress.total_files, 0),
    )
    .await
    .unwrap_err();

    assert_eq!(error.to_string(), "content.errors.conflict");
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"new");
}

#[tokio::test]
async fn dependency_cannot_reuse_a_file_scheduled_for_removal_by_another_project() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/shared.jar", b"new");
    write_content(&root, "mods/new.jar", b"new");
    register(&root, "mods/shared.jar", old_record());
    let before = fs::read(root.join(REGISTRY)).unwrap();
    let mut plan = new_plan("new.jar", "https://cdn.modrinth.com/new.jar");
    let mut dependency = new_plan("shared.jar", "https://cdn.modrinth.com/shared.jar");
    dependency[0].0.project_id = "dependency".into();
    dependency[0].0.id = "dependency-version".into();
    plan.extend(dependency);

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

    assert_eq!(error.to_string(), "content.errors.conflict");
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert_eq!(fs::read(root.join("mods/shared.jar")).unwrap(), b"new");
    assert_eq!(fs::read(root.join("mods/new.jar")).unwrap(), b"new");
}
