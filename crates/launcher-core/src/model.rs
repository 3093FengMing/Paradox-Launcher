//! Application models grouped by settings, appearance, profile and config invariants.

mod appearance;
mod config;
mod profile;
mod settings;
mod validation;

pub use appearance::{Appearance, AppearancePreset};
pub use config::{AppConfig, GameVersion, InstalledInstance};
pub use profile::GameProfile;
pub use settings::Settings;
pub use validation::{default_data_directory, validate_instance_key, validate_username};

pub const CONFIG_VERSION: u32 = 1;
pub const MAX_APPEARANCE_PRESETS: usize = 32;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_appearance_has_no_background_art_and_saved_artwork_is_preserved() {
        assert!(!Appearance::default().background_art);
        let mut saved = serde_json::to_value(AppConfig::default()).unwrap();
        let saved_image = format!("{}.png", "a".repeat(64));
        saved["settings"]["appearance"]["background_art"] = serde_json::json!(true);
        saved["settings"]["personalization"]["background_file"] = serde_json::json!(saved_image);
        let restored: AppConfig = serde_json::from_value(saved).unwrap();
        restored.validate().unwrap();
        assert!(restored.settings.appearance.background_art);
        assert_eq!(
            restored.settings.personalization.background_file,
            saved_image
        );
    }

    #[test]
    fn instance_keys_cannot_escape_the_game_directory() {
        for key in [
            "../outside",
            "..",
            "C:\\escape",
            "x/y",
            "CON",
            "nul.json",
            "COM1",
            "x.",
        ] {
            assert!(validate_instance_key(key).is_err(), "{key}");
        }
        assert!(validate_instance_key("My Vanilla-1.21.1").is_ok());
    }

    #[test]
    fn settings_reject_invalid_launch_parameters() {
        let mut settings = Settings {
            memory_mb: 64,
            ..Settings::default()
        };
        assert!(settings.validate().is_err());
        settings.memory_mb = 4096;
        settings.offline_username = "not a player".into();
        assert!(settings.validate().is_err());
    }

    #[test]
    fn config_rejects_duplicate_or_missing_profiles() {
        let profile = GameProfile::new("测试实例", "1.21.1").unwrap();
        let mut config = AppConfig {
            profiles: vec![profile.clone(), profile],
            ..AppConfig::default()
        };
        assert!(config.validate().is_err());
        config.profiles.pop();
        config.active_profile = Some("missing".into());
        assert!(config.validate().is_err());
    }

    #[test]
    fn legacy_configuration_keeps_default_language_and_empty_presets() {
        let legacy: AppConfig = serde_json::from_value(serde_json::json!({
            "schema_version": CONFIG_VERSION,
            "settings": {},
            "profiles": [],
            "active_profile": null
        }))
        .unwrap();
        legacy.validate().unwrap();
        assert_eq!(legacy.settings.language, "zh-CN");
        assert!(legacy.appearance_presets.is_empty());
    }

    #[test]
    fn presets_validate_names_ids_appearance_and_capacity() {
        let preset = AppearancePreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "夜色 · 我的工作台 🌙".into(),
            appearance: Appearance::default(),
        };
        let mut config = AppConfig {
            appearance_presets: vec![preset.clone()],
            ..AppConfig::default()
        };
        config.validate().unwrap();
        let restored: AppConfig =
            serde_json::from_slice(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(restored.appearance_presets[0].name, preset.name);
        config.appearance_presets.push(preset.clone());
        assert!(config.validate().is_err());
        for name in ["", " leading", "trailing ", "line\nbreak", &"界".repeat(49)] {
            let mut invalid = preset.clone();
            invalid.name = name.into();
            assert!(invalid.validate().is_err());
        }
        let mut invalid = preset.clone();
        invalid.id = "../outside".into();
        assert!(invalid.validate().is_err());
        invalid = preset.clone();
        invalid.appearance.ui_scale = 200;
        assert!(invalid.validate().is_err());
        config.appearance_presets = (0..=MAX_APPEARANCE_PRESETS)
            .map(|_| AppearancePreset {
                id: uuid::Uuid::new_v4().to_string(),
                ..preset.clone()
            })
            .collect();
        assert!(config.validate().is_err());
    }

    #[test]
    fn unsupported_languages_are_rejected() {
        let mut settings = Settings::default();
        for language in ["zh-CN", "en-US", "system"] {
            settings.language = language.into();
            settings.validate().unwrap();
        }
        settings.language = "unknown".into();
        assert!(settings.validate().is_err());
    }

    #[test]
    fn preset_snapshots_reject_missing_unknown_and_mistyped_fields() {
        let preset = AppearancePreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "My style".into(),
            appearance: Appearance::default(),
        };
        let original = serde_json::to_value(preset).unwrap();
        for field in original["appearance"].as_object().unwrap().keys() {
            let mut incomplete = original.clone();
            incomplete["appearance"]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(serde_json::from_value::<AppearancePreset>(incomplete).is_err());
        }
        let mut unknown = original.clone();
        unknown["appearance"]["unknown_option"] = serde_json::json!(true);
        assert!(serde_json::from_value::<AppearancePreset>(unknown).is_err());
        let mut mistyped = original;
        mistyped["appearance"]["ui_scale"] = serde_json::json!(100.5);
        assert!(serde_json::from_value::<AppearancePreset>(mistyped).is_err());

        let global: Appearance =
            serde_json::from_value(serde_json::json!({"theme": "light"})).unwrap();
        assert_eq!(global.theme, "light");
        assert_eq!(global.ui_scale, 100);
    }

    #[test]
    fn equivalent_preset_uuid_encodings_are_duplicates() {
        let id = uuid::Uuid::new_v4();
        let mut config = AppConfig::default();
        for encoding in [id.hyphenated().to_string(), id.simple().to_string()] {
            config.appearance_presets.push(AppearancePreset {
                id: encoding,
                name: "My style".into(),
                appearance: Appearance::default(),
            });
        }
        assert!(config.validate().is_err());
    }
}
