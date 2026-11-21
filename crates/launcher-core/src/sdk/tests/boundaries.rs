// SDK boundaries behavior regressions; included in sdk::tests.
#[cfg(any(unix, windows))]
#[tokio::test]
async fn metadata_persistence_rechecks_index_links_before_overwriting_instance_json() {
    let temporary = tempfile::tempdir().unwrap();
    let base = temporary.path().canonicalize().unwrap();
    let root = base.join("minecraft");
    let outside = base.join("outside");
    let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
    let paths = crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
    std::fs::create_dir_all(&paths.instance).unwrap();
    std::fs::create_dir_all(root.join("assets")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let instance_json = paths
        .instance
        .join(format!("{}.json", profile.instance_key));
    std::fs::write(&instance_json, b"original").unwrap();
    directory_link(&outside, &root.join("assets/indexes"));
    let instance = Storage::with_parent(
        paths.instance.clone(),
        Storage::new(&root, SharedRootLayout::default()),
        SharedInstanceLayout::default(),
    );
    assert!(
        persist_vanilla_metadata(vanilla_metadata(&profile), &profile, &paths, &instance)
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(instance_json).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
}

#[cfg(any(unix, windows))]
#[tokio::test]
async fn vanilla_install_rejects_existing_sdk_links_before_creating_instance() {
    let platform_natives =
        elemental::driver::families::version_json::VersionJsonPlatform::current()
            .natives_dir_name();
    for target in [
        "assets/indexes".to_owned(),
        "natives/nested".to_owned(),
        ".elemental/state".to_owned(),
        "metadata".to_owned(),
        format!("{platform_natives}/nested"),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("minecraft");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
        let instance = root.join("versions").join(&profile.instance_key);
        let linked = if target == "metadata" {
            instance.join(format!("{}.json", profile.instance_key))
        } else if target.starts_with("assets/") {
            root.join(&target)
        } else {
            instance.join(&target)
        };
        std::fs::create_dir_all(linked.parent().unwrap()).unwrap();
        directory_link(&outside, &linked);
        let settings = Settings {
            game_directory: root,
            ..Settings::default()
        };
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let error = ElementalService::new(&settings)
            .unwrap()
            .prepare_with_progress(&profile, cancellation, |_| {})
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("loaders.errors.path"),
            "{target}: {error}"
        );
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
        if target.starts_with("assets/") {
            assert!(
                !instance.exists(),
                "validation must precede ensure_instance"
            );
        }
    }
}

#[cfg(any(unix, windows))]
#[tokio::test]
async fn vanilla_install_rejects_root_links_and_linked_root_ancestors() {
    for suffix in ["", "minecraft", "missing/minecraft"] {
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("outside");
        let alias = temp.path().canonicalize().unwrap().join("alias");
        std::fs::create_dir_all(&outside).unwrap();
        directory_link(&outside, &alias);
        let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
        let settings = Settings {
            game_directory: alias.join(suffix),
            ..Settings::default()
        };
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let error = ElementalService::new(&settings)
            .unwrap()
            .prepare_with_progress(&profile, cancellation, |_| {})
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("loaders.errors.path"),
            "{suffix}: {error}"
        );
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
    }
}

#[cfg(any(unix, windows))]
#[test]
fn artifact_validation_rejects_links_even_when_they_resolve_inside_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("minecraft");
    let destination = root.join("real");
    std::fs::create_dir_all(&destination).unwrap();
    directory_link(&destination, &root.join("libraries"));
    assert!(
        validate_artifact_target(
            &root,
            &root.canonicalize().unwrap(),
            &root.join("libraries/library.jar")
        )
        .is_err()
    );
}

#[test]
fn artifact_validation_accepts_normal_new_and_existing_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("minecraft");
    std::fs::create_dir_all(&root).unwrap();
    let canonical = root.canonicalize().unwrap();
    for relative in ["libraries/group/library.jar", "assets/indexes/1.21.json"] {
        let target = root.join(relative);
        validate_artifact_target(&root, &canonical, &target).unwrap();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"existing").unwrap();
        validate_artifact_target(&root, &canonical, &target).unwrap();
    }
    assert!(validate_artifact_target(&root, &canonical, &root).is_err());
    assert!(validate_artifact_target(&root, &canonical, &root.join("../outside")).is_err());
}
