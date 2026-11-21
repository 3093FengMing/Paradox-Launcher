//! Saved appearance configuration and strict preset snapshots.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

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
            accent_color: "#6676dc".into(),
            ui_scale: 100,
            border_radius: 6,
            compact_sidebar: false,
            reduce_motion: false,
            background_art: false,
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
