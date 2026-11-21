//! Application configuration integrity and active-profile selection.
use super::{AppearancePreset, CONFIG_VERSION, GameProfile, MAX_APPEARANCE_PRESETS, Settings};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub settings: Settings,
    pub profiles: Vec<GameProfile>,
    pub active_profile: Option<String>,
    pub appearance_presets: Vec<AppearancePreset>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_VERSION,
            settings: Settings::default(),
            profiles: Vec::new(),
            active_profile: None,
            appearance_presets: Vec::new(),
        }
    }
}

impl AppConfig {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema_version == CONFIG_VERSION,
            "不支持的配置版本 {}，当前支持 {}",
            self.schema_version,
            CONFIG_VERSION
        );
        self.settings.validate()?;
        ensure!(
            self.appearance_presets.len() <= MAX_APPEARANCE_PRESETS,
            "界面预设最多可保存 {MAX_APPEARANCE_PRESETS} 个"
        );
        let mut preset_ids = HashSet::new();
        for preset in &self.appearance_presets {
            preset.validate()?;
            let id = uuid::Uuid::parse_str(&preset.id)?;
            ensure!(preset_ids.insert(id), "界面预设 ID 重复");
        }
        let mut keys = HashSet::new();
        for profile in &self.profiles {
            profile.validate()?;
            profile.effective_settings(&self.settings)?;
            ensure!(keys.insert(&profile.instance_key), "实例 ID 重复");
        }
        if let Some(key) = &self.active_profile {
            ensure!(keys.contains(key), "选中的实例不存在");
        }
        Ok(())
    }

    pub fn active(&self) -> Option<&GameProfile> {
        let key = self.active_profile.as_ref()?;
        self.profiles
            .iter()
            .find(|profile| &profile.instance_key == key)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GameVersion {
    pub id: String,
    pub kind: String,
}

impl GameVersion {
    pub fn is_release(&self) -> bool {
        self.kind == "release"
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InstalledInstance {
    pub instance_key: String,
    pub game_version: Option<String>,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    pub root: PathBuf,
}
