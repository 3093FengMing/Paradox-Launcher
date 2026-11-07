//! Strict DATA composition: manifest, files, references, fixed parent and hashes.
use super::{assets, canonical, model::*, paths};
use anyhow::{Result, ensure};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
const PAGES: [&str; 7] = [
    "home",
    "instances",
    "downloads",
    "accounts",
    "settings",
    "logs",
    "content",
];
fn object(v: &Value) -> Result<&Map<String, Value>> {
    v.as_object()
        .ok_or_else(|| anyhow::anyhow!("Invalid suite object"))
}
fn exact<'a>(v: &'a Value, required: &[&str], optional: &[&str]) -> Result<&'a Map<String, Value>> {
    let o = object(v)?;
    ensure!(
        required.iter().all(|k| o.contains_key(*k))
            && o.keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str())),
        "Invalid suite fields"
    );
    Ok(o)
}
fn text(v: &Value, min: usize, max: usize) -> Result<&str> {
    let s = v
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid suite string"))?;
    ensure!(
        (min..=max).contains(&s.chars().count()),
        "Invalid suite string length"
    );
    Ok(s)
}
fn array(v: &Value) -> Result<&Vec<Value>> {
    v.as_array()
        .ok_or_else(|| anyhow::anyhow!("Invalid suite array"))
}
fn integer(v: &Value, min: u64, max: u64) -> Result<u64> {
    let n = v
        .as_f64()
        .ok_or_else(|| anyhow::anyhow!("Invalid suite number"))?;
    ensure!(
        n.is_finite() && n.fract() == 0.0 && n >= min as f64 && n <= max as f64,
        "Invalid suite integer"
    );
    Ok(n as u64)
}
fn label(v: &Value, max: usize) -> Result<()> {
    ensure!(
        !text(v, 1, max)?
            .chars()
            .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c)),
        "Invalid suite label"
    );
    Ok(())
}
fn hash(s: &str) -> Result<()> {
    ensure!(
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "Invalid suite hash"
    );
    Ok(())
}
fn uuid(s: &str) -> Result<()> {
    ensure!(
        s.len() == 36
            && s.bytes()
                .enumerate()
                .all(|(i, b)| if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                }),
        "Invalid suite UUID"
    );
    Ok(())
}
fn identity(v: &Value) -> Result<()> {
    let o = exact(v, &["namespace", "value"], &[])?;
    text(&o["namespace"], 1, usize::MAX)?;
    text(&o["value"], 0, usize::MAX)?;
    Ok(())
}
fn selector(v: &Value) -> Result<()> {
    let o = object(v)?;
    let target = o
        .get("target")
        .ok_or_else(|| anyhow::anyhow!("Missing selector target"))?;
    text(target, 1, usize::MAX)?;
    match o.get("kind").and_then(Value::as_str) {
        Some("type") => {
            exact(v, &["kind", "target"], &[])?;
        }
        Some("business") => {
            exact(v, &["kind", "target", "identity"], &[])?;
            identity(&o["identity"])?;
        }
        Some("position") => {
            exact(v, &["kind", "target", "locator"], &[])?;
            let l = exact(
                &o["locator"],
                &["version", "renderRoot", "calls", "business"],
                &[],
            )?;
            ensure!(
                integer(&l["version"], 1, 1)? == 1
                    && matches!(
                        text(&l["renderRoot"], 0, usize::MAX)?,
                        "launcher.main" | "launcher.editor"
                    ),
                "Invalid position locator"
            );
            for call in array(&l["calls"])? {
                let c = exact(call, &["site", "key"], &[])?;
                text(&c["site"], 1, usize::MAX)?;
                if !c["key"].is_null() {
                    text(&c["key"], 0, usize::MAX)?;
                }
            }
            for id in array(&l["business"])? {
                identity(id)?;
            }
        }
        _ => anyhow::bail!("Invalid suite selector"),
    }
    Ok(())
}
fn reference<'a>(
    v: &'a Value,
    kinds: &[&str],
    descriptors: &BTreeMap<&str, &Value>,
) -> Result<&'a str> {
    let p = text(v, 0, usize::MAX)?;
    paths::path(p)?;
    let d = descriptors
        .get(p)
        .ok_or_else(|| anyhow::anyhow!("Missing suite reference"))?;
    ensure!(
        kinds.contains(&text(&d["kind"], 0, usize::MAX)?),
        "Invalid suite reference kind"
    );
    Ok(p)
}
fn manifest(v: &Value) -> Result<()> {
    ensure!(
        canonical::canonical(v)?.len() <= MANIFEST,
        "Suite manifest exceeds limit"
    );
    let o = exact(
        v,
        &[
            "kind",
            "schema_version",
            "api_version",
            "id",
            "version",
            "name",
            "views",
            "routes",
            "styles",
            "files",
            "overrides",
        ],
        &[],
    )?;
    ensure!(
        o["kind"] == "paradox-ui-suite"
            && integer(&o["schema_version"], 1, 1)? == 1
            && integer(&o["api_version"], 1, 1)? == 1,
        "Invalid suite manifest version"
    );
    uuid(text(&o["id"], 0, usize::MAX)?)?;
    label(&o["version"], 64)?;
    label(&o["name"], 48)?;
    let descriptions = array(&o["files"])?;
    ensure!(descriptions.len() <= FILES, "Too many suite files");
    let mut descriptors = BTreeMap::new();
    let mut names = vec![];
    for d in descriptions {
        let f = exact(d, &["path", "kind", "bytes", "sha256"], &["media_type"])?;
        let p = text(&f["path"], 0, usize::MAX)?;
        paths::path(p)?;
        let kind = text(&f["kind"], 0, usize::MAX)?;
        ensure!(
            ["ts", "tsx", "html", "css", "asset"].contains(&kind),
            "Invalid suite file kind"
        );
        integer(
            &f["bytes"],
            0,
            if kind == "asset" { ASSET } else { SOURCE } as u64,
        )?;
        hash(text(&f["sha256"], 0, usize::MAX)?)?;
        if kind == "asset" {
            text(
                f.get("media_type")
                    .ok_or_else(|| anyhow::anyhow!("Missing media type"))?,
                1,
                usize::MAX,
            )?;
        } else {
            ensure!(
                !f.contains_key("media_type") && p.ends_with(&format!(".{kind}")),
                "Invalid source descriptor"
            );
        }
        names.push(p.to_owned());
        descriptors.insert(p, d);
    }
    paths::unique(&names)?;
    let views = object(&o["views"])?;
    for (id, p) in views {
        ensure!(
            !id.is_empty()
                && id.len() <= 96
                && id.as_bytes()[0].is_ascii_lowercase()
                && id.bytes().all(|b| b.is_ascii_lowercase()
                    || b.is_ascii_digit()
                    || matches!(b, b'.' | b'-'))
                && !matches!(id.as_str(), "tool.recovery" | "host.recovery"),
            "Invalid suite view ID"
        );
        reference(p, &["tsx", "html"], &descriptors)?;
    }
    for required in [
        "layout.shell",
        "tool.editor",
        "host.loading",
        "host.error",
        "host.notifications",
        "dialog.profile",
        "dialog.instance-settings",
        "dialog.import-instances",
        "dialog.remove-profile",
        "dialog.close-request",
        "dialog.launch-account",
        "dialog.login",
        "dialog.preset",
        "dialog.argument-template",
    ] {
        ensure!(views.contains_key(required), "Missing required suite view");
    }
    let routes = array(&o["routes"])?;
    ensure!((7..=39).contains(&routes.len()), "Invalid route count");
    let mut ids = BTreeSet::new();
    let mut custom = 0;
    for route in routes {
        let r = exact(
            route,
            &[
                "id",
                "entry",
                "title",
                "description",
                "navigation",
                "startupSelectable",
                "order",
                "icon",
            ],
            &[],
        )?;
        let id = text(&r["id"], 0, usize::MAX)?;
        if !PAGES.contains(&id) {
            let suffix = id
                .strip_prefix("custom.")
                .ok_or_else(|| anyhow::anyhow!("Invalid route ID"))?;
            ensure!(
                !suffix.is_empty()
                    && suffix.len() <= 64
                    && suffix.as_bytes()[0].is_ascii_lowercase()
                    && suffix
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
                "Invalid custom route ID"
            );
            custom += 1;
        }
        ensure!(
            ids.insert(id) && r["navigation"].is_boolean() && r["startupSelectable"].is_boolean(),
            "Invalid route descriptor"
        );
        integer(&r["order"], 0, 1_000_000)?;
        for (key, min) in [("entry", 1), ("title", 1), ("description", 0)] {
            ensure!(
                !text(&r[key], min, usize::MAX)?
                    .chars()
                    .any(|c| c <= '\u{1f}' || c == '\u{7f}'),
                "Invalid route string"
            );
        }
        if !r["icon"].is_null() {
            ensure!(
                !text(&r["icon"], 1, 128)?
                    .chars()
                    .any(|c| c <= '\u{1f}' || c == '\u{7f}'),
                "Invalid route icon"
            );
        }
        let p = reference(&r["entry"], &["tsx", "html"], &descriptors)?;
        if let Some(view) = views.get(&format!("page.{id}")) {
            ensure!(view == p, "Mismatched route view");
        }
    }
    ensure!(
        custom <= 32 && PAGES.iter().all(|id| ids.contains(id)),
        "Incomplete route registry"
    );
    for p in array(&o["styles"])? {
        reference(p, &["css"], &descriptors)?;
    }
    for ov in array(&o["overrides"])? {
        let ov = exact(ov, &["selector", "enabled", "stylesheet", "entry"], &[])?;
        selector(&ov["selector"])?;
        ensure!(ov["enabled"].is_boolean(), "Invalid override enabled");
        if !ov["stylesheet"].is_null() {
            reference(&ov["stylesheet"], &["css"], &descriptors)?;
        }
        if !ov["entry"].is_null() {
            reference(&ov["entry"], &["tsx", "html"], &descriptors)?;
        }
    }
    Ok(())
}
fn files(table: &BTreeMap<String, UiFile>) -> Result<()> {
    ensure!(table.len() <= FILES, "Too many suite files");
    paths::unique(table.keys())?;
    for f in table.values() {
        match f {
            UiFile::Utf8 { text } => ensure!(text.len() <= SOURCE, "Suite source exceeds limit"),
            UiFile::Base64 { media_type, data } => {
                ensure!(
                    data.len() <= ASSET.div_ceil(3) * 4,
                    "Suite asset exceeds limit"
                );
                assets::inspect(media_type, &canonical::bytes(f)?)?;
            }
        }
    }
    Ok(())
}
pub fn bundle(b: &UiSuiteBundle) -> Result<()> {
    manifest(&b.manifest)?;
    files(&b.files)?;
    let descriptors = array(&b.manifest["files"])?;
    ensure!(
        descriptors.len() == b.files.len(),
        "Mismatched suite file table"
    );
    let mut total = canonical::canonical(&b.manifest)?.len();
    for d in descriptors {
        let p = text(&d["path"], 0, usize::MAX)?;
        let f = b
            .files
            .get(p)
            .ok_or_else(|| anyhow::anyhow!("Missing suite file"))?;
        let bytes = canonical::bytes(f)?;
        ensure!(
            bytes.len() as u64 == integer(&d["bytes"], 0, ASSET as u64)?
                && canonical::hash(&bytes) == text(&d["sha256"], 0, usize::MAX)?,
            "Suite bytes/SHA mismatch"
        );
        match f {
            UiFile::Utf8 { .. } => ensure!(d["kind"] != "asset", "Mismatched source encoding"),
            UiFile::Base64 { media_type, .. } => ensure!(
                d["kind"] == "asset" && d["media_type"] == *media_type,
                "Mismatched asset encoding"
            ),
        }
        total += bytes.len();
        ensure!(total <= TOTAL, "Suite materialization exceeds limit");
    }
    Ok(())
}
pub fn library(l: &UiSuiteLibrary) -> Result<()> {
    ensure!(
        l.kind == "paradox-ui-suite-library"
            && l.schema_version == 1
            && l.revision <= MAX_SAFE
            && l.suites.len() <= 16,
        "Invalid suite library"
    );
    ensure!(
        canonical::canonical(l)?.len() <= LIBRARY,
        "Suite library exceeds limit"
    );
    let mut ids = BTreeSet::new();
    for r in &l.suites {
        uuid(&r.instance_id)?;
        ensure!(
            ids.insert(r.instance_id.as_str()),
            "Duplicate suite instance"
        );
        manifest(&r.manifest)?;
        files(&r.overlay)?;
        paths::unique(&r.deleted)?;
        let mut table = BTreeMap::new();
        if let Some(parent) = &r.parent_snapshot {
            hash(&parent.digest)?;
            bundle(&parent.bundle)?;
            ensure!(
                canonical::digest(&parent.bundle)? == parent.digest,
                "Suite snapshot digest mismatch"
            );
            table = parent.bundle.files.clone();
        }
        for p in &r.deleted {
            ensure!(
                table.contains_key(p) && !r.overlay.contains_key(p),
                "Invalid suite deletion"
            );
            table.remove(p);
        }
        table.extend(r.overlay.clone());
        bundle(&UiSuiteBundle {
            manifest: r.manifest.clone(),
            files: table,
        })?;
    }
    if let Some(id) = &l.active_suite_id {
        ensure!(
            matches!(id.as_str(), "builtin.modern" | "builtin.immersive")
                || ids.contains(id.as_str()),
            "Invalid active suite reference"
        );
    }
    Ok(())
}
