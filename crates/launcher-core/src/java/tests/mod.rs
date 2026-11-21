//! Java probing, discovery, extraction and package trust regressions.

use super::archive::{extract_archive, validate_archive_path};
use super::discovery::{
    add_candidate, collect_directory, probe_discovery_candidates, rank_discovered_installations,
};
use super::installation::validate_package;
use super::*;
use std::{collections::HashSet, io::Write};
use tokio_util::sync::CancellationToken;
use zip::write::SimpleFileOptions;

mod archive;
mod discovery;
mod packages;
mod probe;
