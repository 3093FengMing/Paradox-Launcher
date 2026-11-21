// Regression coverage for account refresh identity.
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
