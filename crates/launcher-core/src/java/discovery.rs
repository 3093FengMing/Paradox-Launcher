//! Refresh candidate discovery without relying on the SDK process-wide cache.

use super::{
    JavaDiscovery, JavaDiscoveryWarning, JavaInstallation, download_supported, inspect,
    java_executable, matches_current_architecture,
};
use anyhow::{Context, Result};
use elemental::core::runtime::provider::default_providers;
use std::{
    collections::{HashSet, VecDeque},
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{sync::Semaphore, task::JoinSet};

const MAX_CANDIDATES: usize = 128;
const MAX_SEARCH_DIRECTORIES: usize = 512;
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(30);

/// Every call refreshes discovery; Elemental's process-wide distribution cache is not used.
pub async fn discover(configured: &[PathBuf], managed_root: &Path) -> Result<JavaDiscovery> {
    let candidates = collect_discovery_candidates(configured, managed_root).await;
    let (mut installations, warnings) = probe_discovery_candidates(candidates).await?;
    rank_discovered_installations(&mut installations);
    Ok(JavaDiscovery {
        installations,
        warnings,
        download_supported: download_supported(),
    })
}

pub(super) async fn collect_discovery_candidates(
    configured: &[PathBuf],
    managed_root: &Path,
) -> Vec<(PathBuf, String)> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for path in configured {
        add_candidate(path, "configured", &mut candidates, &mut seen);
    }
    collect_directory(managed_root, 2, "managed", &mut candidates, &mut seen).await;
    for provider in default_providers() {
        if let Ok(paths) = tokio::time::timeout(Duration::from_secs(3), provider.list()).await {
            for path in paths {
                add_candidate(&path, provider.name(), &mut candidates, &mut seen);
            }
        }
    }
    for variable in ["JAVA_HOME", "JDK_HOME"] {
        if let Some(path) = env::var_os(variable) {
            add_candidate(&PathBuf::from(path), variable, &mut candidates, &mut seen);
        }
    }
    if let Some(search_path) = env::var_os("PATH") {
        for directory in env::split_paths(&search_path) {
            let path = directory.join(format!("java{}", env::consts::EXE_SUFFIX));
            add_candidate(&path, "PATH", &mut candidates, &mut seen);
        }
    }
    for (directory, depth) in common_java_directories() {
        collect_directory(&directory, depth, "common", &mut candidates, &mut seen).await;
    }
    candidates
}

pub(super) async fn probe_discovery_candidates(
    candidates: Vec<(PathBuf, String)>,
) -> Result<(Vec<JavaInstallation>, Vec<JavaDiscoveryWarning>)> {
    let mut tasks = JoinSet::new();
    let permits = Arc::new(Semaphore::new(4));
    for (path, source) in candidates {
        let permits = Arc::clone(&permits);
        tasks.spawn(async move {
            let _permit = permits.acquire_owned().await?;
            let result = inspect(&path).await.map(|mut installation| {
                installation.source = source;
                installation
            });
            Ok::<_, anyhow::Error>((path, result))
        });
    }
    let deadline = Instant::now() + DISCOVERY_TIMEOUT;
    let mut installations = Vec::new();
    let mut warnings = Vec::new();
    while !tasks.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, tasks.join_next()).await {
            Ok(Some(Ok(Ok((_, Ok(installation)))))) => installations.push(installation),
            Ok(Some(Ok(Ok((path, Err(error)))))) => warnings.push(JavaDiscoveryWarning {
                path,
                message: format!("{error:#}"),
            }),
            Ok(Some(Ok(Err(error)))) => return Err(error),
            Ok(Some(Err(error))) => return Err(error).context("Java 检测工作线程失败"),
            Ok(None) => break,
            Err(_) => {
                tasks.abort_all();
                while tasks.join_next().await.is_some() {}
                warnings.push(JavaDiscoveryWarning {
                    path: PathBuf::new(),
                    message: "部分 Java 检测超过时间限制，可使用文件选择器手动指定".into(),
                });
                break;
            }
        }
    }
    Ok((installations, warnings))
}

pub(super) fn rank_discovered_installations(installations: &mut Vec<JavaInstallation>) {
    installations.sort_by(|left, right| {
        right
            .major_version
            .cmp(&left.major_version)
            .then_with(|| {
                matches_current_architecture(&right.architecture)
                    .cmp(&matches_current_architecture(&left.architecture))
            })
            .then_with(|| left.executable.cmp(&right.executable))
            .then_with(|| {
                discovery_source_rank(&left.source).cmp(&discovery_source_rank(&right.source))
            })
    });
    installations.dedup_by(|right, left| right.executable == left.executable);
}

pub(super) fn add_candidate(
    path: &Path,
    source: &str,
    candidates: &mut Vec<(PathBuf, String)>,
    seen: &mut HashSet<String>,
) {
    if candidates.len() >= MAX_CANDIDATES || !path.is_absolute() {
        return;
    }
    let Some(executable) = java_executable(path).and_then(|path| path.canonicalize().ok()) else {
        return;
    };
    let key = if cfg!(windows) {
        executable.to_string_lossy().to_ascii_lowercase()
    } else {
        executable.to_string_lossy().into_owned()
    };
    if seen.insert(key) {
        candidates.push((executable, source.into()));
    }
}

pub(super) async fn collect_directory(
    root: &Path,
    max_depth: u8,
    source: &str,
    candidates: &mut Vec<(PathBuf, String)>,
    seen: &mut HashSet<String>,
) {
    let mut pending = VecDeque::from([(root.to_owned(), 0_u8)]);
    let mut visited = 0;
    while let Some((directory, depth)) = pending.pop_front() {
        if candidates.len() >= MAX_CANDIDATES || visited >= MAX_SEARCH_DIRECTORIES {
            break;
        }
        visited += 1;
        add_candidate(&directory, source, candidates, seen);
        if depth >= max_depth {
            continue;
        }
        let Ok(mut entries) = tokio::fs::read_dir(&directory).await else {
            continue;
        };
        let mut children = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            if children.len() >= MAX_SEARCH_DIRECTORIES {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || matches!(name.as_str(), "bin" | "lib" | "legal" | "include")
            {
                continue;
            }
            if entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
                children.push(entry.path());
            }
        }
        children.sort();
        pending.extend(children.into_iter().map(|path| (path, depth + 1)));
    }
}

fn common_java_directories() -> Vec<(PathBuf, u8)> {
    let mut directories = Vec::new();
    #[cfg(windows)]
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(directory) = env::var_os(variable) {
            let directory = PathBuf::from(directory);
            for vendor in [
                "Java",
                "Zulu",
                "Eclipse Adoptium",
                "AdoptOpenJDK",
                "Microsoft",
                "BellSoft",
                "Liberica",
            ] {
                directories.push((directory.join(vendor), 2));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        directories.push((PathBuf::from("/usr/lib/jvm"), 2));
        directories.push((PathBuf::from("/opt/java"), 2));
    }
    #[cfg(target_os = "macos")]
    directories.push((PathBuf::from("/Library/Java/JavaVirtualMachines"), 3));
    if let Some(directory) = dirs::home_dir() {
        directories.push((directory.join(".jdks"), 2));
        directories.push((directory.join(".sdkman/candidates/java"), 2));
    }
    directories
}

fn discovery_source_rank(source: &str) -> u8 {
    match source {
        "configured" => 0,
        "managed" => 1,
        "Registry" | "JavaHome" | "JAVA_HOME" | "JDK_HOME" => 2,
        "common" => 3,
        _ => 4,
    }
}
