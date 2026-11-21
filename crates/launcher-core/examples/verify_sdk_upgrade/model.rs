//! Typed cache, file-state and acceptance reports for the SDK upgrade check.
use anyhow::Result;
use paradox_core::GameProfile;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Deserialize)]
pub(crate) struct CachedProfile {
    pub(crate) loader: String,
    pub(crate) game_version: String,
    pub(crate) loader_version: String,
    pub(crate) installed: bool,
    pub(crate) passed: bool,
}

impl CachedProfile {
    pub(crate) fn profile(&self) -> Result<GameProfile> {
        let mut profile = GameProfile::new(
            &format!("{} SDK upgrade check", self.loader),
            &self.game_version,
        )?;
        profile.instance_key = format!("smoke-{}-{}", self.loader, self.game_version);
        profile.loader.clone_from(&self.loader);
        profile.loader_version.clone_from(&self.loader_version);
        profile.validate()?;
        Ok(profile)
    }
}

#[derive(Serialize)]
pub(crate) struct ProfileReport {
    pub(crate) instance_key: String,
    pub(crate) loader: String,
    pub(crate) game_version: String,
    pub(crate) loader_version: String,
    pub(crate) scanned: bool,
    pub(crate) loaded: bool,
    pub(crate) sdk_loader_version: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct FileSnapshot {
    pub(crate) directory: bool,
    pub(crate) size: u64,
    pub(crate) modified_unix_ns: String,
    pub(crate) sha256: Option<String>,
}

pub(crate) type Snapshot = BTreeMap<String, FileSnapshot>;

#[derive(Serialize)]
pub(crate) struct StateChange {
    pub(crate) path: String,
    pub(crate) before: Option<FileSnapshot>,
    pub(crate) after: Option<FileSnapshot>,
    pub(crate) allowed_jna_runtime_change: bool,
}

#[derive(Serialize)]
pub(crate) struct LaunchReport {
    pub(crate) ready: bool,
    pub(crate) close_mode: String,
    pub(crate) process_reaped: bool,
    pub(crate) exit_code: Option<i32>,
    pub(crate) java: PathBuf,
    pub(crate) log: PathBuf,
}

#[derive(Serialize)]
pub(crate) struct UpgradeReport {
    pub(crate) cache_root: PathBuf,
    pub(crate) profiles: Vec<ProfileReport>,
    pub(crate) state_before: Snapshot,
    pub(crate) state_after_load: Snapshot,
    pub(crate) state_after_launch: Option<Snapshot>,
    pub(crate) load_state_unchanged: bool,
    pub(crate) launch_state_unchanged: Option<bool>,
    pub(crate) launch_compatible_state_unchanged: Option<bool>,
    pub(crate) launch_state_changes: Vec<StateChange>,
    pub(crate) launch: Option<LaunchReport>,
    pub(crate) passed: bool,
    pub(crate) error: Option<String>,
}
