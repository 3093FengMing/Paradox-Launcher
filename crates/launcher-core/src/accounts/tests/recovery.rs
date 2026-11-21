// Regression coverage for account recovery.
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
