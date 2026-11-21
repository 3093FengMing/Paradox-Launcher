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

mod commit;
mod login;
mod metadata;
mod recovery;
mod session;

pub const DEFAULT_MICROSOFT_CLIENT_ID: &str = "7fd2b4de-f119-4ab8-8d8e-906af5efe6f3";
const MAX_ACCOUNT_METADATA_BYTES: usize = 128 * 1024;

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
}

#[cfg(test)]
mod tests;
