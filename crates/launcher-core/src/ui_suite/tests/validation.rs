#[test]
fn strict_schema_metadata_and_parent_rules() {
    let good = sample();
    validation::library(&good).unwrap();
    for field in ["active_suite_id", "suites", "revision"] {
        let mut v = serde_json::to_value(&good).unwrap();
        v.as_object_mut().unwrap().remove(field);
        assert!(UiSuiteStore::parse(&serde_json::to_vec(&v).unwrap()).is_err());
    }
    let mut v = serde_json::to_value(&good).unwrap();
    v["surprise"] = json!(true);
    assert!(UiSuiteStore::parse(&serde_json::to_vec(&v).unwrap()).is_err());
    for field in ["bytes", "sha256"] {
        let mut l = good.clone();
        l.suites[0].manifest["files"][0][field] = if field == "bytes" {
            json!(0)
        } else {
            json!("0".repeat(64))
        };
        assert!(validation::library(&l).is_err());
    }
    let mut l = good.clone();
    l.suites[0].deleted = vec!["Home.tsx".into()];
    assert!(validation::library(&l).is_err());
    let mut l = good;
    let parent = UiSuiteBundle {
        manifest: l.suites[0].manifest.clone(),
        files: l.suites[0].overlay.clone(),
    };
    let digest = canonical::digest(&parent).unwrap();
    l.suites[0].parent_snapshot = Some(ParentSnapshot {
        digest,
        bundle: parent,
    });
    validation::library(&l).unwrap();
    l.suites[0].parent_snapshot.as_mut().unwrap().digest = "0".repeat(64);
    assert!(validation::library(&l).is_err());
}

#[test]
fn route_icons_are_bounded_opaque_strings() {
    let good = sample();
    for icon in [
        Value::Null,
        json!("Icon"),
        json!("Github"),
        json!("Chrome"),
        json!("suite:星"),
        json!(" Home "),
        json!(" "),
        json!("\u{85}"),
        json!("__proto__"),
        json!("<svg onload=alert(1)>"),
        json!("\u{1f680}".repeat(128)),
    ] {
        let mut l = good.clone();
        l.suites[0].manifest["routes"][0]["icon"] = icon.clone();
        let parsed = UiSuiteStore::parse(&serde_json::to_vec(&l).unwrap()).unwrap();
        assert_eq!(parsed.suites[0].manifest["routes"][0]["icon"], icon);
    }
    for icon in [
        json!(""),
        json!("a".repeat(129)),
        json!("\u{1f680}".repeat(129)),
        json!(true),
        json!(1),
        json!([]),
        json!({"name": "Home"}),
    ] {
        let mut l = good.clone();
        l.suites[0].manifest["routes"][0]["icon"] = icon;
        assert!(UiSuiteStore::parse(&serde_json::to_vec(&l).unwrap()).is_err());
    }
    for control in (0..=0x1f).chain(std::iter::once(0x7f)) {
        let mut l = good.clone();
        l.suites[0].manifest["routes"][0]["icon"] =
            json!(format!("suite:{}", char::from_u32(control).unwrap()));
        assert!(UiSuiteStore::parse(&serde_json::to_vec(&l).unwrap()).is_err());
    }
    for invalid_unicode in [r#""\ud800""#, r#""\udfff""#, r#""\ud800a""#] {
        let mut l = good.clone();
        l.suites[0].manifest["routes"][0]["icon"] = json!("SURROGATE_TEST_ICON");
        let serialized = serde_json::to_string(&l).unwrap();
        let raw = serialized.replace(r#""SURROGATE_TEST_ICON""#, invalid_unicode);
        assert!(UiSuiteStore::parse(raw.as_bytes()).is_err());
    }
}

#[test]
fn fixed_parent_case_only_rename_validates_final_table() {
    let mut l = sample();
    let r = &mut l.suites[0];
    let parent = UiSuiteBundle {
        manifest: r.manifest.clone(),
        files: r.overlay.clone(),
    };
    r.parent_snapshot = Some(ParentSnapshot {
        digest: canonical::digest(&parent).unwrap(),
        bundle: parent,
    });
    // Add/delete a non-reference source so required view references stay unchanged.
    let file = UiFile::Utf8 {
        text: String::new(),
    };
    r.parent_snapshot
        .as_mut()
        .unwrap()
        .bundle
        .files
        .insert("lower.ts".into(), file.clone());
    r.parent_snapshot.as_mut().unwrap().bundle.manifest["files"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"lower.ts","kind":"ts","bytes":0,"sha256":canonical::hash(b"")}));
    let p = r.parent_snapshot.as_mut().unwrap();
    p.digest = canonical::digest(&p.bundle).unwrap();
    r.overlay.insert("LOWER.ts".into(), file);
    r.deleted = vec!["lower.ts".into()];
    r.manifest["files"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"LOWER.ts","kind":"ts","bytes":0,"sha256":canonical::hash(b"")}));
    validation::library(&l).unwrap();
    l.suites[0].deleted.clear();
    assert!(validation::library(&l).is_err());
}

#[test]
fn data_size_count_and_manifest_boundaries() {
    let mut l = sample();
    let r = &mut l.suites[0];
    let source = "x".repeat(model::SOURCE);
    r.overlay.insert(
        "limit.ts".into(),
        UiFile::Utf8 {
            text: source.clone(),
        },
    );
    r.manifest["files"].as_array_mut().unwrap().push(json!({"path":"limit.ts","kind":"ts","bytes":source.len(),"sha256":canonical::hash(source.as_bytes())}));
    validation::library(&l).unwrap();
    if let UiFile::Utf8 { text } = l.suites[0].overlay.get_mut("limit.ts").unwrap() {
        text.push('x');
    }
    assert!(validation::library(&l).is_err());
    let mut l = sample();
    let manifest = &mut l.suites[0].manifest;
    let initial = canonical::canonical(manifest).unwrap().len();
    manifest["routes"][0]["description"] = json!("x".repeat(model::MANIFEST - initial));
    validation::library(&l).unwrap();
    l.suites[0].manifest["routes"][0]["description"]
        .as_str()
        .unwrap();
    l.suites[0].manifest["routes"][0]["description"] =
        json!("x".repeat(model::MANIFEST - initial + 1));
    assert!(validation::library(&l).is_err());
    let mut l = sample();
    l.suites = vec![l.suites[0].clone(); 17];
    assert!(validation::library(&l).is_err());
    let mut l = sample();
    let r = &mut l.suites[0];
    for i in 1..model::FILES {
        let path = format!("f{i}.ts");
        r.overlay.insert(
            path.clone(),
            UiFile::Utf8 {
                text: String::new(),
            },
        );
        r.manifest["files"]
            .as_array_mut()
            .unwrap()
            .push(json!({"path":path,"kind":"ts","bytes":0,"sha256":canonical::hash(b"")}));
    } // Descriptor byte ceiling is independent; shrink views-free headers cannot bypass file count.
    r.overlay.insert(
        "overflow.ts".into(),
        UiFile::Utf8 {
            text: String::new(),
        },
    );
    assert!(validation::library(&l).is_err());
    let mut raw = vec![b' '; model::ASSET];
    raw[0] = b'<';
    assets::inspect("image/svg+xml", &raw).unwrap();
    raw.push(b' ');
    assert!(assets::inspect("image/svg+xml", &raw).is_err());
}
