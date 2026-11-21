// Regression coverage for account configuration.
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
