//! Account selection, logout and refresh-token rotation before game authorization.
use super::*;

impl AccountsManager {
    pub async fn select(&self, id: Option<String>) -> Result<AccountsState> {
        let _guard = self.gate.lock().await;
        let mut state = self.load()?;
        state.active = id;
        self.save(&state)?;
        Ok(state)
    }
    pub async fn logout(&self, id: &str) -> Result<AccountsState> {
        let _guard = self.gate.lock().await;
        let mut state = self.load()?;
        ensure!(
            state.accounts.iter().any(|a| a.id == id),
            "auth.errors.profile"
        );
        self.vault.remove(id)?;
        // Clear memory even if metadata persistence fails; a failed logout cannot leave a usable session.
        self.sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?
            .remove(id);
        state.accounts.retain(|a| a.id != id);
        if state.active.as_deref() == Some(id) {
            state.active = None;
        }
        self.save(&state)?;
        Ok(state)
    }
    pub async fn refresh_account(
        &self,
        id: &str,
        network: &NetworkOptions,
    ) -> Result<AccountsState> {
        let _guard = self.gate.lock().await;
        self.refresh_locked(id, network, &CancellationToken::new())
            .await?;
        self.load()
    }
    pub(super) async fn refresh_locked(
        &self,
        id: &str,
        network: &NetworkOptions,
        cancellation: &CancellationToken,
    ) -> Result<()> {
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let auth = MicrosoftAuth::new(network)?;
        self.refresh_with_auth_locked(id, cancellation, &auth).await
    }
    pub(super) async fn refresh_with_auth_locked(
        &self,
        id: &str,
        cancellation: &CancellationToken,
        auth: &impl SessionAuth,
    ) -> Result<()> {
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let mut state = self.load()?;
        ensure!(
            state.accounts.iter().any(|a| a.id == id),
            "auth.errors.profile"
        );
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let secret = self
            .vault
            .read(id)
            .map_err(|_| anyhow::anyhow!("auth.errors.vault"))?
            .ok_or_else(|| anyhow::anyhow!("auth.errors.loginRequired"))?;
        let record: VaultRecord = serde_json::from_str(&secret)
            .map_err(|_| anyhow::anyhow!("auth.errors.loginRequired"))?;
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        // Once sent, this bounded Microsoft request must finish so a rotated token
        // cannot be lost to cancellation. Vault persistence also finishes first.
        let tokens = auth
            .refresh(&record.client_id, &record.refresh_token)
            .await?;
        // Persist rotated refresh tokens before the remaining service calls can fail.
        self.vault
            .write(
                id,
                &serde_json::to_string(&VaultRecord {
                    client_id: record.client_id,
                    refresh_token: tokens.refresh_token,
                })?,
            )
            .map_err(|_| anyhow::anyhow!("auth.errors.vault"))?;
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let session = tokio::select! {
            biased;
            () = cancellation.cancelled() => return Err(anyhow::anyhow!("auth.errors.cancelled")),
            result = auth.game_session(&tokens.access_token) => result?,
        };
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        ensure!(session.account.id == id, "auth.errors.profile");
        for account in &mut state.accounts {
            if account.id == id {
                *account = session.account.clone();
            }
        }
        self.save(&state)?;
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        self.sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?
            .insert(id.into(), session);
        Ok(())
    }
    pub async fn selected_credential(
        &self,
        network: &NetworkOptions,
        cancellation: &CancellationToken,
    ) -> Result<Option<Credential>> {
        let _guard = tokio::select! {
            biased;
            () = cancellation.cancelled() => return Err(anyhow::anyhow!("auth.errors.cancelled")),
            guard = self.gate.lock() => guard,
        };
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let Some(id) = self.load()?.active else {
            return Ok(None);
        };
        let fresh = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?
            .get(&id)
            .is_some_and(|s| s.expires_at > now() + 60);
        if !fresh {
            self.refresh_locked(&id, network, cancellation).await?;
        }
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        let session = sessions
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("auth.errors.loginRequired"))?;
        // Only the per-launch credential crosses into the SDK. The account
        // metadata and refresh-token transaction remain owned by this service.
        let credential = Credential {
            username: session.account.name.clone(),
            uuid: session.account.id.clone(),
            access_token: session.access_token.clone(),
            kind: CredentialKind::Msa,
            xuid: None,
            client_id: None,
        };
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        Ok(Some(credential))
    }
}
