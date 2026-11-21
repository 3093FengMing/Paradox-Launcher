//! Stable game profile identity and SDK launch settings.
use super::{Settings, validate_instance_key};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GameProfile {
    /// Stable SDK storage key; the display name can change independently.
    pub instance_key: String,
    pub name: String,
    pub game_version: String,
    #[serde(default = "default_loader")]
    pub loader: String,
    #[serde(default)]
    pub loader_version: String,
    /// A complete external Minecraft root; absence follows the global root.
    #[serde(default)]
    pub game_directory: Option<PathBuf>,
    #[serde(default)]
    pub overrides: crate::instances::ProfileOverrides,
}

impl GameProfile {
    pub fn new(name: &str, game_version: &str) -> Result<Self> {
        let profile = Self {
            instance_key: uuid::Uuid::new_v4().to_string(),
            name: name.trim().into(),
            game_version: game_version.trim().into(),
            loader: "vanilla".into(),
            loader_version: String::new(),
            game_directory: None,
            overrides: crate::instances::ProfileOverrides::default(),
        };
        profile.validate()?;
        Ok(profile)
    }

    pub fn validate(&self) -> Result<()> {
        validate_instance_key(&self.instance_key)?;
        crate::loaders::validate_loader(&self.loader, &self.loader_version)?;
        ensure!(
            !self.name.trim().is_empty() && self.name.chars().count() <= 64,
            "实例名称应为 1–64 个字符"
        );
        ensure!(
            !self.game_version.is_empty()
                && self.game_version.len() <= 80
                && self.game_version != "."
                && self.game_version != ".."
                && self
                    .game_version
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)),
            "Minecraft 版本号无效"
        );
        if let Some(directory) = &self.game_directory {
            ensure!(directory.is_absolute(), "实例游戏根目录必须是绝对路径");
            ensure!(
                !directory
                    .components()
                    .any(|component| matches!(component, std::path::Component::ParentDir)),
                "实例游戏根路径不能包含上级目录跳转"
            );
        }
        self.overrides.validate()?;
        Ok(())
    }

    pub fn effective_settings(&self, global: &Settings) -> Result<Settings> {
        self.validate()?;
        crate::instances::effective_settings(
            global,
            self.game_directory.as_deref(),
            &self.overrides,
        )
    }
}

fn default_loader() -> String {
    "vanilla".into()
}
