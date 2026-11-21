use super::*;
#[test]
fn zip_paths_cannot_escape_or_address_windows_devices() {
    for path in [
        "../outside",
        "/outside",
        "C:/outside",
        "dir/../outside",
        "dir\\outside",
        "NUL.txt",
        "file:stream",
        "dir/COM1",
        "file.",
    ] {
        assert!(validate_archive_path(Path::new(path)).is_err(), "{path}");
    }
    assert!(validate_archive_path(Path::new("jdk/bin/java.exe")).is_ok());
}

#[test]
fn malicious_zip_entries_never_create_outside_files() {
    for symlink in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("malicious.zip");
        let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
        if symlink {
            writer
                .add_symlink("link", "../outside", SimpleFileOptions::default())
                .unwrap();
        } else {
            writer
                .start_file("../outside", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"unexpected").unwrap();
        }
        writer.finish().unwrap();
        let staging = directory.path().join("staging");
        fs::create_dir(&staging).unwrap();
        assert!(extract_archive(&archive, &staging, &CancellationToken::new()).is_err());
        assert!(!directory.path().join("outside").exists());
        assert_eq!(fs::read_dir(staging).unwrap().count(), 0);
    }
}

#[test]
fn archive_extracts_only_inside_staging_and_respects_cancellation() {
    let directory = tempfile::tempdir().unwrap();
    let archive = directory.path().join("runtime.zip");
    let file = File::create(&archive).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    writer
        .start_file(
            format!("jdk/bin/java{}", env::consts::EXE_SUFFIX),
            SimpleFileOptions::default(),
        )
        .unwrap();
    writer.write_all(b"placeholder executable").unwrap();
    writer.finish().unwrap();
    let staging = directory.path().join("staging");
    fs::create_dir(&staging).unwrap();
    let cancellation = CancellationToken::new();
    assert_eq!(
        extract_archive(&archive, &staging, &cancellation).unwrap(),
        staging.join("jdk")
    );
    let cancelled_staging = directory.path().join("cancelled");
    fs::create_dir(&cancelled_staging).unwrap();
    cancellation.cancel();
    assert!(extract_archive(&archive, &cancelled_staging, &cancellation).is_err());
    assert_eq!(fs::read_dir(cancelled_staging).unwrap().count(), 0);
}
