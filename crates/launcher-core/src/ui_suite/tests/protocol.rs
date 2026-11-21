#[test]
fn shared_literal_canonical_and_framed_digest() {
    let v = vectors();
    assert_eq!(
        canonical::canonical(&v["canonical"]["input"]).unwrap(),
        v["canonical"]["expected"].as_str().unwrap().as_bytes()
    );
    for raw in ["-0", "-0.0", "0.0", "0e4"] {
        assert_eq!(
            canonical::canonical(&serde_json::from_str::<Value>(raw).unwrap()).unwrap(),
            b"0"
        );
    }
    for raw in ["9007199254740991", "-9007199254740991"] {
        assert_eq!(
            canonical::canonical(&serde_json::from_str::<Value>(raw).unwrap()).unwrap(),
            raw.as_bytes()
        );
    }
    for raw in ["9007199254740992", "-9007199254740992", "1.5"] {
        assert!(canonical::canonical(&serde_json::from_str::<Value>(raw).unwrap()).is_err());
    }
    for item in [
        json!({"bundle":v["bundle"],"digest":v["digest"],"manifest_hex":v["manifest_hex"]}),
        v["fix1"]["non_bmp"].clone(),
        v["fix1"]["boundary_pair"][0].clone(),
        v["fix1"]["boundary_pair"][1].clone(),
    ] {
        let b: UiSuiteBundle = serde_json::from_value(item["bundle"].clone()).unwrap();
        validation::bundle(&b).unwrap();
        assert_eq!(canonical::digest(&b).unwrap(), item["digest"]);
        let hex = canonical::canonical(&b.manifest)
            .unwrap()
            .iter()
            .map(|n| format!("{n:02x}"))
            .collect::<String>();
        assert_eq!(hex, item["manifest_hex"]);
    }
}

#[test]
fn persisted_integral_json_lexemes_share_checked_canonical_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let store = UiSuiteStore::new(&directory.path().join("config"));
    let sample = sample();
    let expected = canonical::canonical(&sample).unwrap();
    let plain = String::from_utf8(expected.clone()).unwrap();
    for zero in ["-0", "-0.0", "0.0", "0e3"] {
        let raw = plain
            .replace("\"revision\":0", &format!("\"revision\":{zero}"))
            .replace("\"schema_version\":1", "\"schema_version\":1.0")
            .replace("\"api_version\":1", "\"api_version\":1e0")
            .replace("\"order\":0", "\"order\":-0.0");
        fs::write(store.path(), raw.as_bytes()).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.revision, 0);
        assert_eq!(canonical::canonical(&loaded).unwrap(), expected);
        assert!(
            store
                .reset_recoverable(&store.inspect_recovery().unwrap().token)
                .is_err()
        );
    }
    let raw = plain.replace("\"revision\":0", "\"revision\":1e0");
    fs::write(store.path(), raw.as_bytes()).unwrap();
    assert_eq!(store.load().unwrap().revision, 1);
    assert_eq!(store.reset(1).unwrap().revision, 2);
}

#[test]
fn official_nfc_151_and_focused_scalar_parity() {
    use unicode_normalization::UnicodeNormalization;
    assert_eq!(unicode_normalization::UNICODE_VERSION, (15, 1, 0));
    let mut count = 0;
    for line in
        include_str!("../../../../../ui/scripts/fixtures/ui-suite/NormalizationTest-15.1.0.txt")
            .lines()
            .filter(|l| l.starts_with(|c: char| c.is_ascii_hexdigit()))
    {
        let values: Vec<String> = line
            .split(';')
            .take(5)
            .map(|s| {
                s.split_whitespace()
                    .map(|c| char::from_u32(u32::from_str_radix(c, 16).unwrap()).unwrap())
                    .collect()
            })
            .collect();
        for i in 0..5 {
            assert_eq!(
                values[i].nfc().collect::<String>(),
                values[if i < 3 { 1 } else { 3 }],
                "{line}"
            );
        }
        count += 1;
    }
    assert_eq!(count, 19074);
    for s in ["각", "à\u{315}", "\u{1e5ee}\u{1e5ef}", "ﬁ"] {
        assert!(unicode_normalization::is_nfc(s));
    }
    assert!(serde_json::from_str::<Value>(r#""\ud800""#).is_err());
    assert!(serde_json::from_str::<Value>(r#""\udfff""#).is_err());
    for (a, b, equal) in [
        ("Σ", "ς", true),
        ("ẞ", "ß", true),
        ("ß", "ss", false),
        ("I", "i", true),
        ("İ", "i", false),
        ("ı", "i", false),
        ("𐐀", "𐐨", true),
    ] {
        assert_eq!(paths::key(a) == paths::key(b), equal);
    }
    for p in [
        "../x",
        "/x",
        "a\\b",
        "CON.ts",
        "x./a",
        "x /a",
        "e\u{301}.ts",
        "a\u{85}.ts",
        "Suite.JSON",
    ] {
        assert!(paths::unique([&p.to_owned()]).is_err(), "{p}");
    }
}

#[test]
fn shared_asset_headers_match_data_gate() {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../../../ui/scripts/fixtures/ui-suite/browser-assets.json"
    ))
    .unwrap();
    for f in fixtures.as_array().unwrap() {
        let raw = canonical::bytes(&UiFile::Base64 {
            media_type: f["media"].as_str().unwrap().into(),
            data: f["data"].as_str().unwrap().into(),
        })
        .unwrap();
        assets::inspect(f["media"].as_str().unwrap(), &raw).unwrap();
    }
}
