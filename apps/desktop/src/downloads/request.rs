//! Validate download targets and expose queue task identity to the UI.

use super::new_task_id;
use anyhow::{Result, ensure};
use paradox_core::{AppConfig, GameProfile, Settings, download::DownloadProgress, java};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    Install,
    Java,
    Content,
    Pack,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
}

impl DownloadStatus {
    pub(super) fn is_pending(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Cancelling)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct DownloadTask {
    pub id: String,
    pub kind: DownloadKind,
    pub name: String,
    pub profile_key: Option<String>,
    pub java_major: Option<u32>,
    pub status: DownloadStatus,
    pub message: String,
    pub progress: Option<DownloadProgress>,
    pub source: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Clone)]
pub enum DownloadRequest {
    Install {
        config: AppConfig,
        profile: GameProfile,
        managed_root: PathBuf,
    },
    Java {
        settings: Settings,
        major: u32,
        managed_root: PathBuf,
    },
    Content {
        settings: Settings,
        profile: GameProfile,
        project: String,
        category: String,
    },
    Pack {
        settings: Settings,
        source: String,
        remote: bool,
        store: paradox_core::ConfigStore,
        config: Arc<Mutex<AppConfig>>,
        registered: Arc<Mutex<Option<GameProfile>>>,
        managed_root: PathBuf,
    },
}

impl DownloadRequest {
    pub(super) fn validate(&self) -> Result<()> {
        match self {
            Self::Install {
                config,
                profile,
                managed_root,
            } => {
                config.validate()?;
                ensure!(managed_root.is_absolute(), "Java 存储目录必须是绝对路径");
                profile.effective_settings(&config.settings)?;
            }
            Self::Java {
                settings,
                major,
                managed_root,
            } => {
                settings.validate()?;
                ensure!((8..=99).contains(major), "Java 下载版本无效");
                ensure!(java::download_supported(), "当前平台不支持 Java 自动下载");
                ensure!(managed_root.is_absolute(), "Java 存储目录必须是绝对路径");
            }
            Self::Content {
                settings,
                profile,
                category,
                project,
            } => {
                settings.validate()?;
                profile.validate()?;
                ensure!(
                    matches!(category.as_str(), "mod" | "resourcepack" | "shader")
                        && !project.is_empty(),
                    "content.errors.category"
                );
            }
            Self::Pack {
                settings, source, ..
            } => {
                settings.validate()?;
                ensure!(!source.is_empty(), "content.errors.pack");
            }
        }
        Ok(())
    }

    pub(super) fn same_target(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Install { profile: left, .. }, Self::Install { profile: right, .. }) => {
                left.instance_key == right.instance_key
            }
            (Self::Java { major: left, .. }, Self::Java { major: right, .. }) => left == right,
            (
                Self::Content {
                    profile: a,
                    project: b,
                    ..
                },
                Self::Content {
                    profile: c,
                    project: d,
                    ..
                },
            ) => a.instance_key == c.instance_key && b == d,
            (Self::Pack { source: a, .. }, Self::Pack { source: b, .. }) => a == b,
            _ => false,
        }
    }

    pub(super) fn task(&self) -> DownloadTask {
        let (kind, name, profile_key, java_major) = match self {
            Self::Install { profile, .. } => (
                DownloadKind::Install,
                profile.name.clone(),
                Some(profile.instance_key.clone()),
                None,
            ),
            Self::Java { major, .. } => (
                DownloadKind::Java,
                format!("Java {major}"),
                None,
                Some(*major),
            ),
            Self::Content {
                profile, project, ..
            } => (
                DownloadKind::Content,
                project.clone(),
                Some(profile.instance_key.clone()),
                None,
            ),
            Self::Pack { source, .. } => (DownloadKind::Pack, source.clone(), None, None),
        };
        DownloadTask {
            id: new_task_id(),
            kind,
            name,
            profile_key,
            java_major,
            status: DownloadStatus::Queued,
            message: "等待下载".into(),
            progress: None,
            source: match self {
                Self::Content { project, .. } => Some(project.clone()),
                Self::Pack { source, .. } => Some(source.clone()),
                _ => None,
            },
            content_type: match self {
                Self::Content { category, .. } => Some(category.clone()),
                _ => None,
            },
        }
    }
}
