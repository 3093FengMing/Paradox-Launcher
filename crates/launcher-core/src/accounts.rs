//! Public account metadata and OS credential storage are separate from settings.
use crate::auth::{
    Account, DeviceGrant, GameSession, LoginPrompt, MicrosoftAuth, OAuthTokens, now,
};
use crate::network::NetworkOptions;
use anyhow::{Result, ensure};
use elemental::core::auth::credential::{Credential, CredentialKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    fs,
    future::Future,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

pub const DEFAULT_MICROSOFT_CLIENT_ID: &str = "7fd2b4de-f119-4ab8-8d8e-906af5efe6f3";

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct AccountsState {
    pub client_id: String,
    pub active: Option<String>,
    pub accounts: Vec<Account>,
}

impl Default for AccountsState {
    fn default() -> Self {
        Self {
            client_id: DEFAULT_MICROSOFT_CLIENT_ID.into(),
            active: None,
            accounts: Vec::new(),
        }
    }
}

impl AccountsState {
    fn validate(&self) -> Result<()> {
        ensure!(
            self.client_id.is_empty() || uuid::Uuid::parse_str(&self.client_id).is_ok(),
            "auth.errors.clientId"
        );
        ensure!(self.accounts.len() <= 32, "auth.errors.capacity");
        let mut ids = std::collections::HashSet::new();
        for account in &self.accounts {
            account.validate()?;
            ensure!(
                ids.insert(uuid::Uuid::parse_str(&account.id)?),
                "auth.errors.profile"
            );
        }
        ensure!(
            self.active
                .as_ref()
                .is_none_or(|id| self.accounts.iter().any(|a| &a.id == id)),
            "auth.errors.profile"
        );
        Ok(())
    }
}

// Never derive Debug; only the vault is allowed to serialize this value.
#[derive(Deserialize, Serialize)]
struct VaultRecord {
    client_id: String,
    refresh_token: String,
}

pub trait CredentialVault: Send + Sync {
    fn read(&self, id: &str) -> Result<Option<String>>;
    fn write(&self, id: &str, secret: &str) -> Result<()>;
    fn remove(&self, id: &str) -> Result<()>;
}

struct NativeVault {
    service: String,
}
impl CredentialVault for NativeVault {
    fn read(&self, id: &str) -> Result<Option<String>> {
        native_credential_read(
            keyring::Entry::new(&self.service, id).and_then(|e| e.get_password()),
        )
    }
    fn write(&self, id: &str, secret: &str) -> Result<()> {
        keyring::Entry::new(&self.service, id)
            .and_then(|e| e.set_password(secret))
            .map_err(|_| anyhow::anyhow!("auth.errors.vault"))
    }
    fn remove(&self, id: &str) -> Result<()> {
        match keyring::Entry::new(&self.service, id).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(anyhow::anyhow!("auth.errors.vault")),
        }
    }
}

fn native_credential_read(result: keyring::Result<String>) -> Result<Option<String>> {
    match result {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(anyhow::anyhow!("auth.errors.vault")),
    }
}

struct Pending {
    grant: Arc<DeviceGrant>,
    cancellation: CancellationToken,
    phase: LoginPhase,
}

struct StartingLogin {
    id: String,
    cancellation: CancellationToken,
}

struct StartingLoginGuard<'a> {
    manager: &'a AccountsManager,
    id: &'a str,
}

impl Drop for StartingLoginGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut starting) = self.manager.starting.lock()
            && starting.as_ref().is_some_and(|login| login.id == self.id)
        {
            *starting = None;
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LoginPhase {
    Authorizing,
    PersistingCredential,
    Committing,
}

// Keep service calls replaceable at the network boundary; storage and transaction
// behavior remain in AccountsManager for both live services and offline tests.
trait SessionAuth: Sync {
    fn refresh(
        &self,
        client_id: &str,
        refresh_token: &str,
    ) -> impl Future<Output = Result<OAuthTokens>> + Send;
    fn game_session(&self, access_token: &str) -> impl Future<Output = Result<GameSession>> + Send;
}
impl SessionAuth for MicrosoftAuth {
    async fn refresh(&self, client_id: &str, refresh_token: &str) -> Result<OAuthTokens> {
        MicrosoftAuth::refresh(self, client_id, refresh_token).await
    }
    async fn game_session(&self, access_token: &str) -> Result<GameSession> {
        MicrosoftAuth::game_session(self, access_token).await
    }
}

pub struct AccountsManager {
    path: PathBuf,
    legacy_path: Option<PathBuf>,
    recovery_path: PathBuf,
    vault: Arc<dyn CredentialVault>,
    gate: tokio::sync::Mutex<()>,
    starting: Mutex<Option<StartingLogin>>,
    cancelled_starts: Mutex<VecDeque<String>>,
    pending: Mutex<Option<Pending>>,
    sessions: Mutex<HashMap<String, GameSession>>,
}

impl AccountsManager {
    pub fn new(config_path: &Path) -> Self {
        let namespace = hex::encode(Sha256::digest(config_path.to_string_lossy().as_bytes()));
        let mut manager = Self::with_vault(
            config_path
                .parent()
                .unwrap_or(Path::new("."))
                .join(format!("accounts-{namespace}.json")),
            Arc::new(NativeVault {
                service: format!("ParadoxLauncher-{namespace}"),
            }),
        );
        // Use the exact same full-path namespace as the vault. Configurations
        // sharing a basename may share legacy account metadata, never recovery IDs.
        manager.recovery_path = config_path
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!("accounts-recovery-{namespace}.json"));
        manager.legacy_path = Some(config_path.with_extension("accounts.json"));
        manager
    }
    fn with_vault(path: PathBuf, vault: Arc<dyn CredentialVault>) -> Self {
        Self {
            recovery_path: path.with_extension("recovery.json"),
            path,
            legacy_path: None,
            vault,
            gate: tokio::sync::Mutex::new(()),
            starting: Mutex::new(None),
            cancelled_starts: Mutex::new(VecDeque::new()),
            pending: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
        }
    }
    pub async fn state(&self) -> Result<AccountsState> {
        let _guard = self.gate.lock().await;
        self.load()
    }
    pub fn metadata_path(&self) -> &Path {
        &self.path
    }
    pub fn recovery_path(&self) -> &Path {
        &self.recovery_path
    }
    pub async fn recovery(&self) -> Result<Vec<String>> {
        let _guard = self.gate.lock().await;
        self.recovery_locked()
    }
    fn recovery_locked(&self) -> Result<Vec<String>> {
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
    fn load_recovery(&self) -> Result<BTreeSet<String>> {
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
    fn update_recovery(&self, id: &str, pending: bool) -> Result<()> {
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
    fn load(&self) -> Result<AccountsState> {
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
    fn save(&self, state: &AccountsState) -> Result<()> {
        self.save_prepared(&Self::prepare_state(state)?)
    }
    fn prepare_state(state: &AccountsState) -> Result<Vec<u8>> {
        state.validate()?;
        let mut bytes =
            serde_json::to_vec_pretty(state).map_err(|_| anyhow::anyhow!("auth.errors.storage"))?;
        bytes.push(b'\n');
        Ok(bytes)
    }
    fn save_prepared(&self, bytes: &[u8]) -> Result<()> {
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
    pub async fn begin(&self, network: &NetworkOptions) -> Result<LoginPrompt> {
        self.begin_with_id(&uuid::Uuid::new_v4().to_string(), network)
            .await
    }
    pub async fn begin_with_id(
        &self,
        request_id: &str,
        network: &NetworkOptions,
    ) -> Result<LoginPrompt> {
        let auth = MicrosoftAuth::new(network)?;
        self.begin_with_fetch(request_id, |client_id| async move {
            auth.begin(&client_id).await
        })
        .await
    }
    async fn begin_with_fetch<F, Fut>(&self, id: &str, fetch: F) -> Result<LoginPrompt>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Result<DeviceGrant>>,
    {
        ensure!(uuid::Uuid::parse_str(id).is_ok(), "auth.errors.profile");
        let cancellation = CancellationToken::new();
        {
            let mut starting = self
                .starting
                .lock()
                .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
            ensure!(starting.is_none(), "auth.errors.busy");
            {
                let mut cancelled = self
                    .cancelled_starts
                    .lock()
                    .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
                if let Some(index) = cancelled.iter().position(|cancelled_id| cancelled_id == id) {
                    cancelled.remove(index);
                    return Err(anyhow::anyhow!("auth.errors.cancelled"));
                }
            }
            self.ensure_no_pending_login()?;
            *starting = Some(StartingLogin {
                id: id.into(),
                cancellation: cancellation.clone(),
            });
        }
        // Reservation cleanup also runs if the caller drops the begin future.
        let _reservation = StartingLoginGuard { manager: self, id };
        tokio::select! {
            biased;
            () = cancellation.cancelled() => Err(anyhow::anyhow!("auth.errors.cancelled")),
            result = async {
                let _guard = self.gate.lock().await;
                ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
                let state = self.load()?;
                ensure!(state.accounts.len() < 32, "auth.errors.capacity");
                let mut grant = fetch(state.client_id).await?;
                grant.prompt.id = id.into();
                let prompt = grant.prompt.clone();
                let mut pending = self.pending.lock().map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
                ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
                *pending = Some(Pending { grant: Arc::new(grant), cancellation: cancellation.clone(), phase: LoginPhase::Authorizing });
                Ok(prompt)
            } => result,
        }
    }
    fn ensure_no_pending_login(&self) -> Result<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if pending.as_ref().is_some_and(|p| {
            p.phase == LoginPhase::Authorizing
                && (p.cancellation.is_cancelled() || p.grant.prompt.expires_at <= now())
        }) {
            *pending = None;
        }
        ensure!(pending.is_none(), "auth.errors.busy");
        Ok(())
    }
    pub fn cancel(&self, id: &str) -> Result<()> {
        {
            let starting = self
                .starting
                .lock()
                .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
            if let Some(starting) = &*starting
                && starting.id == id
            {
                starting.cancellation.cancel();
            } else if uuid::Uuid::parse_str(id).is_ok() {
                // The synchronous cancel IPC can arrive before an async begin
                // future is first polled. Keep bounded public request IDs under
                // the same reservation lock so neither ordering loses the stop.
                let mut cancelled = self
                    .cancelled_starts
                    .lock()
                    .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
                if !cancelled.iter().any(|cancelled_id| cancelled_id == id) {
                    if cancelled.len() >= 128 {
                        cancelled.pop_front();
                    }
                    cancelled.push_back(id.into());
                }
            }
        }
        let pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if let Some(pending) = &*pending
            && pending.grant.prompt.id == id
            && pending.phase != LoginPhase::Committing
        {
            pending.cancellation.cancel();
        }
        Ok(())
    }
    pub fn verification_uri(&self, id: &str) -> Result<String> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        let pending = pending
            .as_ref()
            .filter(|p| {
                p.grant.prompt.id == id
                    && !p.cancellation.is_cancelled()
                    && p.grant.prompt.expires_at > now()
            })
            .ok_or_else(|| anyhow::anyhow!("auth.errors.expired"))?;
        Ok(pending.grant.prompt.verification_uri.clone())
    }
    pub async fn complete(&self, id: &str, network: &NetworkOptions) -> Result<AccountsState> {
        let (grant, cancellation) = {
            let pending = self
                .pending
                .lock()
                .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
            let pending = pending
                .as_ref()
                .filter(|p| p.grant.prompt.id == id)
                .ok_or_else(|| anyhow::anyhow!("auth.errors.expired"))?;
            (pending.grant.clone(), pending.cancellation.clone())
        };
        let result = tokio::select! {
            biased;
            () = cancellation.cancelled() => Err(anyhow::anyhow!("auth.errors.cancelled")),
            guard = self.gate.lock() => {
                let _guard = guard;
                self.finish_login(&grant, &cancellation, network).await
            }
        };
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if pending.as_ref().is_some_and(|p| p.grant.prompt.id == id) {
            *pending = None;
        }
        result
    }
    async fn finish_login(
        &self,
        grant: &DeviceGrant,
        cancellation: &CancellationToken,
        network: &NetworkOptions,
    ) -> Result<AccountsState> {
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let auth = MicrosoftAuth::new(network)?;
        let tokens = auth.poll(grant, cancellation).await?;
        let session = tokio::select! {
            biased;
            () = cancellation.cancelled() => return Err(anyhow::anyhow!("auth.errors.cancelled")),
            result = auth.game_session(&tokens.access_token) => result?,
        };
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        self.commit_login(grant, cancellation, session, tokens.refresh_token)
    }
    fn commit_login(
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
    fn commit_login_with(
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
        if let Err(error) = result {
            let rollback = match previous {
                Some(secret) => self.vault.write(&id, &secret),
                None => self.vault.remove(&id),
            };
            if rollback.is_err() {
                sessions.remove(&id);
                return Err(anyhow::anyhow!("auth.errors.rollback"));
            }
            if journaled {
                // A stale recovery marker is safe: cleanup is idempotent and
                // registered accounts are never offered for recovery removal.
                let _ = self.update_recovery(&id, false);
            }
            return Err(error);
        }
        if journaled {
            let _ = self.update_recovery(&id, false);
        }
        sessions.insert(id, session);
        Ok(state)
    }
    fn transition_login(
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
    async fn refresh_locked(
        &self,
        id: &str,
        network: &NetworkOptions,
        cancellation: &CancellationToken,
    ) -> Result<()> {
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let auth = MicrosoftAuth::new(network)?;
        self.refresh_with_auth_locked(id, cancellation, &auth).await
    }
    async fn refresh_with_auth_locked(
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

fn read_account_metadata(path: &Path) -> Result<Option<AccountsState>> {
    match fs::read(path) {
        Ok(bytes) => {
            ensure!(bytes.len() <= 128 * 1024, "auth.errors.storage");
            serde_json::from_slice::<AccountsState>(&bytes)
                .map(Some)
                .map_err(|_| anyhow::anyhow!("auth.errors.storage"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(anyhow::anyhow!("auth.errors.storage")),
    }
}

fn normalize_account_state(mut state: AccountsState) -> Result<AccountsState> {
    if state.client_id.is_empty() {
        state.client_id = DEFAULT_MICROSOFT_CLIENT_ID.into();
    }
    state.validate()?;
    Ok(state)
}

fn registered_account(state: &AccountsState, id: &str) -> bool {
    let Ok(id) = uuid::Uuid::parse_str(id) else {
        return false;
    };
    state
        .accounts
        .iter()
        .any(|account| uuid::Uuid::parse_str(&account.id).is_ok_and(|registered| registered == id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[derive(Default)]
    struct MemoryVault(Mutex<HashMap<String, String>>);
    impl CredentialVault for MemoryVault {
        fn read(&self, id: &str) -> Result<Option<String>> {
            Ok(self.0.lock().unwrap().get(id).cloned())
        }
        fn write(&self, id: &str, secret: &str) -> Result<()> {
            self.0.lock().unwrap().insert(id.into(), secret.into());
            Ok(())
        }
        fn remove(&self, id: &str) -> Result<()> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }

    fn pending_login(manager: &AccountsManager, expires_at: u64) -> String {
        let grant = Arc::new(crate::auth::test_device_grant(expires_at));
        let id = grant.prompt.id.clone();
        *manager.pending.lock().unwrap() = Some(Pending {
            grant,
            cancellation: CancellationToken::new(),
            phase: LoginPhase::Authorizing,
        });
        id
    }

    type WriteHook = Arc<dyn Fn(usize) -> Result<()> + Send + Sync>;
    #[derive(Default)]
    struct ControlledVault {
        values: Mutex<HashMap<String, String>>,
        writes: AtomicUsize,
        write_hook: Mutex<Option<WriteHook>>,
        read_hook: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
        fail_read: bool,
        fail_remove: bool,
    }
    impl CredentialVault for ControlledVault {
        fn read(&self, id: &str) -> Result<Option<String>> {
            ensure!(!self.fail_read, "auth.errors.vault");
            if let Some(hook) = self.read_hook.lock().unwrap().clone() {
                hook();
            }
            Ok(self.values.lock().unwrap().get(id).cloned())
        }
        fn write(&self, id: &str, secret: &str) -> Result<()> {
            // A credential provider may mutate before returning an error.
            self.values.lock().unwrap().insert(id.into(), secret.into());
            let number = self.writes.fetch_add(1, Ordering::SeqCst) + 1;
            let hook = self.write_hook.lock().unwrap().clone();
            if let Some(hook) = hook {
                hook(number)?;
            }
            Ok(())
        }
        fn remove(&self, id: &str) -> Result<()> {
            ensure!(!self.fail_remove, "auth.errors.vault");
            self.values.lock().unwrap().remove(id);
            Ok(())
        }
    }
    const ACCOUNT_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const OLD_RAW: &str = " {\"refresh_token\":\"OLD SECRET\",\"client_id\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"} \n";

    fn session(name: &str) -> GameSession {
        GameSession {
            account: Account {
                id: ACCOUNT_ID.into(),
                name: name.into(),
                skin_url: None,
            },
            access_token: format!("{name}-access-secret"),
            expires_at: now() + 600,
        }
    }
    fn login_fixture(
        vault: Arc<ControlledVault>,
    ) -> (
        tempfile::TempDir,
        Arc<AccountsManager>,
        Arc<DeviceGrant>,
        CancellationToken,
        Vec<u8>,
    ) {
        let temp = tempfile::tempdir().unwrap();
        let manager = Arc::new(AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            vault,
        ));
        manager
            .save(&AccountsState {
                client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".into(),
                active: Some(ACCOUNT_ID.into()),
                accounts: vec![session("PreviousPlayer").account],
            })
            .unwrap();
        manager
            .sessions
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), session("PreviousPlayer"));
        pending_login(&manager, now() + 600);
        let (grant, cancellation) = {
            let pending = manager.pending.lock().unwrap();
            let pending = pending.as_ref().unwrap();
            (pending.grant.clone(), pending.cancellation.clone())
        };
        let before = fs::read(&manager.path).unwrap();
        (temp, manager, grant, cancellation, before)
    }
    fn assert_unchanged(manager: &AccountsManager, before: &[u8]) {
        assert_eq!(fs::read(&manager.path).unwrap(), before);
        assert_eq!(
            manager
                .sessions
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .account
                .name,
            "PreviousPlayer"
        );
    }

    #[test]
    fn cancelled_login_commit_never_writes_credentials() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        manager.cancel(&grant.prompt.id).unwrap();
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn cancellation_during_relogin_restores_exact_raw_credential() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let weak = Arc::downgrade(&manager);
        let login_id = grant.prompt.id.clone();
        *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
            if number == 1 {
                weak.upgrade().unwrap().cancel(&login_id)?;
            }
            Ok(())
        }));
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn failed_credential_replacement_restores_previous_login() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        *vault.write_hook.lock().unwrap() = Some(Arc::new(|number| {
            ensure!(number != 1, "auth.errors.vault");
            Ok(())
        }));
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.vault");
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn invalid_login_candidate_never_mutates_credential() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let error = manager
            .commit_login(&grant, &cancellation, session(""), "NEW SECRET".into())
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.profile");
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn poisoned_session_cache_never_mutates_login_credentials() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let poison = manager.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poison.sessions.lock().unwrap();
            panic!("poison cache for recovery test");
        })
        .join();
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.service");
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_eq!(fs::read(&manager.path).unwrap(), before);
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn vault_snapshot_failure_preserves_existing_login() {
        let vault = Arc::new(ControlledVault {
            fail_read: true,
            ..Default::default()
        });
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.vault");
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn cancellation_during_vault_snapshot_prevents_replacement() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let token = cancellation.clone();
        *vault.read_hook.lock().unwrap() = Some(Arc::new(move || token.cancel()));
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn cancelled_new_credential_is_removed() {
        let vault = Arc::new(ControlledVault::default());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let token = cancellation.clone();
        *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
            if number == 1 {
                token.cancel();
            }
            Ok(())
        }));
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert!(!vault.values.lock().unwrap().contains_key(ACCOUNT_ID));
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn failed_new_credential_write_is_removed() {
        let vault = Arc::new(ControlledVault::default());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        *vault.write_hook.lock().unwrap() =
            Some(Arc::new(|_| Err(anyhow::anyhow!("auth.errors.vault"))));
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.vault");
        assert!(!vault.values.lock().unwrap().contains_key(ACCOUNT_ID));
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn failed_metadata_commit_rolls_back_existing_and_new_credentials() {
        for previous in [Some(OLD_RAW), None] {
            let vault = Arc::new(ControlledVault::default());
            if let Some(previous) = previous {
                vault
                    .values
                    .lock()
                    .unwrap()
                    .insert(ACCOUNT_ID.into(), previous.into());
            }
            let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
            let error = manager
                .commit_login_with(
                    &grant,
                    &cancellation,
                    session("NewPlayer"),
                    "NEW SECRET".into(),
                    |_| Err(anyhow::anyhow!("auth.errors.storage")),
                )
                .err()
                .unwrap();
            assert_eq!(error.to_string(), "auth.errors.storage");
            assert_eq!(
                vault
                    .values
                    .lock()
                    .unwrap()
                    .get(ACCOUNT_ID)
                    .map(String::as_str),
                previous
            );
            assert_unchanged(&manager, &before);
        }
    }

    #[test]
    fn rollback_failure_invalidates_affected_cached_session() {
        for previous in [Some(OLD_RAW), None] {
            let vault = Arc::new(ControlledVault {
                fail_remove: true,
                ..Default::default()
            });
            if let Some(previous) = previous {
                vault
                    .values
                    .lock()
                    .unwrap()
                    .insert(ACCOUNT_ID.into(), previous.into());
            }
            let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
            let other_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
            let mut other_session = session("UnaffectedPlayer");
            other_session.account.id = other_id.into();
            manager
                .sessions
                .lock()
                .unwrap()
                .insert(other_id.into(), other_session);
            let token = cancellation.clone();
            *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
                if number == 1 {
                    token.cancel();
                }
                ensure!(number != 2, "auth.errors.vault");
                Ok(())
            }));
            let error = manager
                .commit_login(
                    &grant,
                    &cancellation,
                    session("NewPlayer"),
                    "NEW SECRET".into(),
                )
                .err()
                .unwrap();
            assert_eq!(error.to_string(), "auth.errors.rollback");
            assert!(!manager.sessions.lock().unwrap().contains_key(ACCOUNT_ID));
            assert_eq!(
                manager
                    .sessions
                    .lock()
                    .unwrap()
                    .get(other_id)
                    .unwrap()
                    .account
                    .name,
                "UnaffectedPlayer"
            );
            assert_eq!(fs::read(&manager.path).unwrap(), before);
        }
    }

    #[test]
    fn login_write_failure_takes_precedence_over_cancellation() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let token = cancellation.clone();
        *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
            if number == 1 {
                token.cancel();
                return Err(anyhow::anyhow!("auth.errors.vault"));
            }
            Ok(())
        }));
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.vault");
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn cancellation_after_commit_transition_completes_login() {
        let vault = Arc::new(ControlledVault::default());
        let (_temp, manager, grant, cancellation, _before) = login_fixture(vault.clone());
        let state = manager
            .commit_login_with(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
                |bytes| {
                    manager.cancel(&grant.prompt.id)?;
                    manager.save_prepared(bytes)
                },
            )
            .unwrap();
        assert!(!cancellation.is_cancelled());
        assert_eq!(state.accounts[0].name, "NewPlayer");
        assert_eq!(manager.load().unwrap().accounts[0].name, "NewPlayer");
        assert_eq!(
            manager
                .sessions
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .access_token,
            "NewPlayer-access-secret"
        );
        assert!(
            vault
                .values
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .contains("NEW SECRET")
        );
        assert!(
            !fs::read_to_string(&manager.path)
                .unwrap()
                .contains("SECRET")
        );
    }

    #[test]
    fn cancellation_waits_for_blocking_credential_write_and_rollback() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let (entered_send, entered_receive) = std::sync::mpsc::channel();
        let (release_send, release_receive) = std::sync::mpsc::channel();
        let release_receive = Mutex::new(release_receive);
        *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
            if number == 1 {
                entered_send.send(()).unwrap();
                release_receive.lock().unwrap().recv().unwrap();
            }
            Ok(())
        }));
        let worker_manager = manager.clone();
        let worker_grant = grant.clone();
        let worker = std::thread::spawn(move || {
            worker_manager.commit_login(
                &worker_grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
            )
        });
        entered_receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        manager.cancel(&grant.prompt.id).unwrap();
        assert!(!worker.is_finished());
        release_send.send(()).unwrap();
        assert_eq!(
            worker.join().unwrap().err().unwrap().to_string(),
            "auth.errors.cancelled"
        );
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_unchanged(&manager, &before);
    }

    struct ControlledAuth {
        refresh_started: tokio::sync::Notify,
        refresh_release: tokio::sync::Semaphore,
        game_started: tokio::sync::Notify,
        game_release: tokio::sync::Semaphore,
        game_calls: AtomicUsize,
        cancel_on_game_response: Option<CancellationToken>,
    }
    impl ControlledAuth {
        fn new(refresh_permits: usize, game_permits: usize) -> Self {
            Self {
                refresh_started: tokio::sync::Notify::new(),
                refresh_release: tokio::sync::Semaphore::new(refresh_permits),
                game_started: tokio::sync::Notify::new(),
                game_release: tokio::sync::Semaphore::new(game_permits),
                game_calls: AtomicUsize::new(0),
                cancel_on_game_response: None,
            }
        }
    }
    impl SessionAuth for ControlledAuth {
        async fn refresh(&self, client_id: &str, refresh_token: &str) -> Result<OAuthTokens> {
            assert_eq!(client_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
            assert_eq!(refresh_token, "OLD SECRET");
            self.refresh_started.notify_one();
            self.refresh_release.acquire().await.unwrap().forget();
            Ok(OAuthTokens {
                access_token: "ROTATED ACCESS".into(),
                refresh_token: "ROTATED SECRET".into(),
            })
        }
        async fn game_session(&self, access_token: &str) -> Result<GameSession> {
            assert_eq!(access_token, "ROTATED ACCESS");
            self.game_calls.fetch_add(1, Ordering::SeqCst);
            self.game_started.notify_one();
            self.game_release.acquire().await.unwrap().forget();
            if let Some(cancellation) = &self.cancel_on_game_response {
                cancellation.cancel();
            }
            Ok(session("NewPlayer"))
        }
    }

    #[tokio::test]
    async fn selected_credential_cancels_while_waiting_for_account_gate() {
        let (_temp, manager, _grant, cancellation, _before) =
            login_fixture(Arc::new(ControlledVault::default()));
        let _guard = manager.gate.lock().await;
        let network = NetworkOptions::default();
        let selection = manager.selected_credential(&network, &cancellation);
        tokio::pin!(selection);
        assert!(futures_util::poll!(&mut selection).is_pending());
        cancellation.cancel();
        let result = tokio::time::timeout(std::time::Duration::from_millis(100), selection).await;
        let error = result
            .expect("cancellation must not wait for the account gate")
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
    }

    #[tokio::test]
    async fn cancelled_selection_never_returns_cached_credential() {
        let (_temp, manager, _grant, cancellation, _before) =
            login_fixture(Arc::new(ControlledVault::default()));
        cancellation.cancel();
        let error = manager
            .selected_credential(&NetworkOptions::default(), &cancellation)
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
    }

    #[tokio::test]
    async fn cached_microsoft_selection_keeps_launch_identity_out_of_metadata() {
        let vault = Arc::new(ControlledVault {
            fail_read: true,
            ..Default::default()
        });
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault);
        let credential = manager
            .selected_credential(&NetworkOptions::default(), &cancellation)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(credential.kind, CredentialKind::Msa);
        assert_eq!(credential.username, "PreviousPlayer");
        assert_eq!(credential.uuid, ACCOUNT_ID);
        assert_eq!(credential.access_token, "PreviousPlayer-access-secret");
        assert!(credential.xuid.is_none());
        assert!(credential.client_id.is_none());
        assert_eq!(fs::read(&manager.path).unwrap(), before);
        assert!(
            !String::from_utf8(before)
                .unwrap()
                .contains(&credential.access_token)
        );
    }

    #[tokio::test]
    async fn cancelled_refresh_never_reads_vault() {
        let vault = Arc::new(ControlledVault {
            fail_read: true,
            ..Default::default()
        });
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault);
        cancellation.cancel();
        let auth = ControlledAuth::new(1, 1);
        let error = manager
            .refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth)
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn cancelled_refresh_request_persists_rotated_token_before_stopping() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault.clone());
        let auth = ControlledAuth::new(0, 1);
        let refresh = manager.refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth);
        tokio::pin!(refresh);
        tokio::select! {
            () = auth.refresh_started.notified() => {},
            result = &mut refresh => panic!("refresh finished before controlled response: {}", result.is_ok()),
        }
        cancellation.cancel();
        assert!(
            !vault
                .values
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .contains("ROTATED SECRET")
        );
        auth.refresh_release.add_permits(1);
        let error = refresh.await.err().unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert!(
            vault
                .values
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .contains("ROTATED SECRET")
        );
        assert_eq!(auth.game_calls.load(Ordering::SeqCst), 0);
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn cancellation_during_game_session_stops_without_publishing_session() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault.clone());
        let auth = ControlledAuth::new(1, 0);
        let refresh = manager.refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth);
        tokio::pin!(refresh);
        tokio::select! {
            () = auth.game_started.notified() => {},
            result = &mut refresh => panic!("refresh finished before controlled game response: {}", result.is_ok()),
        }
        cancellation.cancel();
        let result = tokio::time::timeout(std::time::Duration::from_millis(100), refresh).await;
        assert_eq!(
            result
                .expect("game service work must cancel")
                .err()
                .unwrap()
                .to_string(),
            "auth.errors.cancelled"
        );
        assert!(
            vault
                .values
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .contains("ROTATED SECRET")
        );
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn rotated_token_storage_failure_takes_precedence_over_cancellation() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault.clone());
        let token = cancellation.clone();
        *vault.write_hook.lock().unwrap() = Some(Arc::new(move |_| {
            token.cancel();
            Err(anyhow::anyhow!("auth.errors.vault"))
        }));
        let auth = ControlledAuth::new(1, 1);
        let error = manager
            .refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth)
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.vault");
        assert_eq!(auth.game_calls.load(Ordering::SeqCst), 0);
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn native_vault_reads_distinguish_absence_from_sanitized_provider_errors() {
        assert!(
            native_credential_read(Err(keyring::Error::NoEntry))
                .unwrap()
                .is_none()
        );
        let error = native_credential_read(Err(keyring::Error::PlatformFailure(Box::new(
            std::io::Error::other("provider details containing SECRET"),
        ))))
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "auth.errors.vault");
        assert!(error.source().is_none());
        assert_eq!(
            native_credential_read(Ok("stored secret".into()))
                .unwrap()
                .as_deref(),
            Some("stored secret")
        );
    }

    #[tokio::test]
    async fn refresh_reports_missing_credentials_as_login_required() {
        let (_temp, manager, _grant, cancellation, before) =
            login_fixture(Arc::new(ControlledVault::default()));
        let auth = ControlledAuth::new(1, 1);
        let error = manager
            .refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth)
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.loginRequired");
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn cancellation_after_vault_read_prevents_microsoft_refresh() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault.clone());
        let token = cancellation.clone();
        *vault.read_hook.lock().unwrap() = Some(Arc::new(move || token.cancel()));
        let auth = ControlledAuth::new(0, 1);
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            manager.refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth),
        )
        .await;
        assert_eq!(
            result
                .expect("cancelled vault read must not start refresh")
                .err()
                .unwrap()
                .to_string(),
            "auth.errors.cancelled"
        );
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_eq!(
            vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
            OLD_RAW
        );
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn cancellation_with_game_response_prevents_session_publication() {
        let vault = Arc::new(ControlledVault::default());
        vault
            .values
            .lock()
            .unwrap()
            .insert(ACCOUNT_ID.into(), OLD_RAW.into());
        let (_temp, manager, _grant, cancellation, before) = login_fixture(vault.clone());
        let mut auth = ControlledAuth::new(1, 1);
        auth.cancel_on_game_response = Some(cancellation.clone());
        let error = manager
            .refresh_with_auth_locked(ACCOUNT_ID, &cancellation, &auth)
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert!(
            vault
                .values
                .lock()
                .unwrap()
                .get(ACCOUNT_ID)
                .unwrap()
                .contains("ROTATED SECRET")
        );
        assert_unchanged(&manager, &before);
    }

    #[test]
    fn full_account_capacity_rejects_candidate_before_writing_vault() {
        let vault = Arc::new(ControlledVault::default());
        let (_temp, manager, grant, cancellation, _) = login_fixture(vault.clone());
        let mut state = manager.load().unwrap();
        while state.accounts.len() < 32 {
            state.accounts.push(Account {
                id: uuid::Uuid::new_v4().to_string(),
                name: "OtherPlayer".into(),
                skin_url: None,
            });
        }
        manager.save(&state).unwrap();
        let before = fs::read(&manager.path).unwrap();
        let mut candidate = session("NewPlayer");
        candidate.account.id = uuid::Uuid::new_v4().to_string();
        let error = manager
            .commit_login(&grant, &cancellation, candidate, "NEW SECRET".into())
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.capacity");
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn failed_new_login_rollbacks_can_be_recovered_after_restarting_the_manager() {
        use std::sync::atomic::AtomicBool;
        struct RetryVault {
            values: MemoryVault,
            fail_remove: AtomicBool,
        }
        impl CredentialVault for RetryVault {
            fn read(&self, id: &str) -> Result<Option<String>> {
                self.values.read(id)
            }
            fn write(&self, id: &str, secret: &str) -> Result<()> {
                self.values.write(id, secret)
            }
            fn remove(&self, id: &str) -> Result<()> {
                ensure!(
                    !self.fail_remove.load(Ordering::SeqCst),
                    "auth.errors.vault"
                );
                self.values.remove(id)
            }
        }
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(RetryVault {
            values: MemoryVault::default(),
            fail_remove: AtomicBool::new(true),
        });
        let path = temp.path().join("accounts.json");
        let manager = AccountsManager::with_vault(path.clone(), vault.clone());
        pending_login(&manager, now() + 600);
        let (grant, cancellation) = {
            let pending = manager.pending.lock().unwrap();
            let pending = pending.as_ref().unwrap();
            (pending.grant.clone(), pending.cancellation.clone())
        };
        let error = manager
            .commit_login_with(
                &grant,
                &cancellation,
                session("NewPlayer"),
                "NEW SECRET".into(),
                |_| Err(anyhow::anyhow!("auth.errors.storage")),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.rollback");
        assert_eq!(
            manager.recovery().await.unwrap(),
            vec![ACCOUNT_ID.to_owned()]
        );
        let journal = fs::read_to_string(temp.path().join("accounts.recovery.json")).unwrap();
        assert!(journal.contains(ACCOUNT_ID));
        assert!(!journal.contains("SECRET") && !journal.contains("token"));
        let restarted = AccountsManager::with_vault(path, vault.clone());
        assert_eq!(
            restarted.recovery().await.unwrap(),
            vec![ACCOUNT_ID.to_owned()]
        );
        assert_eq!(
            restarted
                .clear_recovery(ACCOUNT_ID)
                .await
                .err()
                .unwrap()
                .to_string(),
            "auth.errors.vault"
        );
        assert_eq!(
            restarted.recovery().await.unwrap(),
            vec![ACCOUNT_ID.to_owned()]
        );
        vault.fail_remove.store(false, Ordering::SeqCst);
        assert!(
            restarted
                .clear_recovery(ACCOUNT_ID)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(vault.read(ACCOUNT_ID).unwrap().is_none());
        assert!(restarted.state().await.unwrap().accounts.is_empty());
        assert!(restarted.recovery().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn recovery_cleanup_refuses_registered_accounts_and_unknown_vault_entries() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(MemoryVault::default());
        let manager = AccountsManager::with_vault(temp.path().join("accounts.json"), vault.clone());
        manager
            .save(&AccountsState {
                accounts: vec![session("Player").account],
                active: Some(ACCOUNT_ID.into()),
                ..AccountsState::default()
            })
            .unwrap();
        vault.write(ACCOUNT_ID, "REGISTERED SECRET").unwrap();
        fs::write(
            temp.path().join("accounts.recovery.json"),
            serde_json::to_vec(&vec![ACCOUNT_ID]).unwrap(),
        )
        .unwrap();
        assert!(manager.recovery().await.unwrap().is_empty());
        assert!(manager.clear_recovery(ACCOUNT_ID).await.is_err());
        assert_eq!(
            vault.read(ACCOUNT_ID).unwrap().as_deref(),
            Some("REGISTERED SECRET")
        );
        let mut aliased = manager.load().unwrap();
        aliased.accounts[0].id = ACCOUNT_ID.to_ascii_uppercase();
        aliased.active = Some(aliased.accounts[0].id.clone());
        manager.save(&aliased).unwrap();
        assert!(
            manager.recovery().await.unwrap().is_empty(),
            "UUID casing cannot make a registered account eligible for recovery cleanup"
        );
        assert!(manager.clear_recovery(ACCOUNT_ID).await.is_err());
        assert_eq!(
            vault.read(ACCOUNT_ID).unwrap().as_deref(),
            Some("REGISTERED SECRET")
        );
        let unknown = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        vault.write(unknown, "UNTRACKED SECRET").unwrap();
        assert!(manager.clear_recovery(unknown).await.is_err());
        assert_eq!(
            vault.read(unknown).unwrap().as_deref(),
            Some("UNTRACKED SECRET")
        );
    }

    #[test]
    fn an_unwritable_recovery_journal_prevents_new_credentials_from_being_stored() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(ControlledVault::default());
        let manager = AccountsManager::with_vault(temp.path().join("accounts.json"), vault.clone());
        fs::create_dir(temp.path().join("accounts.recovery.json")).unwrap();
        pending_login(&manager, now() + 600);
        let (grant, cancellation) = {
            let pending = manager.pending.lock().unwrap();
            let pending = pending.as_ref().unwrap();
            (pending.grant.clone(), pending.cancellation.clone())
        };
        let error = manager
            .commit_login(
                &grant,
                &cancellation,
                session("Player"),
                "NEW SECRET".into(),
            )
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.storage");
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert!(vault.read(ACCOUNT_ID).unwrap().is_none());
        assert!(!manager.path.exists());
    }

    #[tokio::test]
    async fn cancellation_before_async_begin_is_polled_never_fetches_a_device_code() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let id = uuid::Uuid::new_v4().to_string();
        manager.cancel(&id).unwrap();
        let result = manager
            .begin_with_fetch(&id, |_| async {
                panic!("a cancelled IPC request must not start Microsoft authentication")
            })
            .await;
        assert_eq!(result.err().unwrap().to_string(), "auth.errors.cancelled");
        assert!(manager.pending.lock().unwrap().is_none());
        let next_id = uuid::Uuid::new_v4().to_string();
        let next = manager
            .begin_with_fetch(&next_id, |_| async {
                Ok(crate::auth::test_device_grant(now() + 600))
            })
            .await
            .unwrap();
        assert_eq!(next.id, next_id);
    }

    #[tokio::test]
    async fn beginning_login_can_cancel_while_waiting_for_account_gate() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let _guard = manager.gate.lock().await;
        let request_id = uuid::Uuid::new_v4().to_string();
        let begin = manager.begin_with_fetch(&request_id, |_| async {
            std::future::pending::<Result<DeviceGrant>>().await
        });
        tokio::pin!(begin);
        assert!(futures_util::poll!(&mut begin).is_pending());
        manager.cancel(&request_id).unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_millis(100), begin)
            .await
            .expect("cancellation must terminate the begin request without waiting for the gate");
        assert_eq!(result.err().unwrap().to_string(), "auth.errors.cancelled");
        assert!(manager.pending.lock().unwrap().is_none());
        assert!(!manager.path.exists());
    }

    #[tokio::test]
    async fn beginning_login_can_cancel_in_flight_without_publishing_a_prompt() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let request_id = uuid::Uuid::new_v4().to_string();
        let begin = manager.begin_with_fetch(&request_id, |_| async {
            std::future::pending::<Result<DeviceGrant>>().await
        });
        tokio::pin!(begin);
        assert!(futures_util::poll!(&mut begin).is_pending());
        manager.cancel(&request_id).unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_millis(100), begin)
            .await
            .expect("a cancelled device code request must not wait for the HTTP timeout");
        assert_eq!(result.err().unwrap().to_string(), "auth.errors.cancelled");
        assert!(manager.pending.lock().unwrap().is_none());
        let next = manager
            .begin_with_fetch(&uuid::Uuid::new_v4().to_string(), |_| async {
                Ok(crate::auth::test_device_grant(now() + 600))
            })
            .await
            .unwrap();
        assert_eq!(
            manager.verification_uri(&next.id).unwrap(),
            "https://microsoft.com/devicelogin"
        );
    }

    #[tokio::test]
    async fn begin_request_ids_prevent_stale_cancellation_from_affecting_a_new_login() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let previous_id = uuid::Uuid::new_v4().to_string();
        let current_id = uuid::Uuid::new_v4().to_string();
        let prompt = manager
            .begin_with_fetch(&current_id, |_| async {
                Ok(crate::auth::test_device_grant(now() + 600))
            })
            .await
            .unwrap();
        assert_eq!(prompt.id, current_id);
        manager.cancel(&previous_id).unwrap();
        assert!(manager.verification_uri(&current_id).is_ok());
        manager.cancel(&current_id).unwrap();
        assert_eq!(
            manager
                .verification_uri(&current_id)
                .err()
                .unwrap()
                .to_string(),
            "auth.errors.expired"
        );
    }

    #[tokio::test]
    async fn cancelled_completion_waiting_for_gate_clears_its_prompt() {
        let (_temp, manager, grant, _cancellation, before) =
            login_fixture(Arc::new(ControlledVault::default()));
        let _guard = manager.gate.lock().await;
        let network = NetworkOptions::default();
        let completion = manager.complete(&grant.prompt.id, &network);
        tokio::pin!(completion);
        assert!(futures_util::poll!(&mut completion).is_pending());
        manager.cancel(&grant.prompt.id).unwrap();
        let error = tokio::time::timeout(std::time::Duration::from_millis(100), completion)
            .await
            .expect("login completion must cancel while waiting for gate")
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.cancelled");
        assert!(manager.pending.lock().unwrap().is_none());
        assert_unchanged(&manager, &before);
    }

    #[tokio::test]
    async fn new_accounts_use_default_microsoft_client_id_without_creating_file() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let state = manager.state().await.unwrap();
        assert_eq!(state.client_id, "7fd2b4de-f119-4ab8-8d8e-906af5efe6f3");
        assert!(state.active.is_none());
        assert!(state.accounts.is_empty());
        assert!(!manager.path.exists());
    }

    #[tokio::test]
    async fn legacy_missing_microsoft_client_id_uses_default_without_rewriting_file() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let original = b"{\"active\":null,\"accounts\":[]}\n";
        fs::write(&manager.path, original).unwrap();
        assert_eq!(
            manager.state().await.unwrap().client_id,
            "7fd2b4de-f119-4ab8-8d8e-906af5efe6f3"
        );
        assert_eq!(fs::read(&manager.path).unwrap(), original);
    }

    #[tokio::test]
    async fn legacy_empty_microsoft_client_id_uses_default_without_rewriting_file() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let original = b"{\"client_id\":\"\",\"active\":null,\"accounts\":[]}\n";
        fs::write(&manager.path, original).unwrap();
        assert_eq!(
            manager.state().await.unwrap().client_id,
            "7fd2b4de-f119-4ab8-8d8e-906af5efe6f3"
        );
        assert_eq!(fs::read(&manager.path).unwrap(), original);
    }

    #[tokio::test]
    async fn existing_custom_microsoft_client_id_is_preserved_without_rewriting_file() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let original = b"{\"client_id\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\",\"active\":null,\"accounts\":[]}\n";
        fs::write(&manager.path, original).unwrap();
        assert_eq!(
            manager.state().await.unwrap().client_id,
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        );
        assert_eq!(fs::read(&manager.path).unwrap(), original);
    }

    #[tokio::test]
    async fn configuring_custom_microsoft_client_id_persists_the_override() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let state = manager
            .configure(" bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb ")
            .await
            .unwrap();
        assert_eq!(state.client_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        assert_eq!(
            manager.state().await.unwrap().client_id,
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        );
        assert!(
            fs::read_to_string(&manager.path)
                .unwrap()
                .contains("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        );
    }

    #[tokio::test]
    async fn cancelled_login_allows_reconfiguring_client_id() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let id = pending_login(&manager, now() + 600);
        manager.cancel(&id).unwrap();
        let client_id = uuid::Uuid::new_v4().to_string();
        let state = manager.configure(&client_id).await.unwrap();
        assert_eq!(state.client_id, client_id);
        assert!(manager.verification_uri(&id).is_err());
    }

    #[tokio::test]
    async fn expired_login_allows_reconfiguring_client_id() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        pending_login(&manager, now() - 1);
        let client_id = uuid::Uuid::new_v4().to_string();
        let state = manager.configure(&client_id).await.unwrap();
        assert_eq!(state.client_id, client_id);
    }

    #[tokio::test]
    async fn cancelling_another_login_id_preserves_the_current_prompt() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        let id = pending_login(&manager, now() + 600);
        manager.cancel("another-login").unwrap();
        let error = manager
            .configure(&uuid::Uuid::new_v4().to_string())
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), "auth.errors.busy");
        assert_eq!(
            manager.verification_uri(&id).unwrap(),
            "https://microsoft.com/devicelogin"
        );
    }

    #[tokio::test]
    async fn public_metadata_logout_and_offline_selection_do_not_leak_secrets() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(MemoryVault::default());
        let manager = AccountsManager::with_vault(temp.path().join("accounts.json"), vault.clone());
        let id = uuid::Uuid::new_v4().to_string();
        vault.write(&id, "SECRET").unwrap();
        manager
            .save(&AccountsState {
                client_id: uuid::Uuid::new_v4().to_string(),
                active: Some(id.clone()),
                accounts: vec![Account {
                    id: id.clone(),
                    name: "Player".into(),
                    skin_url: None,
                }],
            })
            .unwrap();
        assert!(
            !fs::read_to_string(&manager.path)
                .unwrap()
                .contains("SECRET")
        );
        manager.select(None).await.unwrap();
        assert!(
            manager
                .selected_credential(&NetworkOptions::default(), &CancellationToken::new())
                .await
                .unwrap()
                .is_none()
        );
        let state = manager.logout(&id).await.unwrap();
        assert!(state.accounts.is_empty());
        assert!(vault.read(&id).unwrap().is_none());
    }
    #[tokio::test]
    async fn corrupt_accounts_and_invalid_selection_preserve_original_file() {
        let temp = tempfile::tempdir().unwrap();
        let manager = AccountsManager::with_vault(
            temp.path().join("accounts.json"),
            Arc::new(MemoryVault::default()),
        );
        manager.save(&AccountsState::default()).unwrap();
        let before = fs::read(&manager.path).unwrap();
        assert!(manager.select(Some("missing".into())).await.is_err());
        assert_eq!(before, fs::read(&manager.path).unwrap());
        fs::write(&manager.path, b"{broken}").unwrap();
        assert!(
            manager
                .configure(&uuid::Uuid::new_v4().to_string())
                .await
                .is_err()
        );
        assert_eq!(fs::read(&manager.path).unwrap(), b"{broken}");
    }

    #[tokio::test]
    async fn recovery_journal_isolated_between_config_names_with_the_same_stem() {
        let temp = tempfile::tempdir().unwrap();
        let first_vault = Arc::new(ControlledVault::default());
        let second_vault = Arc::new(ControlledVault::default());
        let mut first = AccountsManager::new(&temp.path().join("profile.json"));
        let mut second = AccountsManager::new(&temp.path().join("profile.custom"));
        // Substitute only the OS vault transport. Path and namespace derivation
        // still use the production constructor for both configuration names.
        first.vault = first_vault.clone();
        second.vault = second_vault.clone();
        first.update_recovery(ACCOUNT_ID, true).unwrap();
        first.vault.write(ACCOUNT_ID, OLD_RAW).unwrap();
        assert_eq!(first.recovery().await.unwrap(), vec![ACCOUNT_ID]);
        let cleanup = second.clear_recovery(ACCOUNT_ID).await;
        assert!(first_vault.values.lock().unwrap().contains_key(ACCOUNT_ID));
        assert!(
            cleanup.is_err(),
            "a different configuration vault must not acknowledge clearing the first vault's credential"
        );
        assert_eq!(
            first.recovery().await.unwrap(),
            vec![ACCOUNT_ID],
            "the original namespace must retain its recovery marker"
        );
    }

    #[tokio::test]
    async fn account_metadata_isolated_between_config_names_with_the_same_stem() {
        let temp = tempfile::tempdir().unwrap();
        let first_vault = Arc::new(MemoryVault::default());
        let mut first = AccountsManager::new(&temp.path().join("profile.json"));
        let mut second = AccountsManager::new(&temp.path().join("profile.custom"));
        first.vault = first_vault.clone();
        second.vault = Arc::new(MemoryVault::default());
        first_vault.write(ACCOUNT_ID, OLD_RAW).unwrap();
        first
            .save(&AccountsState {
                accounts: vec![session("FirstPlayer").account],
                active: Some(ACCOUNT_ID.into()),
                ..AccountsState::default()
            })
            .unwrap();
        let before = fs::read(&first.path).unwrap();
        assert!(
            second.state().await.unwrap().accounts.is_empty(),
            "a different vault must not read the first configuration's accounts"
        );
        assert!(second.logout(ACCOUNT_ID).await.is_err());
        assert_eq!(fs::read(&first.path).unwrap(), before);
        assert_eq!(
            first.state().await.unwrap().active.as_deref(),
            Some(ACCOUNT_ID)
        );
        assert!(first_vault.read(ACCOUNT_ID).unwrap().is_some());
    }

    #[tokio::test]
    async fn legacy_account_metadata_migrates_only_accounts_owned_by_each_vault() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("profile.json");
        let legacy = config.with_extension("accounts.json");
        let second_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        let mut second_account = session("SecondPlayer").account;
        second_account.id = second_id.into();
        let old = AccountsState {
            accounts: vec![session("FirstPlayer").account, second_account],
            active: Some(second_id.into()),
            client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".into(),
        };
        let original = serde_json::to_vec_pretty(&old).unwrap();
        fs::write(&legacy, &original).unwrap();
        let first_vault = Arc::new(MemoryVault::default());
        let second_vault = Arc::new(MemoryVault::default());
        first_vault.write(ACCOUNT_ID, OLD_RAW).unwrap();
        second_vault.write(second_id, OLD_RAW).unwrap();
        let mut first = AccountsManager::new(&config);
        let mut second = AccountsManager::new(&temp.path().join("profile.custom"));
        first.vault = first_vault;
        second.vault = second_vault;
        let first_state = first.state().await.unwrap();
        let second_state = second.state().await.unwrap();
        assert_eq!(
            first_state
                .accounts
                .iter()
                .map(|account| account.id.as_str())
                .collect::<Vec<_>>(),
            vec![ACCOUNT_ID]
        );
        assert!(first_state.active.is_none());
        assert_eq!(
            second_state
                .accounts
                .iter()
                .map(|account| account.id.as_str())
                .collect::<Vec<_>>(),
            vec![second_id]
        );
        assert_eq!(second_state.active.as_deref(), Some(second_id));
        assert_eq!(
            first_state.client_id,
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        );
        assert_eq!(fs::read(&legacy).unwrap(), original);
        assert!(first.path.exists() && second.path.exists());
        assert_ne!(first.path, second.path);
        assert!(!fs::read_to_string(&first.path).unwrap().contains("SECRET"));
    }

    #[tokio::test]
    async fn unavailable_legacy_vault_never_writes_or_replaces_account_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.json");
        let legacy = config.with_extension("accounts.json");
        let original = serde_json::to_vec(&AccountsState {
            accounts: vec![session("Player").account],
            active: Some(ACCOUNT_ID.into()),
            ..AccountsState::default()
        })
        .unwrap();
        fs::write(&legacy, &original).unwrap();
        let mut manager = AccountsManager::new(&config);
        manager.vault = Arc::new(ControlledVault {
            fail_read: true,
            ..ControlledVault::default()
        });
        assert_eq!(
            manager.state().await.err().unwrap().to_string(),
            "auth.errors.vault"
        );
        assert_eq!(fs::read(legacy).unwrap(), original);
        assert!(!manager.path.exists());
    }

    #[tokio::test]
    async fn legacy_migration_unusable_destination_preserves_original_metadata_and_vault() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.json");
        let legacy = config.with_extension("accounts.json");
        let original = serde_json::to_vec(&AccountsState {
            accounts: vec![session("Player").account],
            active: Some(ACCOUNT_ID.into()),
            ..AccountsState::default()
        })
        .unwrap();
        fs::write(&legacy, &original).unwrap();
        let vault = Arc::new(MemoryVault::default());
        vault.write(ACCOUNT_ID, OLD_RAW).unwrap();
        let mut manager = AccountsManager::new(&config);
        manager.vault = vault.clone();
        fs::write(temp.path().join("blocked"), b"blocked").unwrap();
        manager.path = temp.path().join("blocked/new-accounts.json");
        assert_eq!(
            manager.state().await.err().unwrap().to_string(),
            "auth.errors.storage"
        );
        assert_eq!(fs::read(legacy).unwrap(), original);
        assert_eq!(vault.read(ACCOUNT_ID).unwrap().as_deref(), Some(OLD_RAW));
    }
}
