// Regression coverage for account refresh cancellation.
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
