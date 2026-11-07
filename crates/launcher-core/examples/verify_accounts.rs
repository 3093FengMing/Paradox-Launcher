//! Live account acceptance helper; requires an existing isolated .test-data config.
//! Only the login prompt is printed. Tokens and raw vault contents never leave memory.
use std::path::{Component, Path, PathBuf};

use anyhow::{Result, ensure};
use paradox_core::{ConfigStore, accounts::AccountsManager, accounts::AccountsState};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        let key = error.to_string();
        let safe = if key.starts_with("auth.errors.")
            && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
        {
            key.as_str()
        } else {
            "auth.errors.service"
        };
        eprintln!("{}", json!({"passed": false, "error": safe}));
        std::process::exit(1);
    }
}

fn isolated_config() -> Result<PathBuf> {
    let config = std::env::var_os("PARADOX_CONFIG")
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("auth.errors.storage"))?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| anyhow::anyhow!("auth.errors.storage"))?
        .join(".test-data");
    validate_isolated_config(config, &root)
}

fn validate_isolated_config(config: PathBuf, root: &Path) -> Result<PathBuf> {
    ensure!(
        config.is_absolute()
            && config.starts_with(root)
            && !config
                .components()
                .any(|c| matches!(c, Component::ParentDir)),
        "auth.errors.storage"
    );
    let root = root
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
    let resolved = config
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
    ensure!(
        resolved.is_file() && resolved.starts_with(&root),
        "auth.errors.storage"
    );
    let manager = AccountsManager::new(&config);
    let legacy = config.with_extension("accounts.json");
    for metadata in [
        manager.metadata_path(),
        manager.recovery_path(),
        legacy.as_path(),
    ] {
        let parent = metadata
            .parent()
            .ok_or_else(|| anyhow::anyhow!("auth.errors.storage"))?
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        ensure!(parent.starts_with(&root), "auth.errors.storage");
        if metadata.exists() {
            ensure!(
                metadata
                    .canonicalize()
                    .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?
                    .starts_with(&root),
                "auth.errors.storage"
            );
        }
    }
    // Keep the caller's exact spelling: the native vault namespace hashes this path.
    Ok(config)
}

fn summary(operation: &str, state: &AccountsState) -> Result<()> {
    let value = serde_json::to_value(state).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
    let fields: Vec<_> = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("auth.errors.storage"))?
        .keys()
        .collect();
    let account_fields: Vec<_> = value["accounts"]
        .as_array()
        .and_then(|accounts| accounts.first())
        .and_then(|account| account.as_object())
        .map(|account| account.keys().collect())
        .unwrap_or_default();
    println!(
        "{}",
        json!({"operation": operation, "passed": true,
            "account_count": state.accounts.len(), "active_present": state.active.is_some(),
            "metadata_fields": fields, "account_fields": account_fields})
    );
    Ok(())
}

async fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let operation = args
        .next()
        .ok_or_else(|| anyhow::anyhow!("auth.errors.service"))?;
    ensure!(
        args.next().is_none()
            && matches!(
                operation.as_str(),
                "login" | "refresh" | "selected" | "logout"
            ),
        "auth.errors.service"
    );
    let path = isolated_config()?;
    let config = ConfigStore::new(&path)
        .load()
        .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
    let manager = AccountsManager::new(&path);
    let network = &config.settings.network;
    let state = match operation.as_str() {
        "login" => {
            let prompt = manager.begin(network).await?;
            println!("{}", json!({"operation": "authorize", "prompt": prompt}));
            manager.complete(&prompt.id, network).await?
        }
        "refresh" | "logout" => {
            let active = manager
                .state()
                .await?
                .active
                .ok_or_else(|| anyhow::anyhow!("auth.errors.profile"))?;
            if operation == "refresh" {
                manager.refresh_account(&active, network).await?
            } else {
                let updated = manager.logout(&active).await?;
                let namespace = hex::encode(Sha256::digest(path.to_string_lossy().as_bytes()));
                let removal = keyring::Entry::new(&format!("ParadoxLauncher-{namespace}"), &active)
                    .and_then(|entry| entry.get_password());
                ensure!(
                    matches!(removal, Err(keyring::Error::NoEntry)),
                    "auth.errors.vault"
                );
                println!(
                    "{}",
                    json!({"operation": "logout", "credential_removed": true})
                );
                updated
            }
        }
        "selected" => {
            let state = manager.state().await?;
            let credential = manager
                .selected_credential(network, &CancellationToken::new())
                .await?;
            if let Some(credential) = &credential {
                ensure!(
                    state.active.as_deref() == Some(credential.uuid.as_str()),
                    "auth.errors.profile"
                );
            }
            println!("{}", json!({"authenticated": credential.is_some()}));
            manager.state().await?
        }
        _ => unreachable!(),
    };
    summary(&operation, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join(".test-data");
        fs::create_dir(&root).unwrap();
        (directory, root)
    }

    fn file_link(source: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        let result = std::os::windows::fs::symlink_file(source, target);
        #[cfg(unix)]
        let result = std::os::unix::fs::symlink(source, target);
        link_result(result)
    }

    fn directory_link(source: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        let result = std::os::windows::fs::symlink_dir(source, target);
        #[cfg(unix)]
        let result = std::os::unix::fs::symlink(source, target);
        link_result(result)
    }

    fn link_result(result: std::io::Result<()>) -> bool {
        match result {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("SKIP: this machine does not permit test symlink creation");
                false
            }
            Err(error) => panic!("test symlink creation failed: {error}"),
        }
    }

    #[test]
    fn valid_configuration_preserves_original_path_spelling() {
        let (_directory, root) = fixture();
        let config = root.join("用户 登录").join("config.json");
        fs::create_dir(config.parent().unwrap()).unwrap();
        fs::write(&config, b"{}").unwrap();
        assert_eq!(
            validate_isolated_config(config.clone(), &root).unwrap(),
            config
        );
    }

    #[test]
    fn parent_traversal_and_sibling_prefix_are_rejected() {
        let (directory, root) = fixture();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("config.json"), b"{}").unwrap();
        assert!(validate_isolated_config(root.join("nested/../config.json"), &root).is_err());
        let sibling = directory.path().join(".test-data-sibling");
        fs::create_dir(&sibling).unwrap();
        fs::write(sibling.join("config.json"), b"{}").unwrap();
        assert!(validate_isolated_config(sibling.join("config.json"), &root).is_err());
    }

    #[test]
    fn external_config_symlink_to_test_configuration_is_rejected() {
        let (directory, root) = fixture();
        let real = root.join("config.json");
        fs::write(&real, b"{}").unwrap();
        let alias = directory.path().join("outside-config.json");
        if !file_link(&real, &alias) {
            return;
        }
        assert!(validate_isolated_config(alias, &root).is_err());
    }

    #[test]
    fn test_config_symlink_to_external_file_is_rejected() {
        let (directory, root) = fixture();
        let outside = directory.path().join("outside-config.json");
        fs::write(&outside, b"{}").unwrap();
        let config = root.join("config.json");
        if !file_link(&outside, &config) {
            return;
        }
        assert!(validate_isolated_config(config, &root).is_err());
    }

    #[test]
    fn existing_sidecar_symlink_to_external_file_is_rejected() {
        for kind in 0..3 {
            let (directory, root) = fixture();
            let config = root.join("config.json");
            fs::write(&config, b"{}").unwrap();
            let outside = directory.path().join("outside-accounts.json");
            fs::write(&outside, b"{}").unwrap();
            let manager = AccountsManager::new(&config);
            let target = match kind {
                0 => manager.metadata_path().to_owned(),
                1 => manager.recovery_path().to_owned(),
                _ => config.with_extension("accounts.json"),
            };
            if !file_link(&outside, &target) {
                return;
            }
            assert!(validate_isolated_config(config, &root).is_err());
        }
    }

    #[test]
    fn missing_sidecar_with_external_parent_is_rejected() {
        let (directory, root) = fixture();
        let real = root.join("real-config.json");
        fs::write(&real, b"{}").unwrap();
        let outside = directory.path().join("outside");
        fs::create_dir(&outside).unwrap();
        if !file_link(&real, &outside.join("config.json"))
            || !directory_link(&outside, &root.join("linked"))
        {
            return;
        }
        let config = root.join("linked/config.json");
        assert!(!config.with_extension("accounts.json").exists());
        assert!(validate_isolated_config(config, &root).is_err());
    }
}
