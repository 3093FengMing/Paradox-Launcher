// Regression coverage for account migration.
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
