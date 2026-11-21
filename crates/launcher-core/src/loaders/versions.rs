//! Supported loader identifiers, catalog lookup and version ordering.
use super::catalog;
use crate::{GameProfile, Settings};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Deserialize, Serialize)]
pub struct LoaderVersion {
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

pub fn validate_loader(loader: &str, version: &str) -> Result<()> {
    ensure!(
        matches!(
            loader,
            "vanilla" | "fabric" | "quilt" | "forge" | "neoforge"
        ),
        "loaders.errors.unsupported"
    );
    if loader == "vanilla" {
        ensure!(version.is_empty(), "loaders.errors.version");
    } else {
        ensure!(
            !version.is_empty()
                && version.len() <= 80
                && version
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
                && version != "."
                && version != "..",
            "loaders.errors.version"
        );
    }
    Ok(())
}

pub async fn versions(settings: &Settings, loader: &str, game: &str) -> Result<Vec<LoaderVersion>> {
    GameProfile::new("catalog", game)?;
    ensure!(
        matches!(loader, "fabric" | "quilt" | "forge" | "neoforge"),
        "loaders.errors.unsupported"
    );
    if loader == "forge" && legacy_forge_game(game) {
        return Ok(Vec::new());
    }
    let client = settings.network.build_client()?;
    catalog::versions_from_url(
        &client,
        loader,
        game,
        &catalog::catalog_url(loader, game)?,
        Duration::from_secs(settings.network.timeout_seconds.into()),
    )
    .await
}

pub(super) fn normalize_versions(
    loader: &str,
    mut result: Vec<LoaderVersion>,
) -> Vec<LoaderVersion> {
    result.retain(|v| validate_loader(loader, &v.version).is_ok());
    result.sort_by(|a, b| {
        numeric_parts(&b.version)
            .cmp(&numeric_parts(&a.version))
            .then_with(|| b.version.cmp(&a.version))
    });
    result.dedup_by(|a, b| a.version == b.version);
    result
}

pub(super) fn numeric_parts(version: &str) -> Vec<u32> {
    version
        .split(['.', '-'])
        .map(|p| p.parse().unwrap_or_default())
        .collect()
}

pub(super) fn legacy_forge_game(game: &str) -> bool {
    let mut parts = game.split('.');
    parts.next() == Some("1")
        && parts
            .next()
            .and_then(|minor| minor.parse::<u32>().ok())
            .is_some_and(|minor| minor < 17)
}
