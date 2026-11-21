use super::*;
use serde_json::{Value, json};
use std::fs;
fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../ui/scripts/fixtures/ui-suite/format-vectors.json"
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

// Include behavior groups in this module to preserve test harness paths.
include!("protocol.rs");
include!("validation.rs");
include!("storage.rs");
