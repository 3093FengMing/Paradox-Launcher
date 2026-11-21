// Regression coverage for account commit rollback.
#[test]
fn rollback_failure_invalidates_affected_cached_session() {
    for previous in [Some(OLD_RAW), None] {
        let vault = Arc::new(ControlledVault {
            fail_remove: true,
            ..Default::default()
        });
        if let Some(previous) = previous {
            vault
                .values
                .lock()
                .unwrap()
                .insert(ACCOUNT_ID.into(), previous.into());
        }
        let (_temp, manager, grant, cancellation, before) = login_fixture(vault.clone());
        let other_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        let mut other_session = session("UnaffectedPlayer");
        other_session.account.id = other_id.into();
        manager
            .sessions
            .lock()
            .unwrap()
            .insert(other_id.into(), other_session);
        let token = cancellation.clone();
        *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
            if number == 1 {
                token.cancel();
            }
            ensure!(number != 2, "auth.errors.vault");
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
        assert_eq!(error.to_string(), "auth.errors.rollback");
        assert!(!manager.sessions.lock().unwrap().contains_key(ACCOUNT_ID));
        assert_eq!(
            manager
                .sessions
                .lock()
                .unwrap()
                .get(other_id)
                .unwrap()
                .account
                .name,
            "UnaffectedPlayer"
        );
        assert_eq!(fs::read(&manager.path).unwrap(), before);
    }
}

#[test]
fn login_write_failure_takes_precedence_over_cancellation() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    let token = cancellation.clone();
    *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
        if number == 1 {
            token.cancel();
            return Err(anyhow::anyhow!("auth.errors.vault"));
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
    assert_eq!(error.to_string(), "auth.errors.vault");
    assert_eq!(
        vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
        OLD_RAW
    );
    assert_unchanged(&manager, &before);
}

#[test]
fn cancellation_after_commit_transition_completes_login() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, _before) = login_fixture(vault.clone());
    let state = manager
        .commit_login_with(
            &grant,
            &cancellation,
            session("NewPlayer"),
            "NEW SECRET".into(),
            |bytes| {
                manager.cancel(&grant.prompt.id)?;
                manager.save_prepared(bytes)
            },
        )
        .unwrap();
    assert!(!cancellation.is_cancelled());
    assert_eq!(state.accounts[0].name, "NewPlayer");
    assert_eq!(manager.load().unwrap().accounts[0].name, "NewPlayer");
    assert_eq!(
        manager
            .sessions
            .lock()
            .unwrap()
            .get(ACCOUNT_ID)
            .unwrap()
            .access_token,
        "NewPlayer-access-secret"
    );
    assert!(
        vault
            .values
            .lock()
            .unwrap()
            .get(ACCOUNT_ID)
            .unwrap()
            .contains("NEW SECRET")
    );
    assert!(
        !fs::read_to_string(&manager.path)
            .unwrap()
            .contains("SECRET")
    );
}

#[test]
fn cancellation_waits_for_blocking_credential_write_and_rollback() {
    let vault = Arc::new(ControlledVault::default());
    let (_temp, manager, grant, cancellation, before) = relogin_fixture(vault.clone());
    let (entered_send, entered_receive) = std::sync::mpsc::channel();
    let (release_send, release_receive) = std::sync::mpsc::channel();
    let release_receive = Mutex::new(release_receive);
    *vault.write_hook.lock().unwrap() = Some(Arc::new(move |number| {
        if number == 1 {
            entered_send.send(()).unwrap();
            release_receive.lock().unwrap().recv().unwrap();
        }
        Ok(())
    }));
    let worker_manager = manager.clone();
    let worker_grant = grant.clone();
    let worker = std::thread::spawn(move || {
        worker_manager.commit_login(
            &worker_grant,
            &cancellation,
            session("NewPlayer"),
            "NEW SECRET".into(),
        )
    });
    entered_receive
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    manager.cancel(&grant.prompt.id).unwrap();
    assert!(!worker.is_finished());
    release_send.send(()).unwrap();
    assert_eq!(
        worker.join().unwrap().err().unwrap().to_string(),
        "auth.errors.cancelled"
    );
    assert_eq!(
        vault.values.lock().unwrap().get(ACCOUNT_ID).unwrap(),
        OLD_RAW
    );
    assert_unchanged(&manager, &before);
}
