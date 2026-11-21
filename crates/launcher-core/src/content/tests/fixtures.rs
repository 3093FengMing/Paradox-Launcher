// Content fixtures regressions, kept in content::tests.
fn instance() -> (tempfile::TempDir, Settings, GameProfile, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let settings = Settings {
        game_directory: temp.path().join("minecraft"),
        network: crate::network::NetworkOptions {
            max_retries: 0,
            timeout_seconds: 3,
            ..Default::default()
        },
        ..Settings::default()
    };
    let mut profile = GameProfile::new("Content updates", "1.21.1").unwrap();
    profile.loader = "fabric".into();
    profile.loader_version = "0.16.10".into();
    let root = root(&settings, &profile).unwrap();
    fs::create_dir_all(&root).unwrap();
    (temp, settings, profile, root)
}

fn old_record() -> ContentRecord {
    ContentRecord {
        project_id: "project".into(),
        version_id: "old-version".into(),
        title: "Old version".into(),
        url: "https://cdn.modrinth.com/old.jar".into(),
        sha1: hex::encode(Sha1::digest(b"old")),
        size: 3,
    }
}

fn new_plan(filename: &str, url: &str) -> Vec<(Version, RemoteFile)> {
    let file = RemoteFile {
        url: url.into(),
        filename: filename.into(),
        size: 3,
        primary: true,
        hashes: BTreeMap::from([(
            "sha1".into(),
            "c2a6b03f190dfb2b4aa91f8af8d477a9bc3401dc".into(),
        )]),
    };
    vec![(
        Version {
            id: "new-version".into(),
            project_id: "project".into(),
            name: "New version".into(),
            game_versions: vec!["1.21.1".into()],
            loaders: vec!["fabric".into()],
            files: vec![file.clone()],
            dependencies: Vec::new(),
        },
        file,
    )]
}

fn write_content(root: &Path, relative: &str, bytes: &[u8]) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, bytes).unwrap();
}

fn register(root: &Path, relative: &str, record: ContentRecord) {
    fs::write(
        root.join(REGISTRY),
        registry_bytes(&BTreeMap::from([(relative.into(), record)])).unwrap(),
    )
    .unwrap();
}
