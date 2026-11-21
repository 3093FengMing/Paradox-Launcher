//! Bounded Modrinth queries, compatible version selection and trusted download metadata.
use super::*;

pub async fn json<T: DeserializeOwned>(settings: &Settings, path: &str) -> Result<T> {
    let client = settings.network.build_client()?;
    let mut response = client
        .get(format!("https://api.modrinth.com/v2/{path}"))
        .timeout(Duration::from_secs(settings.network.timeout_seconds.into()))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("content.errors.network"))?
        .error_for_status()
        .map_err(|_| anyhow::anyhow!("content.errors.network"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= 8 * 1024 * 1024,
            "content.errors.response"
        );
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("content.errors.response"))
}
pub async fn search(
    settings: &Settings,
    query: &str,
    category: &str,
    offset: u32,
) -> Result<SearchResults> {
    ensure!(
        query.len() <= 256 && offset <= 10000,
        "content.errors.query"
    );
    ensure!(
        matches!(category, "mod" | "modpack" | "resourcepack" | "shader"),
        "content.errors.category"
    );
    let facets = serde_json::to_string(&vec![vec![format!("project_type:{category}")]])?;
    let params = reqwest::Url::parse_with_params(
        "https://api.modrinth.com/v2/search",
        &[
            ("query", query),
            ("facets", facets.as_str()),
            ("limit", "20"),
            ("offset", offset.to_string().as_str()),
        ],
    )?;
    json(
        settings,
        &format!("search?{}", params.query().unwrap_or_default()),
    )
    .await
}
pub(super) fn identifier(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "content.errors.project"
    );
    Ok(())
}
pub(super) fn compatible(version: &Version, profile: &GameProfile, category: &str) -> bool {
    version
        .game_versions
        .iter()
        .any(|v| v == &profile.game_version)
        && (category != "mod" || version.loaders.iter().any(|l| l == &profile.loader))
}
pub(super) async fn latest(
    settings: &Settings,
    project: &str,
    profile: &GameProfile,
    category: &str,
) -> Result<Version> {
    identifier(project)?;
    let mut params = reqwest::Url::parse_with_params(
        "https://api.modrinth.com/v2/",
        &[(
            "game_versions",
            serde_json::to_string(&[&profile.game_version])?.as_str(),
        )],
    )?;
    if category == "mod" {
        params
            .query_pairs_mut()
            .append_pair("loaders", &serde_json::to_string(&[&profile.loader])?);
    }
    let versions: Vec<Version> = json(
        settings,
        &format!(
            "project/{project}/version?{}",
            params.query().unwrap_or_default()
        ),
    )
    .await?;
    versions
        .into_iter()
        .find(|v| compatible(v, profile, category))
        .ok_or_else(|| anyhow::anyhow!("content.errors.compatibility"))
}
pub async fn pack_file(
    settings: &Settings,
    project: &str,
    profile: &GameProfile,
) -> Result<RemoteFile> {
    let version = latest(settings, project, profile, "modpack").await?;
    version
        .files
        .into_iter()
        .find(|file| file.filename.ends_with(".mrpack"))
        .ok_or_else(|| anyhow::anyhow!("content.errors.pack"))
}

pub async fn latest_pack(settings: &Settings, project: &str) -> Result<RemoteFile> {
    identifier(project)?;
    let versions: Vec<Version> = json(settings, &format!("project/{project}/version")).await?;
    let file = versions
        .into_iter()
        .flat_map(|v| v.files)
        .find(|f| f.filename.ends_with(".mrpack"))
        .context("content.errors.pack")?;
    validate_remote(&file)?;
    ensure!(file.size <= 512 * 1024 * 1024, "content.errors.size");
    Ok(file)
}

pub fn validate_remote(file: &RemoteFile) -> Result<()> {
    crate::model::validate_instance_key(&file.filename)?;
    ensure!(
        (1..=2 * 1024 * 1024 * 1024).contains(&file.size),
        "content.errors.size"
    );
    let url = reqwest::Url::parse(&file.url)?;
    ensure!(
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.host_str() == Some("cdn.modrinth.com"),
        "content.errors.url"
    );
    let hash = file.hashes.get("sha1").context("content.errors.hash")?;
    ensure!(
        hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit()),
        "content.errors.hash"
    );
    Ok(())
}
