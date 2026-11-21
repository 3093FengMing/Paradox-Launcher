// Shared account state, vault hooks and service barriers used by transaction regressions.
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
type LoginFixture = (
    tempfile::TempDir,
    Arc<AccountsManager>,
    Arc<DeviceGrant>,
    CancellationToken,
    Vec<u8>,
);

fn relogin_fixture(vault: Arc<ControlledVault>) -> LoginFixture {
    vault
        .values
        .lock()
        .unwrap()
        .insert(ACCOUNT_ID.into(), OLD_RAW.into());
    login_fixture(vault)
}

fn login_fixture(vault: Arc<ControlledVault>) -> LoginFixture {
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
