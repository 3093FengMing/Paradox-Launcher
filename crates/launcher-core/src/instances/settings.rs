//! Per-instance overrides and inheritance of validated global settings.
use crate::Settings;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// `None` inherits the global value. An explicit empty string clears Java or
/// argument overrides, rather than falling back to the global string.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
pub struct ProfileOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_jvm_arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_game_arguments: Option<String>,
    pub argument_template: Option<String>,
    pub environment: std::collections::BTreeMap<String, String>,
}

impl ProfileOverrides {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    pub fn validate(&self) -> Result<()> {
        if let Some(memory) = self.memory_mb {
            ensure!(
                (512..=32768).contains(&memory),
                "实例内存应在 512–32768 MB 之间"
            );
        }
        if let Some(memory) = self.minimum_memory_mb {
            ensure!(
                (256..=32768).contains(&memory),
                "实例最小内存应在 256–32768 MB 之间"
            );
        }
        if let (Some(minimum), Some(maximum)) = (self.minimum_memory_mb, self.memory_mb) {
            ensure!(minimum <= maximum, "实例最小内存不能大于最大内存");
        }
        if let Some(java) = &self.java_executable {
            ensure!(!java.contains('\0'), "Java 路径不能包含空字符");
            ensure!(
                java.trim().is_empty() || Path::new(java.trim()).is_absolute(),
                "实例 Java 路径必须是绝对路径"
            );
        }
        if let Some(width) = self.resolution_width {
            ensure!(
                (640..=7680).contains(&width),
                "实例游戏窗口宽度超出支持范围"
            );
        }
        if let Some(height) = self.resolution_height {
            ensure!(
                (480..=4320).contains(&height),
                "实例游戏窗口高度超出支持范围"
            );
        }
        for arguments in [&self.extra_jvm_arguments, &self.extra_game_arguments]
            .into_iter()
            .flatten()
        {
            ensure!(!arguments.contains('\0'), "实例启动参数不能包含空字符");
        }
        crate::preferences::validate_environment(&self.environment)?;
        Ok(())
    }
}

/// `game_directory` is a complete game root containing `versions`, `assets`
/// and `libraries`; it is never the selected version directory itself.
pub fn effective_settings(
    global: &Settings,
    game_directory: Option<&Path>,
    overrides: &ProfileOverrides,
) -> Result<Settings> {
    global.validate()?;
    overrides.validate()?;
    let mut effective = global.clone();
    if let Some(id) = &overrides.argument_template {
        let template = global
            .argument_templates
            .iter()
            .find(|t| &t.id == id)
            .context("content.errors.templates")?;
        effective.extra_jvm_arguments = template.jvm.clone();
        effective.extra_game_arguments = template.game.clone();
    }
    if let Some(directory) = game_directory {
        effective.game_directory = directory.to_owned();
    }
    if let Some(value) = &overrides.java_executable {
        effective.java_executable = value.clone();
    }
    if let Some(value) = overrides.memory_mb {
        effective.memory_mb = value;
    }
    if let Some(value) = overrides.minimum_memory_mb {
        effective.minimum_memory_mb = value;
    }
    if let Some(value) = overrides.resolution_width {
        effective.resolution_width = value;
    }
    if let Some(value) = overrides.resolution_height {
        effective.resolution_height = value;
    }
    if let Some(value) = &overrides.extra_jvm_arguments {
        effective.extra_jvm_arguments = value.clone();
    }
    if let Some(value) = &overrides.extra_game_arguments {
        effective.extra_game_arguments = value.clone();
    }
    effective.validate().context("实例启动设置无效")?;
    Ok(effective)
}
