//! Dependency resolution and staged replacement of compatible content.
use super::*;

pub async fn install(
    settings: &Settings,
    profile: &GameProfile,
    project: &str,
    category: &str,
    cancellation: CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<()> {
    ensure!(
        matches!(category, "mod" | "resourcepack" | "shader"),
        "content.errors.category"
    );
    ensure!(
        category != "mod" || profile.loader != "vanilla",
        "content.errors.compatibility"
    );
    let mut pending = VecDeque::from([latest(settings, project, profile, category).await?]);
    let mut seen = HashSet::new();
    let mut projects = BTreeMap::new();
    let mut plan = Vec::new();
    while let Some(version) = pending.pop_front() {
        if cancellation.is_cancelled() {
            return Err(crate::download::DownloadError::Cancelled.into());
        }
        if !seen.insert(version.id.clone()) {
            continue;
        }
        ensure!(
            seen.len() <= 64 && compatible(&version, profile, category),
            "content.errors.dependencies"
        );
        ensure!(
            projects
                .insert(version.project_id.clone(), version.id.clone())
                .is_none(),
            "content.errors.dependencies"
        );
        for dependency in &version.dependencies {
            if dependency.dependency_type == "required" {
                let dependency = if let Some(id) = &dependency.version_id {
                    identifier(id)?;
                    json(settings, &format!("version/{id}")).await?
                } else if let Some(id) = &dependency.project_id {
                    latest(settings, id, profile, category).await?
                } else {
                    bail!("content.errors.dependencies");
                };
                pending.push_back(dependency);
            }
        }
        let file = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .context("content.errors.response")?
            .clone();
        validate_remote(&file)?;
        ensure!(
            if category == "mod" {
                file.filename.ends_with(".jar")
            } else {
                file.filename.ends_with(".zip")
            },
            "content.errors.category"
        );
        plan.push((version, file));
    }
    install_files(settings, profile, category, plan, cancellation, progress).await
}

// Apply an already resolved, validated remote plan to the instance in one transaction.
pub(super) async fn install_files(
    settings: &Settings,
    profile: &GameProfile,
    category: &str,
    plan: Vec<(Version, RemoteFile)>,
    cancellation: CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<()> {
    let directory = match category {
        "mod" => "mods",
        "resourcepack" => "resourcepacks",
        _ => "shaderpacks",
    };
    let root = root(settings, profile)?;
    fs::create_dir_all(&root)?;
    let installed_records = registry(&root)?;
    let mut records = installed_records.clone();
    let stage = tempfile::tempdir_in(&root)?;
    let mut artifacts = Vec::new();
    let mut paths = Vec::new();
    let mut remove = Vec::new();
    let mut targets = HashSet::new();
    for (version, file) in plan {
        let previous: Vec<_> = installed_records
            .iter()
            .filter(|(_, r)| r.project_id == version.project_id)
            .map(|(p, _)| p.clone())
            .collect();
        let mut disabled = false;
        for previous in &previous {
            let existing = path(&root, previous)?;
            disabled |= category == "mod"
                && previous.starts_with("mods/")
                && previous.ends_with(".jar.disabled")
                && existing.is_file();
        }
        let suffix = if disabled { ".disabled" } else { "" };
        let relative = format!("{directory}/{}{suffix}", file.filename);
        ensure!(targets.insert(relative.clone()), "content.errors.conflict");
        ensure!(
            installed_records
                .get(&relative)
                .is_none_or(|r| r.project_id == version.project_id),
            "content.errors.conflict"
        );
        let target = path(&root, &relative)?;
        let hash = file.hashes["sha1"].clone();
        let reuse = if target.exists() {
            ensure!(target.is_file(), "content.errors.conflict");
            let matches = target.metadata()?.len() == file.size
                && hash_file(&target)?.eq_ignore_ascii_case(&hash);
            ensure!(
                matches || installed_records.contains_key(&relative),
                "content.errors.conflict"
            );
            matches
        } else {
            false
        };
        for previous in previous {
            if previous != relative {
                remove.push(previous.clone());
                records.remove(&previous);
            }
        }
        if !reuse {
            artifacts.push(Artifact {
                url: file.url.clone(),
                target: stage.path().join(&relative),
                expected_size: Some(file.size),
                checksum: Some(Checksum::Sha1(hash.clone())),
            });
            paths.push(relative.clone());
        }
        records.insert(
            relative.clone(),
            ContentRecord {
                project_id: version.project_id,
                version_id: version.id,
                title: version.name,
                url: file.url,
                sha1: hash,
                size: file.size,
            },
        );
    }
    DownloadEngine::new(settings.network.clone())?
        .download(artifacts, cancellation.clone(), progress)
        .await?;
    if cancellation.is_cancelled() {
        return Err(crate::download::DownloadError::Cancelled.into());
    }
    fs::write(stage.path().join(REGISTRY), registry_bytes(&records)?)?;
    paths.push(REGISTRY.into());
    commit(&root, stage.path(), &paths, &remove)
}
