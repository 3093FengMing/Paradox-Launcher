// Regression coverage for account commit validation.
#[test]
fn cancelled_login_commit_never_writes_credentials() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    manager.cancel(&grant.prompt.id).unwrap();
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
fn cancellation_during_relogin_restores_exact_raw_credential() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    let weak = Arc::downgrade(&manager);
    let login_id = grant.prompt.id.clone();
    *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
        if number == 1 {
            weak.upgrade().unwrap().cancel(&login_id)?;
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
    assert_eq!(
        vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
        OLD_RAW
    );
    assert_unchanged(&manager, &before);
}

#[test]
fn failed_credential_replacement_restores_previous_login() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    *vault.write_hook.lock().unwrap() = Some(Arc::new(|number| {
        ensure!(number != 1, "auth.errors.vault");
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
    assert_eq!(error.to_string(), "auth.errors.vault");
    assert_eq!(
        vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
        OLD_RAW
    );
    assert_unchanged(&manager, &before);
}

#[test]
fn invalid_login_candidate_never_mutates_credential() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    let error = manager
        .commit_login(&grant, &cancellation, session(""), "NEW SECRET".into())
        .err()
        .unwrap();
    assert_eq!(error.to_string(), "auth.errors.profile");
    assert_eq!(
        vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
        OLD_RAW
    );
    assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
    assert_unchanged(&manager, &before);
}

#[test]
fn oversized_login_metadata_never_replaces_credentials_or_registered_accounts() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    let mut candidate = session("NewPlayer");
    candidate.account.skin_url = Some(format!(
        "https://textures.minecraft.net/texture/{}",
        "a".repeat(MAX_ACCOUNT_METADATA_BYTES)
    ));
    candidate.account.validate().unwrap();
    let error = manager
        .commit_login(&grant, &cancellation, candidate, "NEW SECRET".into())
        .err()
        .unwrap();

    assert_eq!(error.to_string(), "auth.errors.storage");
    assert_eq!(
        vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
        OLD_RAW
    );
    assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
    assert_unchanged(&manager, &before);
}
