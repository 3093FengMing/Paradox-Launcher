//! Portable pack index models, path/URL validation, and loader profile mapping.
use crate::{GameProfile, content};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackIndex {
    pub format_version: u32,
    pub game: String,
    pub version_id: String,
    pub name: String,
    #[serde(default)]
    pub files: Vec<PackFile>,
    pub dependencies: BTreeMap<String, String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    pub path: String,
    pub hashes: BTreeMap<String, String>,
    pub downloads: Vec<String>,
    pub file_size: u64,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}
pub fn content_path(relative: &str) -> Result<()> {
    let first = relative.split('/').next().unwrap_or_default();
    ensure!(
        matches!(
            first,
            "mods"
                | "resourcepacks"
                | "shaderpacks"
                | "config"
                | "defaultconfigs"
                | "kubejs"
                | "scripts"
                | "saves"
        ) || matches!(relative, "options.txt" | "servers.dat"),
        "content.errors.path"
    );
    // The same checks as local content operations, including Windows reserved names.
    content::path(Path::new("."), relative)?;
    Ok(())
}
pub(super) fn validate_index(index: &PackIndex) -> Result<()> {
    ensure!(
        index.format_version == 1 && index.game == "minecraft" && index.files.len() <= 10000,
        "content.errors.pack"
    );
    let profile = profile(index)?;
    profile.validate()?;
    let mut paths = BTreeSet::new();
    let mut bytes = 0u64;
    for file in &index.files {
        content_path(&file.path)?;
        ensure!(
            paths.insert(file.path.to_ascii_lowercase()),
            "content.errors.conflict"
        );
        ensure!(file.file_size <= 512 * 1024 * 1024, "content.errors.size");
        bytes = bytes
            .checked_add(file.file_size)
            .context("content.errors.size")?;
        ensure!(bytes <= 8 * 1024 * 1024 * 1024, "content.errors.size");
        let sha1 = file.hashes.get("sha1").context("content.errors.hash")?;
        ensure!(
            sha1.len() == 40 && sha1.bytes().all(|b| b.is_ascii_hexdigit()),
            "content.errors.hash"
        );
        ensure!(
            !file.downloads.is_empty() && file.downloads.len() <= 8,
            "content.errors.url"
        );
        for url in &file.downloads {
            validate_url(url)?;
        }
        ensure!(
            file.env
                .get("client")
                .is_none_or(|v| matches!(v.as_str(), "required" | "optional" | "unsupported")),
            "content.errors.pack"
        );
    }
    Ok(())
}
fn validate_url(raw: &str) -> Result<()> {
    let url = reqwest::Url::parse(raw)?;
    ensure!(
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(
                url.host_str(),
                Some(
                    "cdn.modrinth.com"
                        | "github.com"
                        | "raw.githubusercontent.com"
                        | "objects.githubusercontent.com"
                        | "mediafilez.forgecdn.net"
                        | "edge.forgecdn.net"
                )
            ),
        "content.errors.url"
    );
    Ok(())
}
pub fn profile(index: &PackIndex) -> Result<GameProfile> {
    let game = index
        .dependencies
        .get("minecraft")
        .context("content.errors.pack")?;
    let mut profile = GameProfile::new(&index.name, game)?;
    let mut loader = None;
    for (key, value) in &index.dependencies {
        let kind = match key.as_str() {
            "minecraft" => continue,
            "fabric-loader" => "fabric",
            "quilt-loader" => "quilt",
            "forge" => "forge",
            "neoforge" => "neoforge",
            _ => bail!("loaders.errors.unsupported"),
        };
        ensure!(loader.is_none(), "content.errors.pack");
        loader = Some((kind, value));
    }
    if let Some((kind, value)) = loader {
        profile.loader = kind.into();
        profile.loader_version = value.clone();
    }
    profile.validate()?;
    Ok(profile)
}
