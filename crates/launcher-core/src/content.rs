//! Instance-local content with checked paths, verified downloads and rollback.
use crate::{
    GameProfile, Settings,
    download::{Artifact, Checksum, DownloadEngine, DownloadProgress},
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha1::{Digest, Sha1};
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

const REGISTRY: &str = ".paradox-content.json";
const MAX_REGISTRY_BYTES: usize = 4 * 1024 * 1024;

mod install;
mod local;
mod model;
mod remote;
mod transaction;

pub use install::install;
pub use local::{hash_file, list, path, registry, remove, root, toggle};
pub use model::{ContentEntry, ContentRecord, Project, RemoteFile, SearchResults};
pub use remote::{json, latest_pack, pack_file, search, validate_remote};
pub use transaction::commit;

#[cfg(test)]
use install::install_files;
use local::registry_bytes;
#[cfg(test)]
use local::toggle_with_staging;
use model::Version;
use remote::{compatible, identifier, latest};
#[cfg(test)]
use transaction::rollback;

#[cfg(test)]
mod tests {
    use super::*;
    include!("content/tests/fixtures.rs");
    include!("content/tests/toggle.rs");
    include!("content/tests/transfer.rs");
    include!("content/tests/update.rs");
    include!("content/tests/conflicts.rs");
    include!("content/tests/failures.rs");
    include!("content/tests/rollback.rs");
}
