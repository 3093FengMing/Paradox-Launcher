//! Host virtual paths use pinned Unicode15.1 NFC and the internal shared C/S fold table.
//! unicode-normalization=0.1.23 uses Unicode15.1, MIT/Apache-2.0, upstream Rust1.36 floor.
use anyhow::{Result, ensure};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::LazyLock,
};
use unicode_normalization::is_nfc;
#[derive(Deserialize)]
struct Fold {
    mappings: Vec<(u32, u32)>,
}
static FOLD: LazyLock<BTreeMap<u32, u32>> = LazyLock::new(|| {
    serde_json::from_str::<Fold>(include_str!(
        "../../../../ui/src/host/unicode/unicode-simple-fold-15.1.0.json"
    ))
    .expect("Pinned fold data")
    .mappings
    .into_iter()
    .collect()
});
pub fn key(s: &str) -> String {
    s.chars()
        .map(|c| {
            char::from_u32(*FOLD.get(&(c as u32)).unwrap_or(&(c as u32))).expect("Pinned scalar")
        })
        .collect()
}
pub fn path(s: &str) -> Result<()> {
    ensure!(!s.is_empty() && is_nfc(s), "Invalid suite path");
    ensure!(
        !s.chars().any(|c| c <= '\u{1f}'
            || ('\u{7f}'..='\u{9f}').contains(&c)
            || "\\<>:\"|?*".contains(c)),
        "Invalid suite path"
    );
    for p in s.split('/') {
        ensure!(
            !p.is_empty() && p != "." && p != ".." && !p.ends_with(['.', ' ']),
            "Invalid suite path"
        );
        let stem = p.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        ensure!(!reserved, "Reserved suite path");
    }
    Ok(())
}
pub fn unique<'a>(paths: impl IntoIterator<Item = &'a String>) -> Result<()> {
    let mut keys = BTreeSet::new();
    for p in paths {
        path(p)?;
        let k = key(p);
        ensure!(k != "suite.json" && keys.insert(k), "Colliding suite path");
    }
    Ok(())
}
