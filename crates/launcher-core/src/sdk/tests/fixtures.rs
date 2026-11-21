// SDK fixtures behavior regressions; included in sdk::tests.
fn directory_link(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(java_compatible_path(link))
            .arg(java_compatible_path(target))
            .creation_flags(0x0800_0000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

fn vanilla_metadata(profile: &GameProfile) -> ResolvedVanillaMetadata {
    ResolvedVanillaMetadata::new(
        serde_json::from_value(serde_json::json!({
            "assetIndex": {"id": "17", "sha1": "0".repeat(40), "size": 0,
                "totalSize": 0, "url": "https://piston-meta.mojang.com/v1/packages/index.json"},
            "assets": "17", "complianceLevel": 1,
            "downloads": {"client": {"sha1": "0".repeat(40), "size": 0,
                "url": "https://piston-data.mojang.com/v1/objects/da39a3ee5e6b4b0d3255bfef95601890afd80709/client.jar"}},
            "id": profile.game_version, "javaVersion": {"component": "java-runtime", "majorVersion": 21},
            "libraries": [], "mainClass": "example.Main", "minimumLauncherVersion": 21,
            "type": "release", "time": "2024-01-01T00:00:00Z", "releaseTime": "2024-01-01T00:00:00Z"
        })).unwrap(),
        serde_json::from_value(serde_json::json!({"objects": {}})).unwrap(),
    )
}
