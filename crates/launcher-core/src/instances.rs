//! Validated instance settings, scan registration, and filesystem transactions.

mod paths;
mod registration;
mod removal;
mod settings;

pub use paths::InstanceLocation;
pub use registration::{
    RegistrationSummary, register_instances_from_scan, registration_from_scan,
    remove_profile_record, scan_game_root, scan_known_game_root,
};
pub use removal::{
    FileRemoval, PreparedProfileRemoval, prepare_profile_file_removal, remove_instance_files,
    remove_profile_files,
};
pub use settings::{ProfileOverrides, effective_settings};

#[cfg(test)]
mod tests {
    use super::paths::canonical_game_root;
    use super::*;
    use crate::{AppConfig, GameProfile, InstalledInstance, Settings};
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    fn game_root() -> (tempfile::TempDir, PathBuf) {
        let temporary = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temporary.path()).unwrap().join("游戏 根");
        fs::create_dir_all(root.join("versions")).unwrap();
        (temporary, root)
    }

    fn installed(root: &Path, key: &str) -> InstalledInstance {
        let instance_root = root.join("versions").join(key);
        fs::create_dir_all(&instance_root).unwrap();
        fs::write(instance_root.join(format!("{key}.json")), b"{}").unwrap();
        fs::write(instance_root.join(format!("{key}.jar")), b"test fixture").unwrap();
        InstalledInstance {
            instance_key: key.to_owned(),
            game_version: Some("1.21.1".into()),
            loader: "vanilla".into(),
            loader_version: None,
            root: instance_root,
        }
    }

    #[test]
    fn empty_overrides_inherit_all_global_settings() {
        let global = Settings::default();
        let overrides: ProfileOverrides = serde_json::from_str("{}").unwrap();
        assert!(overrides.is_empty());
        let effective = effective_settings(&global, None, &overrides).unwrap();
        assert_eq!(
            serde_json::to_value(global).unwrap(),
            serde_json::to_value(effective).unwrap()
        );
    }

    #[test]
    fn overrides_replace_values_and_can_clear_global_strings() {
        let global = Settings {
            java_executable: std::env::current_exe().unwrap().display().to_string(),
            extra_jvm_arguments: "-Dexample=global".into(),
            extra_game_arguments: "--fullscreen".into(),
            ..Settings::default()
        };
        let overrides = ProfileOverrides {
            java_executable: Some(String::new()),
            memory_mb: Some(8192),
            extra_jvm_arguments: Some(String::new()),
            extra_game_arguments: Some("--demo".into()),
            ..ProfileOverrides::default()
        };
        let effective = effective_settings(&global, None, &overrides).unwrap();
        assert!(effective.java_executable.is_empty());
        assert!(effective.extra_jvm_arguments.is_empty());
        assert_eq!(effective.memory_mb, 8192);
        assert_eq!(effective.extra_game_arguments, "--demo");
        assert_eq!(global.memory_mb, 4096);
        assert_eq!(global.extra_game_arguments, "--fullscreen");
    }

    #[test]
    fn template_arguments_replace_global_then_allow_explicit_instance_values() {
        let template = crate::preferences::ArgumentTemplate {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Template".into(),
            jvm: "-Dsource=template".into(),
            game: "--demo".into(),
            environment: Default::default(),
        };
        let mut overrides = ProfileOverrides {
            argument_template: Some(template.id.clone()),
            ..ProfileOverrides::default()
        };
        let global = Settings {
            extra_jvm_arguments: "-Dsource=global".into(),
            extra_game_arguments: "--fullscreen".into(),
            argument_templates: vec![template],
            ..Settings::default()
        };
        let effective = effective_settings(&global, None, &overrides).unwrap();
        assert_eq!(effective.extra_jvm_arguments, "-Dsource=template");
        assert_eq!(effective.extra_game_arguments, "--demo");
        overrides.extra_jvm_arguments = Some(String::new());
        overrides.extra_game_arguments = Some("--width 900".into());
        let effective = effective_settings(&global, None, &overrides).unwrap();
        assert_eq!(effective.extra_jvm_arguments, "");
        assert_eq!(effective.extra_game_arguments, "--width 900");
        assert_eq!(global.extra_jvm_arguments, "-Dsource=global");
        overrides.argument_template = Some(uuid::Uuid::new_v4().to_string());
        assert!(effective_settings(&global, None, &overrides).is_err());
    }

    #[test]
    fn effective_settings_validate_the_combined_memory_and_paths() {
        let global = Settings::default();
        for overrides in [
            ProfileOverrides {
                memory_mb: Some(64),
                ..ProfileOverrides::default()
            },
            ProfileOverrides {
                minimum_memory_mb: Some(8192),
                ..ProfileOverrides::default()
            },
            ProfileOverrides {
                java_executable: Some("java.exe".into()),
                ..ProfileOverrides::default()
            },
            ProfileOverrides {
                resolution_width: Some(100),
                ..ProfileOverrides::default()
            },
        ] {
            assert!(effective_settings(&global, None, &overrides).is_err());
        }
        assert!(
            effective_settings(
                &global,
                Some(Path::new("relative")),
                &ProfileOverrides::default()
            )
            .is_err()
        );
    }

    #[test]
    fn imported_game_roots_are_referenced_without_copying() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let registration =
            registration_from_scan(&Settings::default(), &root, &instance, Some("外部世界"))
                .unwrap();
        assert_eq!(registration.game_directory, Some(root.clone()));
        assert_eq!(registration.instance_key, "1.21.1");
        assert_eq!(registration.name, "外部世界");
        assert_eq!(fs::read_dir(root.join("versions")).unwrap().count(), 1);
    }

    #[test]
    fn registration_rejects_other_roots_loaders_and_incomplete_files() {
        let (_temporary, root) = game_root();
        let (_other_temporary, other_root) = game_root();
        let mut instance = installed(&root, "1.21.1");
        let global = Settings::default();
        assert!(registration_from_scan(&global, &other_root, &instance, None).is_err());
        instance.loader = "fabric".into();
        assert!(registration_from_scan(&global, &root, &instance, None).is_err());
        instance.loader = "vanilla".into();
        fs::remove_file(instance.root.join("1.21.1.jar")).unwrap();
        assert!(registration_from_scan(&global, &root, &instance, None).is_err());
    }

    #[test]
    fn removing_a_record_preserves_files_and_updates_the_active_profile() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let profile = registration_from_scan(&Settings::default(), &root, &instance, None).unwrap();
        let next = GameProfile::new("保留的世界", "1.20.1").unwrap();
        let mut config = AppConfig {
            profiles: vec![profile.clone(), next.clone()],
            active_profile: Some(profile.instance_key.clone()),
            ..AppConfig::default()
        };
        remove_profile_record(&mut config, &profile.instance_key).unwrap();
        assert!(instance.root.join("1.21.1.jar").is_file());
        assert_eq!(
            config.active_profile.as_deref(),
            Some(next.instance_key.as_str())
        );
        config.validate().unwrap();
    }

    #[test]
    fn prepared_removal_survives_record_removal_and_is_idempotent() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let profile = registration_from_scan(&Settings::default(), &root, &instance, None).unwrap();
        let mut config = AppConfig {
            profiles: vec![profile],
            ..AppConfig::default()
        };
        let prepared = prepare_profile_file_removal(&config, "1.21.1").unwrap();
        assert!(instance.root.exists(), "preflight must not delete files");
        assert!(
            prepared.remove(&config).is_err(),
            "an active registration blocks retry"
        );
        remove_profile_record(&mut config, "1.21.1").unwrap();
        let removal = prepared.remove(&config).unwrap();
        assert!(removal.removed);
        assert_eq!(removal.instance_root, prepared.instance_root);
        assert!(!prepared.remove(&config).unwrap().removed);
    }

    #[test]
    fn prepared_removal_rechecks_new_registrations_and_shared_roots_before_retry() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let profile = registration_from_scan(&Settings::default(), &root, &instance, None).unwrap();
        let mut config = AppConfig {
            profiles: vec![profile.clone()],
            ..AppConfig::default()
        };
        let prepared = prepare_profile_file_removal(&config, "1.21.1").unwrap();
        remove_profile_record(&mut config, "1.21.1").unwrap();
        config.profiles.push(profile);
        assert!(prepared.remove(&config).is_err());
        config.profiles.clear();
        let mut other = GameProfile::new("Nested root", "1.20.1").unwrap();
        other.game_directory = Some(instance.root.join("new-game-root"));
        config.profiles.push(other);
        assert!(prepared.remove(&config).is_err());
        assert!(instance.root.join("1.21.1.jar").exists());
        config.profiles.clear();
        assert!(
            prepared.remove(&config).unwrap().removed,
            "retry succeeds after the conflict is resolved"
        );
    }

    #[test]
    fn removing_files_preserves_shared_assets_and_other_instances() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let other = installed(&root, "1.20.1");
        for shared in ["assets", "libraries"] {
            fs::create_dir_all(root.join(shared)).unwrap();
            fs::write(root.join(shared).join("keep.txt"), b"keep").unwrap();
        }
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        let others = [InstanceLocation::new(&root, &other.instance_key).unwrap()];
        let removal = remove_instance_files(&location, &others).unwrap();
        assert!(removal.removed);
        assert!(!instance.root.exists());
        assert!(other.root.exists());
        for shared in ["assets", "libraries"] {
            assert_eq!(
                fs::read(root.join(shared).join("keep.txt")).unwrap(),
                b"keep"
            );
        }
    }

    #[test]
    fn shared_instance_paths_cannot_be_deleted() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        assert!(remove_instance_files(&location, std::slice::from_ref(&location)).is_err());
        assert!(instance.root.exists());
        let nested_root = instance.root.join("another-game");
        let nested = InstanceLocation::new(&nested_root, "uninstalled").unwrap();
        assert!(remove_instance_files(&location, &[nested]).is_err());
        assert!(instance.root.exists());
    }

    #[test]
    fn path_traversal_and_reserved_instance_keys_are_rejected() {
        let (_temporary, root) = game_root();
        for key in ["..", "../assets", "x/y", "C:\\outside", "CON"] {
            assert!(InstanceLocation::new(&root, key).is_err());
        }
        let escaped_root = PathBuf::from(format!(
            "{}{}versions{}..",
            root.display(),
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        ));
        assert!(InstanceLocation::new(&escaped_root, "1.21.1").is_err());
    }

    #[test]
    fn legacy_profiles_deserialize_with_inherited_settings() {
        let profile: GameProfile = serde_json::from_str(
            r#"{"instance_key":"old-world","name":"旧实例","game_version":"1.21.1"}"#,
        )
        .unwrap();
        assert!(profile.game_directory.is_none());
        assert!(profile.overrides.is_empty());
        profile.validate().unwrap();
        let global = Settings::default();
        assert_eq!(
            serde_json::to_value(profile.effective_settings(&global).unwrap()).unwrap(),
            serde_json::to_value(global).unwrap()
        );
    }

    #[test]
    fn profile_overrides_round_trip_and_validate_without_global_mutation() {
        let mut profile = GameProfile::new("覆盖设置", "1.21.1").unwrap();
        profile.overrides.memory_mb = Some(8192);
        let serialized = serde_json::to_vec(&profile).unwrap();
        let loaded: GameProfile = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(loaded.overrides.memory_mb, Some(8192));
        let global = Settings::default();
        assert_eq!(loaded.effective_settings(&global).unwrap().memory_mb, 8192);
        assert_eq!(global.memory_mb, 4096);
        profile.game_directory = Some(PathBuf::from("relative"));
        assert!(profile.validate().is_err());
    }

    #[test]
    fn repeated_scans_register_only_new_vanilla_instances() {
        let (_temporary, root) = game_root();
        let first = installed(&root, "1.21.1");
        let mut unsupported = installed(&root, "fabric-world");
        unsupported.loader = "fabric".into();
        let mut config = AppConfig {
            settings: Settings {
                game_directory: root.clone(),
                ..Settings::default()
            },
            ..AppConfig::default()
        };
        let summary =
            register_instances_from_scan(&mut config, &root, &[first.clone(), unsupported])
                .unwrap();
        assert_eq!(summary.added, ["1.21.1"]);
        assert_eq!(summary.unsupported, 1);
        assert!(config.profiles[0].game_directory.is_none());
        config.profiles[0].name = "保留用户名称".into();
        config.profiles[0].overrides.memory_mb = Some(8192);
        let repeated = register_instances_from_scan(&mut config, &root, &[first]).unwrap();
        assert!(repeated.added.is_empty());
        assert_eq!(repeated.existing, 1);
        assert_eq!(config.profiles[0].name, "保留用户名称");
        assert_eq!(config.profiles[0].overrides.memory_mb, Some(8192));
    }

    #[test]
    fn scanning_an_uncreated_empty_global_root_does_not_create_files() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = fs::canonicalize(temporary.path())
            .unwrap()
            .join("uncreated-game");
        let mut config = AppConfig {
            settings: Settings {
                game_directory: directory.clone(),
                ..Settings::default()
            },
            ..AppConfig::default()
        };
        let summary = register_instances_from_scan(&mut config, &directory, &[]).unwrap();
        assert!(summary.added.is_empty());
        assert!(!directory.exists());
    }

    #[test]
    fn failed_registration_keeps_the_entire_configuration_unchanged() {
        let (_temporary, root) = game_root();
        let (_other_temporary, other_root) = game_root();
        let first = installed(&root, "1.21.1");
        let conflicting = installed(&other_root, "1.21.1");
        let next = installed(&other_root, "1.20.1");
        let mut config = AppConfig::default();
        register_instances_from_scan(&mut config, &root, &[first]).unwrap();
        let before = serde_json::to_value(&config).unwrap();
        assert!(
            register_instances_from_scan(&mut config, &other_root, &[next, conflicting]).is_err()
        );
        assert_eq!(serde_json::to_value(config).unwrap(), before);
    }

    #[cfg(any(unix, windows))]
    fn directory_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let powershell = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
            let output = std::process::Command::new(powershell)
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                    "New-Item -ItemType Junction -Path $env:PARADOX_TEST_LINK -Target $env:PARADOX_TEST_TARGET -ErrorAction Stop | Out-Null"])
                .env("PARADOX_TEST_LINK", link)
                .env("PARADOX_TEST_TARGET", target)
                .creation_flags(0x08000000)
                .output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn linked_roots_and_nested_links_are_rejected_before_deletion() {
        let (temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        let alias = temporary.path().join("linked-game");
        directory_link(&root, &alias);
        assert!(canonical_game_root(&alias).is_err());
        let protected = temporary.path().join("protected");
        fs::create_dir_all(&protected).unwrap();
        fs::write(protected.join("keep.txt"), b"keep").unwrap();
        directory_link(&protected, &instance.root.join("outside"));
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        assert!(remove_instance_files(&location, &[]).is_err());
        assert!(instance.root.exists());
        assert_eq!(fs::read(protected.join("keep.txt")).unwrap(), b"keep");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn shared_resource_links_into_an_instance_block_file_removal() {
        let (_temporary, root) = game_root();
        let instance = installed(&root, "1.21.1");
        directory_link(&instance.root, &root.join("assets"));
        let location = InstanceLocation::new(&root, &instance.instance_key).unwrap();
        assert!(remove_instance_files(&location, &[]).is_err());
        assert!(instance.root.join("1.21.1.jar").is_file());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn imported_instances_protect_resources_referenced_by_the_global_root() {
        let (_temporary, root) = game_root();
        let (_external_temporary, external_root) = game_root();
        let instance = installed(&external_root, "1.21.1");
        directory_link(&instance.root, &root.join("libraries"));
        let mut config = AppConfig {
            settings: Settings {
                game_directory: root,
                ..Settings::default()
            },
            ..AppConfig::default()
        };
        register_instances_from_scan(&mut config, &external_root, std::slice::from_ref(&instance))
            .unwrap();
        assert!(remove_profile_files(&config, &instance.instance_key).is_err());
        assert!(instance.root.join("1.21.1.jar").is_file());
    }

    #[tokio::test]
    async fn uninstalled_known_roots_are_empty_without_creating_files() {
        let temporary = tempfile::tempdir().unwrap();
        let missing = temporary.path().join("尚未安装");
        let settings = Settings {
            game_directory: missing.clone(),
            ..Settings::default()
        };
        assert!(
            scan_known_game_root(&settings, &missing)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(!missing.exists());
        fs::create_dir(&missing).unwrap();
        assert!(
            scan_known_game_root(&settings, &missing)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(fs::read_dir(&missing).unwrap().count(), 0);
        assert!(scan_game_root(&settings, &missing).await.is_err());
    }

    #[tokio::test]
    async fn known_root_scanning_does_not_hide_invalid_directory_shapes() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("not-a-folder");
        let settings = Settings {
            game_directory: root.clone(),
            ..Settings::default()
        };
        fs::write(&root, b"file").unwrap();
        assert!(scan_known_game_root(&settings, &root).await.is_err());
        let directory = temporary.path().join("minecraft");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("versions"), b"file").unwrap();
        assert!(scan_known_game_root(&settings, &directory).await.is_err());
    }
}
