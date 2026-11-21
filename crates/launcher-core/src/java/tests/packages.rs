use super::*;
#[test]
fn untrusted_java_package_urls_are_rejected() {
    let mut package = JavaPackage {
        major_version: 21,
        version: "21.0.1".into(),
        filename: "runtime.zip".into(),
        url: "https://github.com/adoptium/temurin21-binaries/releases/download/v1/runtime.zip"
            .into(),
        sha256: "a".repeat(64),
        size: 1024,
    };
    assert!(validate_package(&package).is_ok());
    for url in [
        "http://github.com/adoptium/temurin21-binaries/releases/download/v1/runtime.zip",
        "https://github.com/other/runtime.zip",
        "https://example.com/runtime.zip",
        "https://user:secret@github.com/adoptium/temurin21-binaries/releases/download/v1/runtime.zip",
    ] {
        package.url = url.into();
        assert!(validate_package(&package).is_err(), "{url}");
    }
}
