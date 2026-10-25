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
}
