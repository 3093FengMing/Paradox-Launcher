// Regression coverage for account commit credentials.
#[test]
fn poisoned_session_cache_never_mutates_login_credentials() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
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
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
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
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
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
