// Regression coverage for account metadata.
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
