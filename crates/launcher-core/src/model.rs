use std::{collections::HashSet, path::PathBuf};

use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};

pub const CONFIG_VERSION: u32 = 1;
pub const MAX_APPEARANCE_PRESETS: usize = 32;

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
    pub language: String,
    pub network: crate::network::NetworkOptions,
    pub close_behavior: String,
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
            language: "zh-CN".into(),
            network: crate::network::NetworkOptions::default(),
            close_behavior: "ask".into(),
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
        ensure!(
            matches!(self.language.as_str(), "zh-CN" | "en-US" | "system"),
            "界面语言无效"
        );
        self.network.validate()?;
        ensure!(
            matches!(self.close_behavior.as_str(), "ask" | "stop" | "background"),
            "关闭启动器的行为无效"
        );
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

/// A portable visual preset; game, account and network settings stay separate.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppearancePreset {
    pub id: String,
    pub name: String,
    #[serde(deserialize_with = "deserialize_preset_appearance")]
    pub appearance: Appearance,
}

// Global appearance settings keep defaults for older configuration files.
// Presets are complete snapshots, so their nested appearance must be strict.
fn deserialize_preset_appearance<'de, D>(
    deserializer: D,
) -> std::result::Result<Appearance, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CompleteAppearance {
        interface_style: String,
        theme: String,
        accent_color: String,
        ui_scale: u32,
        border_radius: u32,
        compact_sidebar: bool,
        reduce_motion: bool,
        background_art: bool,
        background_blur: u32,
        background_dim: u32,
        sidebar_opacity: u32,
    }

    let value = CompleteAppearance::deserialize(deserializer)?;
    Ok(Appearance {
        interface_style: value.interface_style,
        theme: value.theme,
        accent_color: value.accent_color,
        ui_scale: value.ui_scale,
        border_radius: value.border_radius,
        compact_sidebar: value.compact_sidebar,
        reduce_motion: value.reduce_motion,
        background_art: value.background_art,
        background_blur: value.background_blur,
        background_dim: value.background_dim,
        sidebar_opacity: value.sidebar_opacity,
    })
}

impl AppearancePreset {
    pub fn validate(&self) -> Result<()> {
        ensure!(uuid::Uuid::parse_str(&self.id).is_ok(), "界面预设 ID 无效");
        ensure!(
            (1..=48).contains(&self.name.chars().count())
                && self.name.trim() == self.name
                && !self.name.chars().any(char::is_control),
            "界面预设名称应为 1–48 个字符，且不能包含控制字符或首尾空格"
        );
        self.appearance.validate()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GameProfile {
    /// Stable SDK storage key; the display name can change independently.
    pub instance_key: String,
    pub name: String,
    pub game_version: String,
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
            game_directory: None,
            overrides: crate::instances::ProfileOverrides::default(),
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
