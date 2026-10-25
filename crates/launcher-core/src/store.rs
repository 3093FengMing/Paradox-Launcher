use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use crate::{AppConfig, model::default_data_directory};

#[derive(Clone, Debug)]
pub struct ConfigStore {
    path: PathBuf,
}

impl Default for ConfigStore {
    fn default() -> Self {
        Self::new(default_data_directory().join("config.json"))
    }
}

impl ConfigStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<AppConfig> {
        let content = match fs::read(&self.path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(AppConfig::default());
            }
            Err(error) => return Err(error).context("无法读取启动器配置"),
        };
        let config: AppConfig = serde_json::from_slice(&content).with_context(|| {
            format!(
                "配置文件损坏，请修复或备份后重命名：{}",
                self.path.display()
            )
        })?;
        config.validate()?;
        Ok(config)
    }

    pub fn save(&self, config: &AppConfig) -> Result<()> {
        config.validate()?;
        let parent = self.path.parent().context("配置路径没有父目录")?;
        fs::create_dir_all(parent).context("无法创建配置目录")?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(&mut file, config)?;
        file.write_all(b"\n")?;
        file.as_file().sync_all()?;
        file.persist(&self.path).context("无法原子替换配置文件")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GameProfile;

    #[test]
    fn saves_and_replaces_a_config_with_unicode_paths() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(directory.path().join("中文目录/config.json"));
        let mut config = store.load().unwrap();
        let profile = GameProfile::new("生存世界", "1.21.1").unwrap();
        config.active_profile = Some(profile.instance_key.clone());
        config.profiles.push(profile);
        store.save(&config).unwrap();
        config.settings.memory_mb = 8192;
        store.save(&config).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.settings.memory_mb, 8192);
        assert_eq!(loaded.active().unwrap().name, "生存世界");
    }

    #[test]
    fn corrupt_config_is_reported_and_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        fs::write(&path, b"{invalid}").unwrap();
        assert!(ConfigStore::new(&path).load().is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{invalid}");
    }

    #[test]
    fn invalid_config_does_not_replace_saved_data() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(directory.path().join("config.json"));
        let mut config = AppConfig::default();
        store.save(&config).unwrap();
        config.schema_version = 999;
        assert!(store.save(&config).is_err());
        assert_eq!(store.load().unwrap().schema_version, 1);
    }

    #[test]
    fn language_and_complete_presets_survive_disk_replacement() {
        use crate::model::{Appearance, AppearancePreset};

        let directory = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(directory.path().join("界面预设/config.json"));
        let preset = AppearancePreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "夜色工作台 🌙".into(),
            appearance: Appearance {
                interface_style: "modern".into(),
                theme: "light".into(),
                accent_color: "#aabbcc".into(),
                ui_scale: 115,
                border_radius: 24,
                compact_sidebar: true,
                reduce_motion: true,
                background_art: false,
                background_blur: 12,
                background_dim: 32,
                sidebar_opacity: 45,
            },
        };
        let mut config = AppConfig {
            appearance_presets: vec![preset],
            ..AppConfig::default()
        };
        config.settings.language = "system".into();
        store.save(&config).unwrap();
        let mut loaded = store.load().unwrap();
        assert_eq!(loaded.settings.language, "system");
        assert_eq!(
            serde_json::to_value(&loaded.appearance_presets).unwrap(),
            serde_json::to_value(&config.appearance_presets).unwrap()
        );

        loaded.settings.language = "en-US".into();
        loaded.settings.memory_mb = 8192;
        store.save(&loaded).unwrap();
        let replaced = store.load().unwrap();
        assert_eq!(replaced.settings.language, "en-US");
        assert_eq!(replaced.settings.memory_mb, 8192);
        assert_eq!(
            serde_json::to_value(replaced.appearance_presets).unwrap(),
            serde_json::to_value(config.appearance_presets).unwrap()
        );
    }

    #[test]
    fn invalid_language_or_preset_preserves_existing_configuration() {
        use crate::model::{Appearance, AppearancePreset};

        let directory = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(directory.path().join("config.json"));
        let preset = AppearancePreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "My style".into(),
            appearance: Appearance::default(),
        };
        let config = AppConfig {
            appearance_presets: vec![preset.clone()],
            ..AppConfig::default()
        };
        store.save(&config).unwrap();
        let original = fs::read(store.path()).unwrap();

        let mut invalid_language = config.clone();
        invalid_language.settings.language = "unsupported".into();
        let mut invalid_appearance = config.clone();
        invalid_appearance.appearance_presets[0].appearance.ui_scale = 200;
        let mut duplicate = config;
        duplicate.appearance_presets.push(preset);
        for invalid in [invalid_language, invalid_appearance, duplicate] {
            assert!(store.save(&invalid).is_err());
            assert_eq!(fs::read(store.path()).unwrap(), original);
        }
    }

    #[cfg(windows)]
    #[test]
    fn readonly_config_rejects_replacement_and_preserves_saved_data() {
        let directory = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(directory.path().join("只读配置/config.json"));
        let mut config = AppConfig::default();
        store.save(&config).unwrap();
        let original = fs::read(store.path()).unwrap();
        let original_permissions = fs::metadata(store.path()).unwrap().permissions();
        assert!(!original_permissions.readonly());
        let mut readonly_permissions = original_permissions.clone();
        readonly_permissions.set_readonly(true);
        fs::set_permissions(store.path(), readonly_permissions).unwrap();

        config.settings.memory_mb = 8192;
        let result = store.save(&config);
        let retained = fs::read(store.path());
        // Restore the original writable permission before asserting so the
        // temporary directory is removable even if the regression fails.
        fs::set_permissions(store.path(), original_permissions).unwrap();
        assert!(result.is_err(), "read-only configuration was replaced");
        assert_eq!(retained.unwrap(), original);
    }
}
