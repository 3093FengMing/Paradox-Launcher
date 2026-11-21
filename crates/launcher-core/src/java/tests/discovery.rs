use super::*;
#[tokio::test]
async fn discovery_candidates_keep_source_priority_and_limit_directory_depth() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap();
    let first = root.join("first");
    let nested = root.join("second/deep");
    for home in [&first, &nested] {
        fs::create_dir_all(home.join("bin")).unwrap();
        fs::write(
            home.join("bin")
                .join(format!("java{}", env::consts::EXE_SUFFIX)),
            b"candidate",
        )
        .unwrap();
    }
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    add_candidate(&first, "configured", &mut candidates, &mut seen);
    add_candidate(&first, "managed", &mut candidates, &mut seen);
    add_candidate(
        Path::new("relative/bin/java"),
        "PATH",
        &mut candidates,
        &mut seen,
    );
    collect_directory(&root, 1, "managed", &mut candidates, &mut seen).await;
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].1, "configured");
    collect_directory(&root, 2, "managed", &mut candidates, &mut seen).await;
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[1].1, "managed");
    assert_eq!(
        candidates[1].0,
        nested
            .join("bin")
            .join(format!("java{}", env::consts::EXE_SUFFIX))
            .canonicalize()
            .unwrap()
    );
}

#[tokio::test]
async fn discovery_reports_probe_failures_with_the_candidate_path() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("missing-java");
    let (installations, warnings) =
        probe_discovery_candidates(vec![(path.clone(), "configured".into())])
            .await
            .unwrap();
    assert!(installations.is_empty());
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].path, path);
    assert!(!warnings[0].message.is_empty());
}

#[test]
fn discovery_ranks_version_architecture_path_and_duplicate_source() {
    fn installation(
        path: &str,
        version: u32,
        architecture: &str,
        source: &str,
    ) -> JavaInstallation {
        JavaInstallation {
            executable: path.into(),
            java_home: path.into(),
            major_version: version,
            version: version.to_string(),
            vendor: "test".into(),
            architecture: architecture.into(),
            source: source.into(),
        }
    }
    let native = env::consts::ARCH;
    let mut installations = vec![
        installation("b-java", 21, native, "PATH"),
        installation("a-java", 17, native, "configured"),
        installation("b-java", 21, native, "configured"),
        installation("z-java", 21, "foreign-architecture", "configured"),
        installation("a-java", 21, native, "managed"),
    ];
    rank_discovered_installations(&mut installations);
    assert_eq!(
        installations
            .iter()
            .map(|entry| entry.executable.to_str().unwrap())
            .collect::<Vec<_>>(),
        ["a-java", "b-java", "z-java", "a-java"]
    );
    assert_eq!(installations[1].source, "configured");
    assert_eq!(installations[3].major_version, 17);
}
