//! Instance-local paths, registry, mod toggles and content removal transactions.
use super::*;

pub fn root(settings: &Settings, profile: &GameProfile) -> Result<PathBuf> {
    let settings = profile.effective_settings(settings)?;
    let root = settings
        .game_directory
        .join("versions")
        .join(&profile.instance_key);
    let mut path = settings.game_directory.clone();
    for part in ["versions", &profile.instance_key] {
        path.push(part);
        reject_link(&path)?;
    }
    Ok(root)
}
fn reject_link(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            let linked = metadata.file_type().is_symlink();
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                linked || metadata.file_attributes() & 0x400 != 0
            };
            ensure!(!linked, "content.errors.path");
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}
pub fn path(root: &Path, relative: &str) -> Result<PathBuf> {
    ensure!(
        !relative.is_empty() && !relative.contains('\\'),
        "content.errors.path"
    );
    let mut result = root.to_owned();
    reject_link(root)?;
    for component in Path::new(relative).components() {
        let Component::Normal(part) = component else {
            bail!("content.errors.path");
        };
        crate::model::validate_instance_key(part.to_str().context("content.errors.path")?)?;
        result.push(part);
        reject_link(&result)?;
    }
    Ok(result)
}
pub fn registry(root: &Path) -> Result<BTreeMap<String, ContentRecord>> {
    let file = path(root, REGISTRY)?;
    if !file.exists() {
        return Ok(BTreeMap::new());
    }
    ensure!(
        file.metadata()?.len() <= MAX_REGISTRY_BYTES as u64,
        "content.errors.registry"
    );
    serde_json::from_slice(&fs::read(file)?).map_err(|_| anyhow::anyhow!("content.errors.registry"))
}
pub(super) fn registry_bytes(records: &BTreeMap<String, ContentRecord>) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec_pretty(records)?;
    ensure!(bytes.len() <= MAX_REGISTRY_BYTES, "content.errors.registry");
    Ok(bytes)
}
pub fn list(
    settings: &Settings,
    profile: &GameProfile,
    category: &str,
) -> Result<Vec<ContentEntry>> {
    ensure!(
        matches!(category, "mods" | "resourcepacks" | "shaderpacks" | "saves"),
        "content.errors.category"
    );
    let root = root(settings, profile)?;
    let records = registry(&root)?;
    let directory = path(&root, category)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory)?.take(4096) {
        let entry = entry?;
        reject_link(&entry.path())?;
        let metadata = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        crate::model::validate_instance_key(&name)?;
        entries.push(ContentEntry {
            record: records.get(&format!("{category}/{name}")).cloned(),
            enabled: !name.ends_with(".disabled"),
            name,
            category: category.into(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}
pub fn toggle(settings: &Settings, profile: &GameProfile, name: &str) -> Result<()> {
    toggle_with_staging(settings, profile, name, |root, records| {
        let stage = tempfile::tempdir_in(root)?;
        fs::write(stage.path().join(REGISTRY), registry_bytes(records)?)?;
        Ok(stage)
    })
}

pub(super) fn toggle_with_staging(
    settings: &Settings,
    profile: &GameProfile,
    name: &str,
    stage_registry: impl FnOnce(&Path, &BTreeMap<String, ContentRecord>) -> Result<tempfile::TempDir>,
) -> Result<()> {
    crate::model::validate_instance_key(name)?;
    ensure!(
        name.ends_with(".jar") || name.ends_with(".jar.disabled"),
        "content.errors.category"
    );
    let root = root(settings, profile)?;
    let from = format!("mods/{name}");
    let to = format!(
        "mods/{}",
        if let Some(name) = name.strip_suffix(".disabled") {
            name.to_owned()
        } else {
            format!("{name}.disabled")
        }
    );
    ensure!(!path(&root, &to)?.exists(), "content.errors.conflict");
    let mut records = registry(&root)?;
    if let Some(record) = records.remove(&from) {
        records.insert(to.clone(), record);
    }
    let stage = stage_registry(&root, &records)?;
    fs::rename(path(&root, &from)?, path(&root, &to)?)?;
    if let Err(error) = commit(&root, stage.path(), &[REGISTRY.into()], &[]) {
        if fs::rename(path(&root, &to)?, path(&root, &from)?).is_err() {
            bail!("content.errors.recovery: {}", root.join(&to).display());
        }
        return Err(error);
    }
    Ok(())
}
pub fn remove(
    settings: &Settings,
    profile: &GameProfile,
    category: &str,
    name: &str,
) -> Result<()> {
    ensure!(
        matches!(category, "mods" | "resourcepacks" | "shaderpacks"),
        "content.errors.category"
    );
    crate::model::validate_instance_key(name)?;
    let root = root(settings, profile)?;
    let relative = format!("{category}/{name}");
    ensure!(path(&root, &relative)?.is_file(), "content.errors.path");
    let mut records = registry(&root)?;
    records.remove(&relative);
    let stage = tempfile::tempdir_in(&root)?;
    fs::write(stage.path().join(REGISTRY), registry_bytes(&records)?)?;
    commit(&root, stage.path(), &[REGISTRY.into()], &[relative])
}
pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha1::new();
    let mut bytes = [0; 65536];
    loop {
        let length = file.read(&mut bytes)?;
        if length == 0 {
            break;
        }
        digest.update(&bytes[..length]);
    }
    Ok(hex::encode(digest.finalize()))
}
