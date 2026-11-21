#[tokio::test]
async fn forge_catalog_hides_unsupported_legacy_games_without_networking() {
    let temp = tempfile::tempdir().unwrap();
    let settings = offline_settings(temp.path().canonicalize().unwrap().join("minecraft"));
    for game in ["1.7.10", "1.12.2", "1.13.2", "1.16.5"] {
        assert!(versions(&settings, "forge", game).await.unwrap().is_empty());
    }
    assert!(!settings.game_directory.exists());
    for game in ["1.17", "1.17.1", "1.18.2", "1.20.1", "26.3"] {
        assert!(
            !legacy_forge_game(game),
            "{game} must not be hidden as legacy"
        );
    }
}

#[tokio::test]
async fn neoforge_catalog_matches_year_releases_and_hotfixes_exactly() {
    for (game, expected) in [
        ("26.3", vec!["26.3.0.100", "26.3.0.99", "26.3.0.75-beta"]),
        ("26.1", vec!["26.1.0.1-beta"]),
        ("26.1.1", vec!["26.1.1.4-beta"]),
        ("26.1.2", vec!["26.1.2.125", "26.1.2.124"]),
    ] {
        let releases = catalog_fixture("neoforge", game, NEOFORGE_METADATA)
            .await
            .unwrap();
        assert_eq!(
            releases
                .iter()
                .map(|entry| entry.version.as_str())
                .collect::<Vec<_>>(),
            expected,
            "wrong NeoForge catalog for Minecraft {game}"
        );
        for release in releases {
            assert_eq!(release.stable, !release.version.ends_with("-beta"));
        }
    }
}

#[tokio::test]
async fn neoforge_catalog_preserves_legacy_mapping_and_rejects_unknown_game_formats() {
    for (game, expected) in [
        ("1.21", vec!["21.0.167"]),
        ("1.21.1", vec!["21.1.265"]),
        ("26.3-snapshot-1", vec![]),
        ("26.3-pre-1", vec![]),
        ("26.3-rc-1", vec![]),
        ("1.21.1.4", vec![]),
        ("26.3.0.1", vec![]),
        ("1.21-pre1", vec![]),
        ("25w14a", vec![]),
        ("25.3", vec![]),
        ("26", vec![]),
        ("26.", vec![]),
    ] {
        let releases = catalog_fixture("neoforge", game, NEOFORGE_METADATA)
            .await
            .unwrap();
        assert_eq!(
            releases
                .iter()
                .map(|entry| entry.version.as_str())
                .collect::<Vec<_>>(),
            expected,
            "wrong NeoForge catalog for Minecraft {game}"
        );
    }
}

#[tokio::test]
#[ignore = "queries the official NeoForge Maven catalog"]
async fn neoforge_live_catalog_contains_year_based_releases() {
    for (game, expected) in [
        ("26.3", "26.3.0.100"),
        ("26.1.2", "26.1.2.125"),
        ("1.21.1", "21.1.265"),
    ] {
        let releases = versions(&Settings::default(), "neoforge", game)
            .await
            .unwrap();
        assert!(
            releases.iter().any(|release| release.version == expected),
            "Minecraft {game} must include its published NeoForge release {expected}"
        );
    }
}

#[tokio::test]
async fn forge_catalog_preserves_full_game_prefix_and_numeric_sorting() {
    let metadata = br#"<metadata><versioning><versions>
            <version>1.21.1-52.0.9</version><version>1.21.1-52.0.10</version>
            <version>1.21.1-52.0.10</version><version>1.21.10-60.0.1</version>
            <version>1.21-51.0.33</version><version>1.21.1-../bad</version>
            </versions></versioning></metadata>"#;
    let releases = catalog_fixture("forge", "1.21.1", metadata).await.unwrap();
    assert_eq!(
        releases
            .iter()
            .map(|release| release.version.as_str())
            .collect::<Vec<_>>(),
        ["52.0.10", "52.0.9"]
    );
}

#[tokio::test]
async fn forge_catalog_preserves_beta_version_and_stability() {
    let metadata = br#"<metadata><versioning><versions>
            <version>1.21.1-52.0.10-beta</version><version>1.21.1-52.0.11</version>
            </versions></versioning></metadata>"#;
    let releases = catalog_fixture("forge", "1.21.1", metadata).await.unwrap();
    assert_eq!(
        releases
            .iter()
            .map(|entry| (entry.version.as_str(), entry.stable))
            .collect::<Vec<_>>(),
        [("52.0.11", true), ("52.0.10-beta", false)]
    );
}

#[tokio::test]
async fn fabric_and_quilt_catalogs_preserve_stability_and_reject_unsafe_versions() {
    let metadata = br#"[{"loader":{"version":"0.16.9","stable":true}},
            {"loader":{"version":"0.16.10","stable":false}},
            {"loader":{"version":"../bad","stable":true}}]"#;
    for loader in ["fabric", "quilt"] {
        let releases = catalog_fixture(loader, "1.21.1", metadata).await.unwrap();
        assert_eq!(
            releases
                .iter()
                .map(|release| (release.version.as_str(), release.stable))
                .collect::<Vec<_>>(),
            [("0.16.10", false), ("0.16.9", true)]
        );
    }
}

#[tokio::test]
async fn quilt_catalog_recognizes_releases_when_the_api_omits_stable() {
    let metadata = br#"[{"loader":{"version":"0.30.0"}},
            {"loader":{"version":"0.30.1-beta.2"}},
            {"loader":{"version":"0.29.3","stable":false}},
            {"loader":{"version":"0.28.1","stable":true}},
            {"loader":{"version":"../bad"}}]"#;
    let releases = catalog_fixture("quilt", "1.20.1", metadata).await.unwrap();
    assert_eq!(
        releases
            .iter()
            .filter(|release| release.stable)
            .map(|release| release.version.as_str())
            .collect::<Vec<_>>(),
        ["0.30.0", "0.28.1"]
    );
    assert!(
        catalog_fixture("fabric", "1.20.1", metadata)
            .await
            .unwrap()
            .iter()
            .filter(|release| release.stable)
            .all(|release| release.version == "0.28.1")
    );
}

#[tokio::test]
async fn catalogs_treat_null_stability_like_a_missing_field() {
    let metadata = br#"[{"loader":{"version":"0.30.0","stable":null}}]"#;
    let quilt = catalog_fixture("quilt", "1.20.1", metadata).await.unwrap();
    assert_eq!(quilt.len(), 1);
    assert!(quilt[0].stable);
    let fabric = catalog_fixture("fabric", "1.20.1", metadata).await.unwrap();
    assert_eq!(fabric.len(), 1);
    assert!(!fabric[0].stable);
}

#[test]
fn loader_versions_are_path_safe_and_vanilla_has_no_loader_version() {
    for version in ["../bad", "x/y", "", "..", "x:bad"] {
        assert!(validate_loader("fabric", version).is_err());
    }
    assert!(validate_loader("vanilla", "").is_ok());
    assert!(validate_loader("vanilla", "0.16.10").is_err());
    assert!(validate_loader("fabric", "0.16.10").is_ok());
    assert!(numeric_parts("0.16.10") > numeric_parts("0.16.9"));
}
