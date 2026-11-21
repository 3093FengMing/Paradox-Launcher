//! Loader catalogs and bounded SDK preparation behind one application facade.

mod catalog;
mod installation_paths;
mod prepare;
mod profile;
mod versions;

pub(crate) use catalog::fetch_resource as fetch_metadata_resource;
pub(crate) use installation_paths::{InstallationPaths, validate_target};
pub use prepare::prepare;
use versions::normalize_versions;
pub use versions::{LoaderVersion, validate_loader, versions};

#[cfg(test)]
mod tests;
