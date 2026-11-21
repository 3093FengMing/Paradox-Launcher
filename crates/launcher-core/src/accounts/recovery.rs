//! Public credential recovery IDs, isolated by configuration and safe to retry.
use super::*;

impl AccountsManager {
    pub async fn recovery(&self) -> Result<Vec<String>> {
        let _guard = self.gate.lock().await;
        self.recovery_locked()
    }
    pub(super) fn recovery_locked(&self) -> Result<Vec<String>> {
        let state = self.load()?;
        Ok(self
            .load_recovery()?
            .into_iter()
            .filter(|id| !registered_account(&state, id))
            .collect())
    }
    pub async fn clear_recovery(&self, id: &str) -> Result<Vec<String>> {
        let _guard = self.gate.lock().await;
        self.ensure_no_pending_login()?;
        let id = uuid::Uuid::parse_str(id)
            .map_err(|_| anyhow::anyhow!("auth.errors.profile"))?
            .to_string();
        let ids = self.recovery_locked()?;
        ensure!(ids.iter().any(|known| known == &id), "auth.errors.profile");
        // IDs can only name unregistered entries in this manager's credential namespace.
        self.vault
            .remove(&id)
            .map_err(|_| anyhow::anyhow!("auth.errors.vault"))?;
        self.sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?
            .remove(&id);
        self.update_recovery(&id, false)?;
        self.recovery_locked()
    }
    pub(super) fn load_recovery(&self) -> Result<BTreeSet<String>> {
        let metadata = match fs::symlink_metadata(&self.recovery_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeSet::new());
            }
            Err(_) => return Err(anyhow::anyhow!("auth.errors.storage")),
        };
        ensure!(
            metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() <= 4096,
            "auth.errors.storage"
        );
        let bytes =
            fs::read(&self.recovery_path).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        let ids: Vec<String> =
            serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        ensure!(
            ids.len() <= 32 && ids.iter().all(|id| uuid::Uuid::parse_str(id).is_ok()),
            "auth.errors.storage"
        );
        ids.into_iter()
            .map(|id| uuid::Uuid::parse_str(&id).map(|id| id.to_string()))
            .collect::<std::result::Result<BTreeSet<_>, _>>()
            .map_err(|_| anyhow::anyhow!("auth.errors.storage"))
    }
    pub(super) fn update_recovery(&self, id: &str, pending: bool) -> Result<()> {
        let mut ids = self.load_recovery()?;
        if pending {
            let state = self.load()?;
            ids.retain(|id| !registered_account(&state, id));
            ids.insert(id.into());
        } else {
            ids.remove(id);
        }
        ensure!(ids.len() <= 32, "auth.errors.storage");
        let bytes = serde_json::to_vec(&ids).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        let parent = self
            .recovery_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("auth.errors.storage"))?;
        let save = || -> Result<()> {
            fs::create_dir_all(parent)?;
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(&bytes)?;
            file.as_file().sync_all()?;
            file.persist(&self.recovery_path)?;
            Ok(())
        };
        save().map_err(|_| anyhow::anyhow!("auth.errors.storage"))
    }
}

pub(super) fn registered_account(state: &AccountsState, id: &str) -> bool {
    let Ok(id) = uuid::Uuid::parse_str(id) else {
        return false;
    };
    state
        .accounts
        .iter()
        .any(|account| uuid::Uuid::parse_str(&account.id).is_ok_and(|registered| registered == id))
}
