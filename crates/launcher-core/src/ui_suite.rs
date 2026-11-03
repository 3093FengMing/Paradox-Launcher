//! Independent UI suite persistence, revision CAS and exact-byte recovery.

mod assets;
mod canonical;
mod model;
mod paths;
mod validation;
pub use model::{
    ParentSnapshot, RecoveryInspection, RecoveryToken, UiFile, UiSuiteBundle, UiSuiteLibrary,
    UiSuiteRecord,
};
/// Raw bytes are base64 only at the dedicated IPC boundary.
pub fn encode_recoverable_bytes(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
use anyhow::{Context, Result, ensure};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Exactly one application-owned store; no business configuration lock is used.
#[derive(Debug)]
pub struct UiSuiteStore {
    path: PathBuf,
    gate: Mutex<()>,
    #[cfg(test)]
    fault: std::sync::atomic::AtomicU8,
}
impl UiSuiteStore {
    pub fn new(config_path: &Path) -> Self {
        let namespace = canonical::hash(config_path.to_string_lossy().as_bytes());
        Self {
            path: config_path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new("."))
                .join(format!("ui-suite-library-{namespace}.json")),
            gate: Mutex::new(()),
            #[cfg(test)]
            fault: std::sync::atomic::AtomicU8::new(0),
        }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.gate
            .lock()
            .map_err(|_| anyhow::anyhow!("UI suite store lock unavailable"))
    }
    fn parse(bytes: &[u8]) -> Result<UiSuiteLibrary> {
        ensure!(bytes.len() <= model::LIBRARY, "Suite library exceeds limit");
        // Parse to the same JSON value domain as the host before strict typed validation.
        let value: serde_json::Value = serde_json::from_slice(bytes)?;
        canonical::canonical(&value)?;
        let library: UiSuiteLibrary = serde_json::from_value(value)?;
        validation::library(&library)?;
        Ok(library)
    }
    fn current(&self) -> Result<UiSuiteLibrary> {
        let file = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(UiSuiteLibrary::default());
            }
            Err(e) => return Err(e).context("Read UI suite library"),
        };
        let mut raw = Vec::new();
        file.take((model::LIBRARY + 1) as u64)
            .read_to_end(&mut raw)?;
        Self::parse(&raw)
    }
    pub fn load(&self) -> Result<UiSuiteLibrary> {
        let _guard = self.lock()?;
        self.current()
    }
    pub fn save(&self, library: &UiSuiteLibrary, expected_revision: u64) -> Result<UiSuiteLibrary> {
        validation::library(library)?;
        let _guard = self.lock()?;
        let current = self.current()?;
        Self::compare(&current, expected_revision)?;
        let mut committed = library.clone();
        committed.revision = current.revision + 1;
        validation::library(&committed)?;
        self.write(&canonical::canonical(&committed)?)?;
        Ok(committed)
    }
    fn compare(current: &UiSuiteLibrary, expected: u64) -> Result<()> {
        ensure!(
            expected <= model::MAX_SAFE && current.revision == expected,
            "UI suite revision conflict"
        );
        ensure!(
            current.revision < model::MAX_SAFE,
            "UI suite revision overflow"
        );
        Ok(())
    }
    pub fn reset(&self, expected_revision: u64) -> Result<UiSuiteLibrary> {
        let _guard = self.lock()?;
        let current = self.current()?;
        Self::compare(&current, expected_revision)?;
        let reset = UiSuiteLibrary {
            revision: current.revision + 1,
            ..UiSuiteLibrary::default()
        };
        self.backup()?;
        self.write(&canonical::canonical(&reset)?)?;
        Ok(reset)
    }
    fn raw(&self) -> Result<Option<Vec<u8>>> {
        match fs::read(&self.path) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e).context("Read recoverable UI suite bytes"),
        }
    }
    pub fn read_recoverable(&self) -> Result<Vec<u8>> {
        let _guard = self.lock()?;
        Ok(self.raw()?.unwrap_or_default())
    }
    pub fn inspect_recovery(&self) -> Result<RecoveryInspection> {
        let _guard = self.lock()?;
        let raw = self.raw()?;
        let token = match &raw {
            None => RecoveryToken::Missing,
            Some(b) => RecoveryToken::Raw {
                sha256: canonical::hash(b),
            },
        };
        Ok(RecoveryInspection {
            raw: raw.unwrap_or_default(),
            token,
        })
    }
    pub fn reset_recoverable(&self, expected_token: &RecoveryToken) -> Result<UiSuiteLibrary> {
        let _guard = self.lock()?;
        let raw = self.raw()?;
        let actual = match &raw {
            None => RecoveryToken::Missing,
            Some(b) => {
                ensure!(
                    Self::parse(b).is_err(),
                    "Valid UI suite library requires revision reset"
                );
                RecoveryToken::Raw {
                    sha256: canonical::hash(b),
                }
            }
        };
        ensure!(
            &actual == expected_token,
            "UI suite recovery token conflict"
        );
        let reset = UiSuiteLibrary {
            revision: 1,
            ..UiSuiteLibrary::default()
        };
        self.backup()?;
        self.write(&canonical::canonical(&reset)?)?;
        Ok(reset)
    }
    fn backup(&self) -> Result<()> {
        let mut original = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e).context("Open UI suite backup source"),
        };
        let parent = self.path.parent().unwrap_or(Path::new("."));
        let mut backup = tempfile::NamedTempFile::new_in(parent)?;
        std::io::copy(&mut original, &mut backup)?;
        backup.as_file().sync_all()?;
        #[cfg(test)]
        ensure!(
            self.fault.load(std::sync::atomic::Ordering::SeqCst) != 2,
            "Injected backup publication failure"
        );
        let name = format!(
            "{}.recovery-{}.json",
            self.path.file_stem().unwrap_or_default().to_string_lossy(),
            uuid::Uuid::new_v4()
        );
        backup.persist_noclobber(parent.join(name))?;
        Ok(())
    }
    fn write(&self, bytes: &[u8]) -> Result<()> {
        let parent = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(bytes)?;
        temporary.as_file().sync_all()?;
        #[cfg(test)]
        ensure!(
            self.fault.load(std::sync::atomic::Ordering::SeqCst) != 1,
            "Injected library publication failure"
        );
        temporary.persist(&self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::fs;
    fn vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../../ui/scripts/fixtures/ui-suite/format-vectors.json"
        ))
        .unwrap()
    }
    fn sample() -> UiSuiteLibrary {
        let b: UiSuiteBundle = serde_json::from_value(vectors()["bundle"].clone()).unwrap();
        UiSuiteLibrary {
            suites: vec![UiSuiteRecord {
                instance_id: "fd910be2-a6bc-4976-a397-137ace486aa8".into(),
                manifest: b.manifest,
                parent_snapshot: None,
                overlay: b.files,
                deleted: vec![],
            }],
            ..UiSuiteLibrary::default()
        }
    }

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
            include_str!("../../../ui/scripts/fixtures/ui-suite/NormalizationTest-15.1.0.txt")
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
        let mut v = serde_json::to_value(&good).unwrap();
        v["suites"][0]["manifest"]["routes"][0]["icon"] = json!("Icon");
        assert!(UiSuiteStore::parse(&serde_json::to_vec(&v).unwrap()).is_err());
        for alias in ["Home", "HomeIcon", "LucideHome"] {
            let mut l = good.clone();
            l.suites[0].manifest["routes"][0]["icon"] = json!(alias);
            validation::library(&l).unwrap();
        }
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
    fn shared_asset_headers_match_data_gate() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../ui/scripts/fixtures/ui-suite/browser-assets.json"
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
}
