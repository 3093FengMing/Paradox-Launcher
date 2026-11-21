// SDK metadata behavior regressions; included in sdk::tests.
#[tokio::test]
async fn metadata_persistence_writes_validated_instance_and_asset_index() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap().join("minecraft");
    let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
    let paths = crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
    let instance = Storage::with_parent(
        paths.instance.clone(),
        Storage::new(&root, SharedRootLayout::default()),
        SharedInstanceLayout::default(),
    );
    persist_vanilla_metadata(vanilla_metadata(&profile), &profile, &paths, &instance)
        .await
        .unwrap();
    let persisted: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            paths
                .instance
                .join(format!("{}.json", profile.instance_key)),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(persisted["id"], "1.21.1");
    assert_eq!(
        std::fs::read(root.join("assets/indexes/17.json")).unwrap(),
        br#"{"objects":{}}"#
    );
}

#[tokio::test]
async fn metadata_persistence_rejects_invalid_identity_and_index_before_creating_directories() {
    for invalid_identity in [false, true] {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap().join("minecraft");
        let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
        let paths =
            crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
        let instance = Storage::with_parent(
            paths.instance.clone(),
            Storage::new(&root, SharedRootLayout::default()),
            SharedInstanceLayout::default(),
        );
        let mut metadata = vanilla_metadata(&profile);
        if invalid_identity {
            metadata.metadata.id = "1.20.1".into();
        } else {
            metadata.metadata.asset_index.id = "../outside".into();
        }
        assert!(
            persist_vanilla_metadata(metadata, &profile, &paths, &instance)
                .await
                .is_err()
        );
        assert!(!root.exists());
    }
}
