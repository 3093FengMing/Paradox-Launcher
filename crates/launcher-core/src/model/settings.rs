//! Global launch settings and their combined validation.
use super::{Appearance, default_data_directory, validate_username};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};

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
    pub personalization: crate::preferences::Personalization,
    pub argument_templates: Vec<crate::preferences::ArgumentTemplate>,
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
            personalization: crate::preferences::Personalization::default(),
            argument_templates: Vec::new(),
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
        ensure!(
            !self.java_executable.contains('\0'),
            "Java 路径不能包含空字符"
        );
        for arguments in [&self.extra_jvm_arguments, &self.extra_game_arguments] {
            ensure!(!arguments.contains('\0'), "启动参数不能包含空字符");
        }
        self.appearance.validate()?;
        self.personalization.validate()?;
        ensure!(
            self.argument_templates.len() <= 16,
            "content.errors.templates"
        );
        let mut template_ids = HashSet::new();
        for template in &self.argument_templates {
            template.validate()?;
            ensure!(
                template_ids.insert(&template.id),
                "content.errors.templates"
            );
        }
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
