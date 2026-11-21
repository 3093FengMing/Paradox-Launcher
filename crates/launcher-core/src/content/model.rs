//! Serialized Modrinth results and private dependency planning records.
use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ContentRecord {
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    pub url: String,
    pub sha1: String,
    pub size: u64,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ContentEntry {
    pub name: String,
    pub category: String,
    pub size: u64,
    pub enabled: bool,
    pub record: Option<ContentRecord>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Project {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub project_type: String,
    pub downloads: u64,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct SearchResults {
    pub hits: Vec<Project>,
    pub total_hits: u64,
    pub offset: u32,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct RemoteFile {
    pub url: String,
    pub filename: String,
    pub hashes: BTreeMap<String, String>,
    pub size: u64,
    #[serde(default)]
    pub primary: bool,
}
#[derive(Clone, Deserialize)]
pub(super) struct Dependency {
    pub(super) version_id: Option<String>,
    pub(super) project_id: Option<String>,
    pub(super) dependency_type: String,
}
#[derive(Clone, Deserialize)]
pub(super) struct Version {
    pub(super) id: String,
    pub(super) project_id: String,
    pub(super) name: String,
    pub(super) game_versions: Vec<String>,
    pub(super) loaders: Vec<String>,
    pub(super) files: Vec<RemoteFile>,
    pub(super) dependencies: Vec<Dependency>,
}
