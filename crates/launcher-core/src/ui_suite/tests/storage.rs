#[test]
fn candidate_revision_cannot_bypass_cas_or_overflow() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    let mut l = sample();
    l.revision = 1234;
    assert_eq!(store.save(&l, 0).unwrap().revision, 1);
    l.revision = model::MAX_SAFE;
    assert_eq!(store.save(&l, 1).unwrap().revision, 2);
    l.revision = model::MAX_SAFE;
    fs::write(store.path(), canonical::canonical(&l).unwrap()).unwrap();
    let raw = store.read_recoverable().unwrap();
    assert!(store.save(&l, model::MAX_SAFE).is_err());
    assert!(store.reset(model::MAX_SAFE).is_err());
    assert!(
        store
            .reset_recoverable(&store.inspect_recovery().unwrap().token)
            .is_err()
    );
    assert_eq!(store.read_recoverable().unwrap(), raw);
}

#[test]
fn failed_temp_publish_and_backup_preserve_exact_current() {
    use std::sync::atomic::Ordering;
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    store.save(&sample(), 0).unwrap();
    let raw = store.read_recoverable().unwrap();
    store.fault.store(1, Ordering::SeqCst);
    assert!(store.save(&UiSuiteLibrary::default(), 1).is_err());
    assert!(store.reset(1).is_err());
    assert_eq!(store.read_recoverable().unwrap(), raw);
    store.fault.store(2, Ordering::SeqCst);
    assert!(store.reset(1).is_err());
    assert_eq!(store.read_recoverable().unwrap(), raw);
    fs::write(store.path(), b"corrupt").unwrap();
    let t = store.inspect_recovery().unwrap().token;
    assert!(store.reset_recoverable(&t).is_err());
    assert_eq!(store.read_recoverable().unwrap(), b"corrupt");
}

#[test]
fn recovery_tokens_compare_complete_bytes_and_missing() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    assert_eq!(
        store.inspect_recovery().unwrap().token,
        RecoveryToken::Missing
    );
    assert_eq!(
        store
            .reset_recoverable(&RecoveryToken::Missing)
            .unwrap()
            .revision,
        1
    );
    fs::write(store.path(), b"first corrupt").unwrap();
    let t = store.inspect_recovery().unwrap().token;
    fs::write(store.path(), b"second corrupt").unwrap();
    assert!(store.reset_recoverable(&t).is_err());
    assert!(store.reset(0).is_err());
    assert_eq!(store.read_recoverable().unwrap(), b"second corrupt");
    for raw in [
        r#"{"kind":"missing","sha256":"x"}"#,
        r#"{"kind":"raw","sha256":"x","extra":1}"#,
    ] {
        assert!(serde_json::from_str::<RecoveryToken>(raw).is_err());
    }
}

#[test]
fn config_path_isolation_and_old_format_rejection() {
    let directory = tempfile::tempdir().unwrap();
    let a = UiSuiteStore::new(&directory.path().join("a"));
    let b = UiSuiteStore::new(&directory.path().join("b"));
    assert_ne!(a.path(), b.path());
    a.save(&sample(), 0).unwrap();
    assert_eq!(b.load().unwrap().revision, 0);
    // Obsolete bytes are independent opaque data, never constructed through removed APIs.
    let old = directory.path().join("ui-customization-legacy.json");
    let raw = br#"{"kind":"paradox-ui-customization","schema_version":1,"enabled":false}"#;
    fs::write(&old, raw).unwrap();
    assert_ne!(old, a.path());
    assert!(UiSuiteStore::parse(&fs::read(&old).unwrap()).is_err());
    a.reset(1).unwrap();
    assert_eq!(fs::read(&old).unwrap(), raw);
}

#[test]
fn data_valid_decoder_failure_retains_revision_and_normal_reset() {
    let mut l = sample();
    let r = &mut l.suites[0];
    let source = b"<svg><script/></svg>";
    r.overlay.insert(
        "broken.svg".into(),
        UiFile::Base64 {
            media_type: "image/svg+xml".into(),
            data: encode_recoverable_bytes(source),
        },
    );
    r.manifest["files"].as_array_mut().unwrap().push(json!({"path":"broken.svg","kind":"asset","media_type":"image/svg+xml","bytes":source.len(),"sha256":canonical::hash(source)}));
    l.revision = 7;
    validation::library(&l).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    fs::write(store.path(), canonical::canonical(&l).unwrap()).unwrap();
    assert_eq!(store.load().unwrap().revision, 7);
    assert!(
        store
            .reset_recoverable(&store.inspect_recovery().unwrap().token)
            .is_err()
    );
    assert_eq!(store.reset(7).unwrap().revision, 8);
}

#[test]
fn oversized_raw_export_and_backup_are_complete() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    let mut raw = vec![b' '; model::LIBRARY + 1];
    raw[0] = 255;
    raw[model::LIBRARY] = 17;
    fs::write(store.path(), &raw).unwrap();
    assert!(store.load().is_err());
    let export = store.read_recoverable().unwrap();
    assert_eq!(export.len(), raw.len());
    assert_eq!(canonical::hash(&export), canonical::hash(&raw));
    drop(export);
    let inspection = store.inspect_recovery().unwrap();
    assert_eq!(inspection.raw.len(), raw.len());
    store.reset_recoverable(&inspection.token).unwrap();
    drop(inspection);
    let backup = fs::read_dir(directory.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.to_string_lossy().contains(".recovery-"))
        .unwrap();
    assert_eq!(fs::metadata(&backup).unwrap().len(), raw.len() as u64);
    assert_eq!(
        canonical::hash(&fs::read(backup).unwrap()),
        canonical::hash(&raw)
    );
}

#[cfg(windows)]
#[test]
fn actual_readonly_publish_failure_preserves_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    store.save(&sample(), 0).unwrap();
    let raw = store.read_recoverable().unwrap();
    let permissions = fs::metadata(store.path()).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(store.path(), readonly).unwrap();
    let save = store.save(&UiSuiteLibrary::default(), 1);
    let reset = store.reset(1);
    let after = store.read_recoverable();
    fs::set_permissions(store.path(), permissions).unwrap();
    assert!(save.is_err() && reset.is_err());
    assert_eq!(after.unwrap(), raw);
}

#[test]
fn revision_conflict_and_failed_commit_keep_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config.json"));
    let first = store.save(&UiSuiteLibrary::default(), 0).unwrap();
    assert_eq!(first.revision, 1);
    let raw = store.read_recoverable().unwrap();
    assert!(store.save(&UiSuiteLibrary::default(), 0).is_err());
    assert_eq!(store.read_recoverable().unwrap(), raw);
    let mut invalid = first.clone();
    invalid.active_suite_id = Some("orphan".into());
    assert!(store.save(&invalid, 1).is_err());
    assert_eq!(store.read_recoverable().unwrap(), raw);
}

#[test]
fn reset_backup_before_replace() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config.json"));
    store.save(&UiSuiteLibrary::default(), 0).unwrap();
    let raw = store.read_recoverable().unwrap();
    assert_eq!(store.reset(1).unwrap().revision, 2);
    assert!(fs::read_dir(directory.path()).unwrap().any(|e| {
        let path = e.unwrap().path();
        path.to_string_lossy().contains(".recovery-") && fs::read(path).unwrap() == raw
    }));
}

#[test]
fn corrupt_raw_export() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config.json"));
    let raw = b"\xffnot a library\0";
    fs::write(store.path(), raw).unwrap();
    assert!(store.load().is_err());
    assert_eq!(store.read_recoverable().unwrap(), raw);
    let inspection = store.inspect_recovery().unwrap();
    assert_eq!(inspection.raw, raw);
    assert_eq!(
        store.reset_recoverable(&inspection.token).unwrap().revision,
        1
    );
}
