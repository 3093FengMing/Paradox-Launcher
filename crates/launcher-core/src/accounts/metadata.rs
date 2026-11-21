//! Account metadata validation, atomic persistence and vault-owned legacy migration.
use super::*;

impl AccountsManager {
    pub(super) fn load(&self) -> Result<AccountsState> {
        if let Some(state) = read_account_metadata(&self.path)? {
            return normalize_account_state(state);
        }
        let Some(legacy_path) = &self.legacy_path else {
            return Ok(AccountsState::default());
        };
        let Some(legacy) = read_account_metadata(legacy_path)? else {
            return Ok(AccountsState::default());
        };
        let mut state = normalize_account_state(legacy)?;
        let mut owned = Vec::new();
        for account in state.accounts {
            // An entry's existence proves ownership by this exact vault namespace.
            // Never refresh, copy, log or serialize the secret during migration.
            if self
                .vault
                .read(&account.id)
                .map_err(|_| anyhow::anyhow!("auth.errors.vault"))?
                .is_some()
            {
                owned.push(account);
            }
        }
        state.accounts = owned;
        state.active = state
            .active
            .filter(|id| state.accounts.iter().any(|account| account.id == *id));
        // The ambiguous legacy source remains untouched for every other namespace.
        // Future writes use only this manager's hashed metadata file.
        self.save(&state)?;
        Ok(state)
    }
    pub(super) fn save(&self, state: &AccountsState) -> Result<()> {
        self.save_prepared(&Self::prepare_state(state)?)
    }
    pub(super) fn prepare_state(state: &AccountsState) -> Result<Vec<u8>> {
        state.validate()?;
        let mut bytes =
            serde_json::to_vec_pretty(state).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        bytes.push(b'\n');
        // Prepare the size gate before a login transaction can mutate credentials.
        ensure!(
            bytes.len() <= MAX_ACCOUNT_METADATA_BYTES,
            "auth.errors.storage"
        );
        Ok(bytes)
    }
    pub(super) fn save_prepared(&self, bytes: &[u8]) -> Result<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("auth.errors.storage"))?;
        fs::create_dir_all(parent).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        temp.write_all(bytes)
            .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        temp.as_file()
            .sync_all()
            .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        temp.persist(&self.path)
            .map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        Ok(())
    }
    pub async fn configure(&self, client_id: &str) -> Result<AccountsState> {
        let _guard = self.gate.lock().await;
        self.ensure_no_pending_login()?;
        ensure!(
            uuid::Uuid::parse_str(client_id.trim()).is_ok(),
            "auth.errors.clientId"
        );
        let mut state = self.load()?;
        state.client_id = client_id.trim().into();
        self.save(&state)?;
        Ok(state)
    }
}

pub(super) fn read_account_metadata(path: &Path) -> Result<Option<AccountsState>> {
    match fs::read(path) {
        Ok(bytes) => {
            ensure!(
                bytes.len() <= MAX_ACCOUNT_METADATA_BYTES,
                "auth.errors.storage"
            );
            serde_json::from_slice::<AccountsState>(&bytes)
                .map(Some)
                .map_err(|_| anyhow::anyhow!("auth.errors.storage"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(anyhow::anyhow!("auth.errors.storage")),
    }
}

pub(super) fn normalize_account_state(mut state: AccountsState) -> Result<AccountsState> {
    if state.client_id.is_empty() {
        state.client_id = DEFAULT_MICROSOFT_CLIENT_ID.into();
    }
    state.validate()?;
    Ok(state)
}
