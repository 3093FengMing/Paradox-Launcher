// Regression coverage for account login.
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
