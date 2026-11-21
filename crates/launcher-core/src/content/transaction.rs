//! Publish staged files atomically, keeping originals on any incomplete rollback.
use super::*;

/// Back up all affected files before publishing; rollback restores originals on any failure.
pub fn commit(
    root: &Path,
    staging: &Path,
    replacements: &[String],
    removals: &[String],
) -> Result<()> {
    fs::create_dir_all(root)?;
    let backups = tempfile::tempdir_in(root)?;
    let mut saved = Vec::new();
    let mut published = Vec::new();
    let result = (|| -> Result<()> {
        let affected: HashSet<_> = replacements.iter().chain(removals).collect();
        for relative in affected {
            let original = path(root, relative)?;
            if original.exists() {
                ensure!(original.is_file(), "content.errors.conflict");
                let backup = path(backups.path(), relative)?;
                fs::create_dir_all(backup.parent().context("content.errors.path")?)?;
                fs::rename(original, backup)?;
                saved.push(relative.clone());
            }
        }
        for relative in replacements {
            let target = path(root, relative)?;
            fs::create_dir_all(target.parent().context("content.errors.path")?)?;
            fs::rename(path(staging, relative)?, target)?;
            published.push(relative.clone());
        }
        Ok(())
    })();
    if let Err(error) = result {
        rollback(root, backups, &published, &saved)?;
        return Err(error);
    }
    Ok(())
}

pub(super) fn rollback(
    root: &Path,
    backups: tempfile::TempDir,
    published: &[String],
    saved: &[String],
) -> Result<()> {
    let mut rollback_failed = false;
    for relative in published.iter().rev() {
        rollback_failed |= path(root, relative)
            .and_then(|target| fs::remove_file(target).map_err(Into::into))
            .is_err();
    }
    for relative in saved.iter().rev() {
        let restore = (|| -> Result<()> {
            fs::rename(path(backups.path(), relative)?, path(root, relative)?)?;
            Ok(())
        })();
        rollback_failed |= restore.is_err();
    }
    if rollback_failed {
        // A path-validation failure must preserve originals just like an I/O failure.
        let recovery = backups.keep();
        bail!("content.errors.recovery: {}", recovery.display());
    }
    Ok(())
}
