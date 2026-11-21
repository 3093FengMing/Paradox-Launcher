//! Launcher-owned data directory and identifier boundaries.
use anyhow::{Result, bail, ensure};
use std::path::PathBuf;

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
