//! Credential replacement commits, rollback and durable public recovery markers.
use super::*;

impl AccountsManager {
    pub(super) fn commit_login(
        &self,
        grant: &DeviceGrant,
        cancellation: &CancellationToken,
        session: GameSession,
        refresh_token: String,
    ) -> Result<AccountsState> {
        self.commit_login_with(grant, cancellation, session, refresh_token, |bytes| {
            self.save_prepared(bytes)
        })
    }
    pub(super) fn commit_login_with(
        &self,
        grant: &DeviceGrant,
        cancellation: &CancellationToken,
        session: GameSession,
        refresh_token: String,
        persist_metadata: impl FnOnce(&[u8]) -> Result<()>,
    ) -> Result<AccountsState> {
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let mut state = self.load()?;
        let id = session.account.id.clone();
        let record = VaultRecord {
            client_id: state.client_id.clone(),
            refresh_token,
        };
        state.accounts.retain(|a| a.id != id);
        state.accounts.push(session.account.clone());
        state.active = Some(id.clone());
        // Prepare every fallible value and acquire the cache before mutating the vault.
        let metadata = Self::prepare_state(&state)?;
        let new_secret =
            serde_json::to_string(&record).map_err(|_| anyhow::anyhow!("auth.errors.vault"))?;
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        // Preserve the exact stored string, including records from older versions.
        let previous = self
            .vault
            .read(&id)
            .map_err(|_| anyhow::anyhow!("auth.errors.vault"))?;
        self.transition_login(grant, cancellation, LoginPhase::PersistingCredential)?;
        // Journal only public IDs before creating a new vault entry. If rollback
        // or the process fails, a fresh manager can safely retry its removal.
        let journaled = previous.is_none();
        if journaled {
            self.update_recovery(&id, true)?;
        }

        // This synchronous transaction must finish even when cancellation arrives.
        let result = self
            .vault
            .write(&id, &new_secret)
            .map_err(|_| anyhow::anyhow!("auth.errors.vault"))
            .and_then(|()| self.transition_login(grant, cancellation, LoginPhase::Committing))
            .and_then(|()| persist_metadata(&metadata));
        let completion = match result {
            Ok(()) => Ok(()),
            Err(error) => {
                // Return before journal cleanup if rollback fails; a fresh
                // manager must still be able to recover the credential.
                self.restore_credential(&id, previous.as_deref())
                    .inspect_err(|_| {
                        sessions.remove(&id);
                    })?;
                Err(error)
            }
        };
        if journaled {
            // Stale markers are safe: cleanup is idempotent and registered
            // accounts never qualify for credential recovery removal.
            let _ = self.update_recovery(&id, false);
        }
        completion?;
        sessions.insert(id, session);
        Ok(state)
    }

    fn restore_credential(&self, id: &str, previous: Option<&str>) -> Result<()> {
        match previous {
            Some(secret) => self.vault.write(id, secret),
            None => self.vault.remove(id),
        }
        .map_err(|_| anyhow::anyhow!("auth.errors.rollback"))
    }
    pub(super) fn transition_login(
        &self,
        grant: &DeviceGrant,
        cancellation: &CancellationToken,
        phase: LoginPhase,
    ) -> Result<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        let pending = pending
            .as_mut()
            .filter(|p| p.grant.prompt.id == grant.prompt.id)
            .ok_or_else(|| anyhow::anyhow!("auth.errors.expired"))?;
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        pending.phase = phase;
        Ok(())
    }
}
