// Content toggle regressions, kept in content::tests.
#[test]
fn failed_mod_toggle_staging_preserves_filename_and_registration() {
    for partial_write in [false, true] {
        let (_temp, settings, profile, root) = instance();
        write_content(&root, "mods/old.jar", b"old");
        register(&root, "mods/old.jar", old_record());
        let before = fs::read(root.join(REGISTRY)).unwrap();
        let result = toggle_with_staging(&settings, &profile, "old.jar", |root, _records| {
            if partial_write {
                let stage = tempfile::tempdir_in(root)?;
                fs::write(stage.path().join(REGISTRY), b"partial write")?;
            }
            Err(std::io::Error::other("injected staging I/O failure").into())
        });
        assert!(result.is_err());
        assert_eq!(fs::read(root.join("mods/old.jar")).unwrap(), b"old");
        assert!(!root.join("mods/old.jar.disabled").exists());
        assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
        assert_eq!(fs::read_dir(root).unwrap().count(), 2);
    }
}

#[test]
fn mod_toggle_updates_filename_and_registration_together() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/old.jar", b"old");
    register(&root, "mods/old.jar", old_record());
    for (before, after, enabled) in [
        ("old.jar", "old.jar.disabled", false),
        ("old.jar.disabled", "old.jar", true),
    ] {
        toggle(&settings, &profile, before).unwrap();
        assert!(!root.join("mods").join(before).exists());
        assert_eq!(fs::read(root.join("mods").join(after)).unwrap(), b"old");
        let records = registry(&root).unwrap();
        assert!(!records.contains_key(&format!("mods/{before}")));
        assert_eq!(records[&format!("mods/{after}")].version_id, "old-version");
        let entries = list(&settings, &profile, "mods").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].enabled, enabled);
    }
}

#[test]
fn failed_mod_toggle_publication_restores_filename_and_registration() {
    let (_temp, settings, profile, root) = instance();
    write_content(&root, "mods/old.jar.disabled", b"old");
    register(&root, "mods/old.jar.disabled", old_record());
    let before = fs::read(root.join(REGISTRY)).unwrap();
    let result =
        toggle_with_staging(&settings, &profile, "old.jar.disabled", |root, _records| {
            // Missing staged registration forces a failure after the original
            // registration has been moved to the publication backup.
            Ok(tempfile::tempdir_in(root)?)
        });
    assert!(result.is_err());
    assert_eq!(
        fs::read(root.join("mods/old.jar.disabled")).unwrap(),
        b"old"
    );
    assert!(!root.join("mods/old.jar").exists());
    assert_eq!(fs::read(root.join(REGISTRY)).unwrap(), before);
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
}
