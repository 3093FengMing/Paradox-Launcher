use super::*;
#[tokio::test]
async fn java_probe_retains_selected_wrapper_and_javaw_outside_reported_home() {
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("reported Java 中文 home");
    let wrappers = temporary.path().join("selected wrappers");
    fs::create_dir_all(home.join("bin")).unwrap();
    fs::create_dir_all(&wrappers).unwrap();
    let source = temporary.path().join("java_fixture.rs");
    fs::write(&source, format!(r#"
fn main() {{
    eprintln!("java.version = 21.0.1\njava.specification.version = 21\njava.home = {{}}\nos.arch = {{}}\njava.vendor = fixture", {:?}, std::env::consts::ARCH);
}}
"#, home.to_string_lossy())).unwrap();
    let java = wrappers.join(format!("java{}", env::consts::EXE_SUFFIX));
    let mut compiler = std::process::Command::new("rustc");
    compiler
        .arg("--edition=2024")
        .arg(&source)
        .arg("-o")
        .arg(&java);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        compiler.creation_flags(0x0800_0000);
    }
    let output = compiler.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    fs::copy(&java, home.join("bin").join(java.file_name().unwrap())).unwrap();
    let javaw = wrappers.join(format!("javaw{}", env::consts::EXE_SUFFIX));
    fs::copy(&java, &javaw).unwrap();
    for selected in [&java, &javaw] {
        let installation = select_runtime(21, Some(selected), temporary.path())
            .await
            .unwrap();
        assert_eq!(installation.executable, selected.canonicalize().unwrap());
        assert_eq!(installation.java_home, home.canonicalize().unwrap());
        assert_eq!(installation.major_version, 21);
        assert!(
            select_runtime(17, Some(selected), temporary.path())
                .await
                .is_err()
        );
    }
}

#[test]
fn java_versions_and_properties_are_parsed_precisely() {
    for (version, expected) in [
        ("1.8.0_181", 8),
        ("17.0.2", 17),
        ("21.0.12+1-LTS", 21),
        ("26-ea", 26),
    ] {
        assert_eq!(parse_major_version(version), Some(expected));
    }
    assert_eq!(parse_major_version("invalid"), None);
    assert_eq!(
        property(
            " java.version = 21.0.1\n java.vm.version = 21.0.1+1",
            "java.version"
        ),
        Some("21.0.1".into())
    );
}

#[test]
fn installed_metadata_controls_java_compatibility() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("中文实例");
    fs::create_dir(&root).unwrap();
    let metadata = root.join("中文实例.json");
    fs::write(&metadata, br#"{"javaVersion":{"majorVersion":21}}"#).unwrap();
    assert_eq!(required_java_major_version(&root).unwrap(), 21);
    fs::write(&metadata, b"{}").unwrap();
    assert_eq!(required_java_major_version(&root).unwrap(), 8);
    for invalid in [
        br#"{"javaVersion":{"majorVersion":0}}"#.as_slice(),
        br#"{"javaVersion":{"majorVersion":"21"}}"#.as_slice(),
        br#"{"javaVersion":null}"#.as_slice(),
        b"{invalid}".as_slice(),
    ] {
        fs::write(&metadata, invalid).unwrap();
        assert!(required_java_major_version(&root).is_err());
    }
}
