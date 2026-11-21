//! Verified portable pack archives; imports never overwrite SDK metadata.

mod export;
mod index;
mod inspect;
mod install;

pub use export::export;
pub use index::{PackFile, PackIndex, content_path, profile};
pub use inspect::inspect;
pub use install::install;

const MAX_ARCHIVE_SIZE: u64 = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10000;
const MAX_OVERRIDE_SIZE: u64 = 128 * 1024 * 1024;
const MAX_OVERRIDES_SIZE: u64 = 2 * 1024 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::export::export_with_size_limit;
    use super::index::validate_index;
    use super::*;
    use crate::{GameProfile, Settings, content};
    use std::{
        collections::BTreeMap,
        fs,
        io::{Read, Write},
        path::Path,
    };
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn exporting_into_content_does_not_include_the_active_archive() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Nested export", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/settings.txt"), b"setting=true").unwrap();
        let archive = root.join("config/./export.mrpack");
        fs::write(&archive, b"previous export").unwrap();

        export(&settings, &source, &archive, false).unwrap();

        let mut zip = zip::ZipArchive::new(fs::File::open(&archive).unwrap()).unwrap();
        assert_eq!(zip.len(), 2);
        let mut bytes = Vec::new();
        zip.by_name("overrides/config/settings.txt")
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, b"setting=true");
        drop(zip);

        let target = profile(&inspect(&archive).unwrap()).unwrap();
        install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        let imported = content::root(&settings, &target).unwrap();
        assert_eq!(
            fs::read(imported.join("config/settings.txt")).unwrap(),
            b"setting=true"
        );
        assert_eq!(fs::read_dir(imported.join("config")).unwrap().count(), 1);
    }

    #[test]
    fn unimportable_large_override_preserves_the_existing_export() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Large world", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("saves")).unwrap();
        fs::File::create(root.join("saves/large.dat"))
            .unwrap()
            .set_len(128 * 1024 * 1024 + 1)
            .unwrap();
        let archive = temp.path().join("existing.mrpack");
        fs::write(&archive, b"existing archive").unwrap();

        let error = export(&settings, &source, &archive, true).unwrap_err();

        assert!(error.to_string().contains("content.errors.size"));
        assert_eq!(fs::read(&archive).unwrap(), b"existing archive");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    #[test]
    fn export_reserves_an_archive_entry_for_the_index() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Many files", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        for number in 0..10000 {
            fs::write(root.join(format!("config/{number}.txt")), b"").unwrap();
        }
        let archive = temp.path().join("existing.mrpack");
        fs::write(&archive, b"existing archive").unwrap();

        let error = export(&settings, &source, &archive, false).unwrap_err();

        assert!(error.to_string().contains("content.errors.size"));
        assert_eq!(fs::read(&archive).unwrap(), b"existing archive");
    }

    #[test]
    fn an_archive_exceeding_the_import_size_limit_preserves_the_existing_export() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("Archive size", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/settings.txt"), b"setting=true").unwrap();
        let archive = temp.path().join("existing.mrpack");
        fs::write(&archive, b"existing archive").unwrap();

        let error = export_with_size_limit(&settings, &source, &archive, false, 64).unwrap_err();

        assert!(error.to_string().contains("content.errors.size"));
        assert_eq!(fs::read(&archive).unwrap(), b"existing archive");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    fn write_pack(archive: &Path, files: Vec<PackFile>, entries: &[(&str, &[u8])]) {
        let index = PackIndex {
            format_version: 1,
            game: "minecraft".into(),
            version_id: "v1".into(),
            name: "Override pack".into(),
            files,
            dependencies: BTreeMap::from([("minecraft".into(), "1.21.1".into())]),
        };
        let mut zip = zip::ZipWriter::new(fs::File::create(archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("modrinth.index.json", options).unwrap();
        zip.write_all(&serde_json::to_vec(&index).unwrap()).unwrap();
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn write_override_pack(archive: &Path) {
        write_pack(
            archive,
            vec![],
            &[
                ("overrides/config/shared.txt", b"generic"),
                ("client-overrides/config/shared.txt", b"client"),
                ("overrides/config/additional.txt", b"additional"),
            ],
        );
    }

    fn write_indexed_client_override_pack(archive: &Path, client_contents: &[u8]) {
        write_pack(
            archive,
            vec![PackFile {
                path: "config/shared.txt".into(),
                hashes: BTreeMap::from([(
                    "sha1".into(),
                    // SHA-1 of the indexed contents, "abc".
                    "a9993e364706816aba3e25717850c26c9cd0d89d".into(),
                )]),
                downloads: vec!["https://cdn.modrinth.com/indexed.txt".into()],
                file_size: 3,
                env: BTreeMap::new(),
            }],
            &[
                ("client-overrides/config/shared.txt", client_contents),
                ("overrides/config/additional.txt", b"additional"),
            ],
        );
    }

    #[tokio::test]
    async fn indexed_client_overrides_can_be_reimported_with_the_same_final_contents() {
        for client_contents in [b"xyz".as_slice(), b"client".as_slice()] {
            let temp = tempfile::tempdir().unwrap();
            let settings = Settings {
                game_directory: temp.path().join("minecraft"),
                ..Settings::default()
            };
            let archive = temp.path().join("indexed-client.mrpack");
            write_indexed_client_override_pack(&archive, client_contents);
            let target = profile(&inspect(&archive).unwrap()).unwrap();
            let root = content::root(&settings, &target).unwrap();
            fs::create_dir_all(root.join("config")).unwrap();
            // The previous import leaves the client override, not the indexed bytes.
            fs::write(root.join("config/shared.txt"), client_contents).unwrap();

            for _ in 0..2 {
                install(
                    &settings,
                    &target,
                    &archive,
                    CancellationToken::new(),
                    |progress| assert_eq!(progress.total_files, 0),
                )
                .await
                .unwrap();

                assert_eq!(
                    fs::read(root.join("config/shared.txt")).unwrap(),
                    client_contents
                );
                assert_eq!(
                    fs::read(root.join("config/additional.txt")).unwrap(),
                    b"additional"
                );
            }
        }
    }

    #[tokio::test]
    async fn conflicting_indexed_client_override_preserves_installed_files() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let archive = temp.path().join("indexed-client.mrpack");
        write_indexed_client_override_pack(&archive, b"client");
        let target = profile(&inspect(&archive).unwrap()).unwrap();
        let root = content::root(&settings, &target).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/shared.txt"), b"user customization").unwrap();

        let error = install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |progress| assert_eq!(progress.total_files, 0),
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("content.errors.conflict"));
        assert_eq!(
            fs::read(root.join("config/shared.txt")).unwrap(),
            b"user customization"
        );
        assert!(!root.join("config/additional.txt").exists());
    }

    #[tokio::test]
    async fn client_overrides_can_be_installed_twice_with_the_same_final_contents() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let archive = temp.path().join("overrides.mrpack");
        write_override_pack(&archive);
        let target = profile(&inspect(&archive).unwrap()).unwrap();
        let root = content::root(&settings, &target).unwrap();

        for _ in 0..2 {
            install(
                &settings,
                &target,
                &archive,
                CancellationToken::new(),
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(fs::read(root.join("config/shared.txt")).unwrap(), b"client");
            assert_eq!(
                fs::read(root.join("config/additional.txt")).unwrap(),
                b"additional"
            );
        }
    }

    #[tokio::test]
    async fn conflicting_final_override_preserves_installed_files() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let archive = temp.path().join("overrides.mrpack");
        write_override_pack(&archive);
        let target = profile(&inspect(&archive).unwrap()).unwrap();
        let root = content::root(&settings, &target).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/shared.txt"), b"user customization").unwrap();

        let error = install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("content.errors.conflict"));
        assert_eq!(
            fs::read(root.join("config/shared.txt")).unwrap(),
            b"user customization"
        );
        assert!(!root.join("config/additional.txt").exists());
    }

    #[test]
    fn malicious_pack_paths_and_multiple_loaders_are_rejected() {
        for path in [
            "../x",
            "mods/../../x",
            "mods/CON.jar",
            "versions/a.json",
            ".paradox-content.json",
            "config/x\\y",
        ] {
            assert!(content_path(path).is_err());
        }
        let mut index = PackIndex {
            format_version: 1,
            game: "minecraft".into(),
            version_id: "v1".into(),
            name: "test".into(),
            files: vec![],
            dependencies: BTreeMap::from([
                ("minecraft".into(), "1.21.1".into()),
                ("fabric-loader".into(), "0.16.10".into()),
            ]),
        };
        validate_index(&index).unwrap();
        index.dependencies.insert("forge".into(), "51.0.0".into());
        assert!(validate_index(&index).is_err());
    }
    #[tokio::test]
    async fn portable_export_import_round_trips_local_files_without_private_configuration() {
        let temp = tempfile::tempdir().unwrap();
        let settings = Settings {
            game_directory: temp.path().join("minecraft"),
            ..Settings::default()
        };
        let source = GameProfile::new("My pack", "1.21.1").unwrap();
        let root = content::root(&settings, &source).unwrap();
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::write(root.join("mods/local.jar"), b"LOCAL").unwrap();
        fs::write(root.join("account-secret"), b"SECRET").unwrap();
        let archive = temp.path().join("portable.mrpack");
        export(&settings, &source, &archive, false).unwrap();
        let index = inspect(&archive).unwrap();
        let target = profile(&index).unwrap();
        install(
            &settings,
            &target,
            &archive,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read(
                content::root(&settings, &target)
                    .unwrap()
                    .join("mods/local.jar")
            )
            .unwrap(),
            b"LOCAL"
        );
        assert!(
            !content::root(&settings, &target)
                .unwrap()
                .join("account-secret")
                .exists()
        );
    }
}
