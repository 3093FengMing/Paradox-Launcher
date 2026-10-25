use std::{collections::HashSet, path::PathBuf};

use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};

pub const CONFIG_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct Settings {
    pub game_directory: PathBuf,
    pub java_executable: String,
    pub memory_mb: u32,
    pub offline_username: String,
    pub show_snapshots: bool,
    pub minimum_memory_mb: u32,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub extra_jvm_arguments: String,
    pub extra_game_arguments: String,
    pub appearance: Appearance,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            game_directory: default_data_directory().join("minecraft"),
            java_executable: String::new(),
            memory_mb: 4096,
            offline_username: "Player".into(),
            show_snapshots: false,
            minimum_memory_mb: 512,
            resolution_width: 1280,
            resolution_height: 720,
            extra_jvm_arguments: String::new(),
            extra_game_arguments: String::new(),
            appearance: Appearance::default(),
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<()> {
        ensure!(self.game_directory.is_absolute(), "游戏目录必须是绝对路径");
        ensure!(
            (512..=32768).contains(&self.memory_mb),
            "内存应在 512–32768 MB 之间"
        );
        validate_username(&self.offline_username)?;
        ensure!(
            (256..=self.memory_mb).contains(&self.minimum_memory_mb),
            "最小内存应至少为 256 MB，且不能大于最大内存"
        );
        ensure!(
            (640..=7680).contains(&self.resolution_width)
                && (480..=4320).contains(&self.resolution_height),
            "游戏分辨率超出支持范围"
        );
        self.appearance.validate()?;
        if !self.java_executable.trim().is_empty() {
            ensure!(
                PathBuf::from(self.java_executable.trim()).is_absolute(),
                "Java 路径必须是绝对路径"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct Appearance {
    pub interface_style: String,
    pub theme: String,
    pub accent_color: String,
    pub ui_scale: u32,
    pub border_radius: u32,
    pub compact_sidebar: bool,
    pub reduce_motion: bool,
    pub background_art: bool,
    pub background_blur: u32,
    pub background_dim: u32,
    pub sidebar_opacity: u32,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            interface_style: "immersive".into(),
            theme: "dark".into(),
            accent_color: "#6387f5".into(),
            ui_scale: 100,
            border_radius: 14,
            compact_sidebar: false,
            reduce_motion: false,
            background_art: true,
            background_blur: 0,
            background_dim: 8,
            sidebar_opacity: 62,
        }
    }
}

impl Appearance {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            matches!(self.interface_style.as_str(), "immersive" | "modern"),
            "界面风格无效"
        );
        ensure!(
            self.background_blur <= 16 && self.background_dim <= 60,
            "背景效果超出范围"
        );
        ensure!(
            (25..=85).contains(&self.sidebar_opacity),
            "侧栏不透明度应在 25–85% 之间"
        );
        ensure!(
            matches!(self.theme.as_str(), "dark" | "light" | "system"),
            "主题无效"
        );
        ensure!(
            self.accent_color.len() == 7
                && self.accent_color.starts_with('#')
                && self.accent_color[1..]
                    .chars()
                    .all(|c| c.is_ascii_hexdigit()),
            "强调色应使用 #RRGGBB 格式"
        );
        ensure!(
            (85..=120).contains(&self.ui_scale),
            "界面缩放应在 85–120% 之间"
        );
        ensure!(self.border_radius <= 28, "圆角应在 0–28 像素之间");
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GameProfile {
    /// Stable SDK storage key; the display name can change independently.
    pub instance_key: String,
    pub name: String,
    pub game_version: String,
}

impl GameProfile {
    pub fn new(name: &str, game_version: &str) -> Result<Self> {
        let profile = Self {
            instance_key: uuid::Uuid::new_v4().to_string(),
            name: name.trim().into(),
            game_version: game_version.trim().into(),
        };
        profile.validate()?;
        Ok(profile)
    }

    pub fn validate(&self) -> Result<()> {
        validate_instance_key(&self.instance_key)?;
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
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub settings: Settings,
    pub profiles: Vec<GameProfile>,
    pub active_profile: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_VERSION,
            settings: Settings::default(),
            profiles: Vec::new(),
            active_profile: None,
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
        let mut keys = HashSet::new();
        for profile in &self.profiles {
            profile.validate()?;
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
    pub root: PathBuf,
}

pub fn default_data_directory() -> PathBuf {
    dirs::data_local_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ParadoxLauncher")
}

pub fn validate_username(username: &str) -> Result<()> {
    ensure!(
        (3..=16).contains(&username.len())
            && username
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "离线用户名应为 3–16 位英文字母、数字或下划线"
    );
    Ok(())
}

pub fn validate_instance_key(key: &str) -> Result<()> {
    ensure!(
        !key.is_empty() && key.len() <= 160 && key != "." && key != "..",
        "实例 ID 无效"
    );
    ensure!(
        !key.chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)),
        "实例 ID 不能包含路径或特殊字符"
    );
    ensure!(
        !key.ends_with('.') && !key.ends_with(' '),
        "实例 ID 不能以点或空格结尾"
    );
    let stem = key
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        bail!("实例 ID 是系统保留名称");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
