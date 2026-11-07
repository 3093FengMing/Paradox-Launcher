use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, ensure};

/// Paths the SDK may create, overwrite, or extract into during installation.
pub(crate) struct InstallationPaths {
    root: PathBuf,
    pub(crate) instance: PathBuf,
    instance_key: String,
}

impl InstallationPaths {
    pub(crate) fn new(root: &Path, instance_key: &str) -> Result<Self> {
        crate::model::validate_instance_key(instance_key).context("loaders.errors.path")?;
        let paths = Self {
            root: root.to_owned(),
            instance: root.join("versions").join(instance_key),
            instance_key: instance_key.to_owned(),
        };
        paths.validate()?;
        Ok(paths)
    }

    /// Recheck before each SDK write phase, since metadata and downloads await I/O.
    pub(crate) fn validate(&self) -> Result<()> {
        validate_target(&self.root, &self.root)?;
        validate_target(&self.root, &self.instance)?;
        for target in [
            self.root.join("assets"),
            self.root.join("libraries"),
            self.instance.join(".elemental"),
            self.instance.join("natives"),
            self.instance.join(format!("{}.json", self.instance_key)),
            self.instance.join(format!("{}.jar", self.instance_key)),
        ] {
            reject_tree_links(&target)?;
        }
        Ok(())
    }

    pub(crate) fn validate_asset_index(&self, id: &str) -> Result<()> {
        crate::model::validate_instance_key(id).context("资源索引文件名无效")?;
        validate_target(
            &self.root,
            &self.root.join("assets/indexes").join(format!("{id}.json")),
        )
    }
}

/// Check lexical containment and every existing ancestor, including ancestors of
/// the game root. symlink_metadata also detects dangling links and junctions.
pub(crate) fn validate_target(root: &Path, target: &Path) -> Result<()> {
    ensure!(
        root.is_absolute()
            && target.starts_with(root)
            && !target
                .components()
                .any(|part| matches!(part, Component::ParentDir)),
        "loaders.errors.path"
    );
    for ancestor in target.ancestors() {
        reject_link(ancestor)?;
    }
    Ok(())
}

fn reject_tree_links(target: &Path) -> Result<()> {
    let mut pending = vec![target.to_owned()];
    while let Some(path) = pending.pop() {
        if let Some(metadata) = reject_link(&path)?
            && metadata.is_dir()
        {
            for entry in fs::read_dir(path)? {
                pending.push(entry?.path());
            }
        }
    }
    Ok(())
}

fn reject_link(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let mut linked = metadata.file_type().is_symlink();
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                linked |= metadata.file_attributes() & 0x400 != 0;
            }
            ensure!(!linked, "loaders.errors.path");
            Ok(Some(metadata))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_installation_paths_allow_creation_and_existing_metadata() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap().join("minecraft");
        let paths = InstallationPaths::new(&root, "1.21.1").unwrap();
        assert!(!root.exists(), "validation must not create a directory");
        fs::create_dir_all(&paths.instance).unwrap();
        fs::write(paths.instance.join("1.21.1.json"), b"existing metadata").unwrap();
        fs::create_dir_all(root.join("assets/indexes")).unwrap();
        fs::write(root.join("assets/indexes/17.json"), b"existing index").unwrap();
        paths.validate().unwrap();
        paths.validate_asset_index("17").unwrap();
        assert_eq!(
            fs::read(paths.instance.join("1.21.1.json")).unwrap(),
            b"existing metadata"
        );
        assert!(paths.validate_asset_index("../outside").is_err());
        assert!(validate_target(&root, &root.join("../outside")).is_err());
    }
}
