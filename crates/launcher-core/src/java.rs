use std::{
    collections::{HashSet, VecDeque},
    env,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail, ensure};
use elemental::core::runtime::provider::default_providers;
use serde::{Deserialize, Serialize};
use tokio::{process::Command, sync::Semaphore, task::JoinSet};
use tokio_util::sync::CancellationToken;

use crate::{
    download::{Artifact, Checksum, DownloadEngine, DownloadError, DownloadProgress},
    network::NetworkOptions,
};

const MAX_CANDIDATES: usize = 128;
const MAX_SEARCH_DIRECTORIES: usize = 512;
const INSPECTION_TIMEOUT: Duration = Duration::from_secs(6);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ARCHIVE_ENTRIES: usize = 20_000;
const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JavaInstallation {
    pub executable: PathBuf,
    pub java_home: PathBuf,
    pub major_version: u32,
    pub version: String,
    pub vendor: String,
    pub architecture: String,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JavaDiscoveryWarning {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JavaDiscovery {
    pub installations: Vec<JavaInstallation>,
    pub warnings: Vec<JavaDiscoveryWarning>,
    pub download_supported: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JavaPackage {
    pub major_version: u32,
    pub version: String,
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
    version: AdoptiumVersion,
}

#[derive(Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(Deserialize)]
struct AdoptiumPackage {
    name: String,
    link: String,
    checksum: String,
    size: u64,
}

#[derive(Deserialize)]
struct AdoptiumVersion {
    major: u32,
    openjdk_version: String,
}

#[derive(Deserialize)]
struct InstanceRuntimeMetadata {
    #[serde(default, rename = "javaVersion")]
    java_version: InstanceJavaVersion,
}

#[derive(Deserialize)]
struct InstanceJavaVersion {
    #[serde(rename = "majorVersion")]
    major_version: u32,
}

impl Default for InstanceJavaVersion {
    fn default() -> Self {
        Self { major_version: 8 }
    }
}

/// Read the actual installed version's requirement, including Java 8 for older metadata.
pub fn required_java_major_version(instance_root: &Path) -> Result<u32> {
    let instance_name = instance_root
        .file_name()
        .and_then(|name| name.to_str())
        .context("实例目录名称无效")?;
    let metadata_path = instance_root.join(format!("{instance_name}.json"));
    ensure!(
        fs::metadata(&metadata_path)
            .context("无法读取实例版本信息")?
            .len()
            <= 16 * 1024 * 1024,
        "实例版本信息文件过大"
    );
    let metadata: InstanceRuntimeMetadata = serde_json::from_reader(File::open(&metadata_path)?)
        .context("实例 Java 版本信息无效，请安装 / 修复实例")?;
    let required = metadata.java_version.major_version;
    ensure!((1..=99).contains(&required), "实例要求的 Java 主版本无效");
    Ok(required)
}

/// Inspect the executable itself rather than trusting a possibly stale release file.
pub async fn inspect(path: &Path) -> Result<JavaInstallation> {
    ensure!(path.is_absolute(), "Java 路径必须是绝对路径");
    let executable = java_executable(path)
        .context("请选择 Java 安装目录或 bin 目录中的 java / javaw 可执行文件")?
        .canonicalize()
        .context("无法解析 Java 路径")?;
    let probe = if executable
        .file_stem()
        .is_some_and(|stem| stem.to_string_lossy().eq_ignore_ascii_case("javaw"))
    {
        let console = executable.with_file_name(format!("java{}", env::consts::EXE_SUFFIX));
        ensure!(
            console.is_file(),
            "检测 javaw 时需要同目录的 java 可执行文件"
        );
        console
    } else {
        executable.clone()
    };
    let mut command = Command::new(probe);
    // Java 8/17 and newer releases use different stream encoding properties.
    // Set both so Windows paths containing non-ASCII text survive the probe.
    command
        .args([
            "-Dfile.encoding=UTF-8",
            "-Dstdout.encoding=UTF-8",
            "-Dstderr.encoding=UTF-8",
            "-Dsun.stdout.encoding=UTF-8",
            "-Dsun.stderr.encoding=UTF-8",
            "-XshowSettings:properties",
            "-version",
        ])
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let output = tokio::time::timeout(INSPECTION_TIMEOUT, command.output())
        .await
        .context("Java 检测超时")?
        .context("无法运行 Java 检测命令")?;
    ensure!(
        output.status.success(),
        "Java 检测命令失败：{}",
        output.status
    );
    let properties = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let version = property(&properties, "java.version").context("无法读取 Java 版本")?;
    let major_version = property(&properties, "java.specification.version")
        .as_deref()
        .and_then(parse_major_version)
        .or_else(|| parse_major_version(&version))
        .context("无法识别 Java 主版本")?;
    let java_home = property(&properties, "java.home")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            executable
                .parent()
                .and_then(Path::parent)
                .map(Path::to_owned)
        })
        .context("Java 可执行文件没有有效的安装目录")?
        .canonicalize()
        .context("无法解析 Java 安装目录")?;
    // Oracle's PATH entries may be launcher shims outside a bin directory.
    // Resolve java.home so Elemental receives an executable in the real runtime.
    let runtime_executable = java_home
        .join("bin")
        .join(executable.file_name().context("Java 可执行文件名称无效")?);
    let executable = if runtime_executable.is_file() {
        runtime_executable
            .canonicalize()
            .context("无法解析 Java 可执行文件")?
    } else {
        executable
    };
    Ok(JavaInstallation {
        executable,
        java_home,
        major_version,
        version,
        vendor: property(&properties, "java.vendor")
            .or_else(|| property(&properties, "java.vm.vendor"))
            .unwrap_or_else(|| "未知厂商".into()),
        architecture: property(&properties, "os.arch").unwrap_or_else(|| "未知架构".into()),
        source: "manual".into(),
    })
}

/// Every call refreshes discovery; Elemental's process-wide distribution cache is not used.
pub async fn discover(configured: &[PathBuf], managed_root: &Path) -> Result<JavaDiscovery> {
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
    Ok(JavaDiscovery {
        installations,
        warnings,
        download_supported: download_supported(),
    })
}

pub async fn select_runtime(
    required_major: u32,
    configured: Option<&Path>,
    managed_root: &Path,
) -> Result<JavaInstallation> {
    if let Some(path) = configured {
        let installation = inspect(path).await?;
        ensure!(
            installation.major_version == required_major,
            "所选 Java 为 {}，此实例需要 Java {}：{}",
            installation.major_version,
            required_major,
            installation.executable.display()
        );
        ensure!(
            matches_current_architecture(&installation.architecture),
            "所选 Java 架构为 {}，此启动器需要 {} 运行时",
            installation.architecture,
            env::consts::ARCH
        );
        return Ok(installation);
    }
    discover(&[], managed_root)
        .await?
        .installations
        .into_iter()
        .find(|installation| {
            installation.major_version == required_major
                && matches_current_architecture(&installation.architecture)
        })
        .with_context(|| format!("未找到 Java {required_major}，请检测本地 Java 或下载兼容版本"))
}

pub fn download_supported() -> bool {
    cfg!(target_os = "windows") && matches!(env::consts::ARCH, "x86_64" | "aarch64")
}

pub async fn resolve_package(major: u32, options: &NetworkOptions) -> Result<JavaPackage> {
    ensure!(
        download_supported(),
        "当前 Java 自动下载支持 Windows x64 / ARM64"
    );
    ensure!((8..=99).contains(&major), "Java 下载版本无效");
    let architecture = if env::consts::ARCH == "aarch64" {
        "aarch64"
    } else {
        "x64"
    };
    let client = options.build_client()?;
    let mut url = reqwest::Url::parse(&format!(
        "https://api.adoptium.net/v3/assets/latest/{major}/hotspot"
    ))?;
    url.query_pairs_mut().extend_pairs([
        ("architecture", architecture),
        ("image_type", "jre"),
        ("os", "windows"),
        ("vendor", "eclipse"),
    ]);
    let assets: Vec<AdoptiumAsset> = client
        .get(url)
        .timeout(Duration::from_secs(options.timeout_seconds.into()))
        .send()
        .await
        .context("无法查询 Adoptium Java 下载信息")?
        .error_for_status()
        .context("Adoptium Java 下载信息请求失败")?
        .json()
        .await
        .context("Java 下载信息格式无效")?;
    let asset = assets
        .into_iter()
        .find(|asset| asset.version.major == major)
        .with_context(|| format!("没有适用于当前平台的 Java {major} JRE 下载"))?;
    let package = JavaPackage {
        major_version: asset.version.major,
        version: asset.version.openjdk_version,
        filename: asset.binary.package.name,
        url: asset.binary.package.link,
        sha256: asset.binary.package.checksum,
        size: asset.binary.package.size,
    };
    validate_package(&package)?;
    Ok(package)
}

/// Download is verified by the shared engine; extraction never writes outside a new staging dir.
pub async fn download_and_install(
    package: &JavaPackage,
    managed_root: &Path,
    options: NetworkOptions,
    cancellation: CancellationToken,
    on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<JavaInstallation> {
    ensure!(
        download_supported(),
        "当前 Java 自动下载支持 Windows x64 / ARM64"
    );
    validate_package(package)?;
    ensure!(managed_root.is_absolute(), "Java 存储目录必须是绝对路径");
    check_cancelled(&cancellation)?;
    fs::create_dir_all(managed_root).context("无法创建 Java 存储目录")?;
    let managed_root = managed_root
        .canonicalize()
        .context("无法解析 Java 存储目录")?;
    let directory_name = format!("java-{}-{}", package.major_version, &package.sha256[..16]);
    let destination = managed_root.join(&directory_name);
    if destination.exists() {
        ensure!(
            !is_link(&fs::symlink_metadata(&destination)?),
            "Java 安装目录不能是链接"
        );
        let mut installation = inspect(&destination).await?;
        ensure!(
            installation.major_version == package.major_version,
            "已有 Java 安装版本不匹配"
        );
        installation.source = "managed".into();
        return Ok(installation);
    }
    let archive_directory = managed_root.join(".archives");
    fs::create_dir_all(&archive_directory).context("无法创建 Java 下载缓存目录")?;
    ensure!(
        !is_link(&fs::symlink_metadata(&archive_directory)?),
        "Java 下载缓存目录不能是链接"
    );
    let archive = archive_directory.join(format!("{directory_name}.zip"));
    if let Ok(metadata) = fs::symlink_metadata(&archive) {
        ensure!(!is_link(&metadata), "Java 下载缓存文件不能是链接");
    }
    DownloadEngine::new(options)?
        .download(
            vec![Artifact {
                url: package.url.clone(),
                target: archive.clone(),
                expected_size: Some(package.size),
                checksum: Some(Checksum::Sha256(package.sha256.clone())),
            }],
            cancellation.clone(),
            on_progress,
        )
        .await
        .context("Java 下载失败")?;
    check_cancelled(&cancellation)?;
    let staging = tempfile::Builder::new()
        .prefix(".java-install-")
        .tempdir_in(&managed_root)
        .context("无法创建 Java 安装暂存目录")?;
    let extraction_cancellation = cancellation.clone();
    let (_staging, runtime_root) = tokio::task::spawn_blocking(move || {
        let runtime_root = extract_archive(&archive, staging.path(), &extraction_cancellation)?;
        Ok::<_, anyhow::Error>((staging, runtime_root))
    })
    .await
    .context("Java 解压工作线程失败")??;
    check_cancelled(&cancellation)?;
    let installation = inspect(&runtime_root)
        .await
        .context("下载后的 Java 检测失败")?;
    ensure!(
        installation.major_version == package.major_version,
        "下载后的 Java 版本为 {}，需要 {}",
        installation.major_version,
        package.major_version
    );
    let executable_relative = installation
        .executable
        .strip_prefix(&runtime_root)
        .context("Java 可执行文件不在暂存安装目录内")?;
    check_cancelled(&cancellation)?;
    publish_runtime(&runtime_root, &destination, &cancellation).await?;
    Ok(JavaInstallation {
        executable: destination.join(executable_relative),
        java_home: destination,
        source: "managed".into(),
        ..installation
    })
}

fn validate_package(package: &JavaPackage) -> Result<()> {
    ensure!(
        (8..=99).contains(&package.major_version),
        "Java 下载版本无效"
    );
    ensure!(
        package.sha256.len() == 64 && package.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "Java 下载校验和无效"
    );
    ensure!(
        (1..=1024 * 1024 * 1024).contains(&package.size),
        "Java 下载大小无效"
    );
    ensure!(
        package.filename.ends_with(".zip"),
        "Java 下载必须是 ZIP 文件"
    );
    let url = reqwest::Url::parse(&package.url).context("Java 下载地址无效")?;
    ensure!(
        url.scheme() == "https"
            && url.host_str() == Some("github.com")
            && url.username().is_empty()
            && url.password().is_none()
            && url.path().starts_with(&format!(
                "/adoptium/temurin{}-binaries/releases/download/",
                package.major_version
            )),
        "Java 下载地址必须来自 Adoptium 官方发行仓库"
    );
    Ok(())
}

fn check_cancelled(cancellation: &CancellationToken) -> Result<()> {
    if cancellation.is_cancelled() {
        return Err(DownloadError::Cancelled.into());
    }
    Ok(())
}

async fn publish_runtime(
    source: &Path,
    destination: &Path,
    cancellation: &CancellationToken,
) -> Result<()> {
    // Windows may briefly retain executable mappings or scan a newly extracted
    // runtime after the version probe exits. Retry only sharing/access failures.
    for attempt in 0..=20 {
        check_cancelled(cancellation)?;
        match fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(error)
                if cfg!(windows)
                    && matches!(error.raw_os_error(), Some(5 | 32 | 33))
                    && attempt < 20 =>
            {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            Err(error) => return Err(error).context("无法发布 Java 安装目录"),
        }
    }
    unreachable!("last publication attempt returns its result")
}

fn extract_archive(
    archive: &Path,
    destination: &Path,
    cancellation: &CancellationToken,
) -> Result<PathBuf> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?).context("无法读取 Java ZIP 文件")?;
    ensure!(
        zip.len() <= MAX_ARCHIVE_ENTRIES,
        "Java ZIP 文件数量超出限制"
    );
    let mut bytes_written = 0_u64;
    for index in 0..zip.len() {
        check_cancelled(cancellation)?;
        let mut entry = zip.by_index(index)?;
        let entry_name = entry.name()?;
        validate_archive_path(Path::new(entry_name.as_ref()))?;
        let relative = entry.enclosed_name().context("Java ZIP 包含不安全路径")?;
        ensure!(
            entry
                .unix_mode()
                .is_none_or(|mode| matches!(mode & 0o170000, 0 | 0o040000 | 0o100000)),
            "Java ZIP 只允许普通文件和目录"
        );
        ensure!(
            bytes_written.saturating_add(entry.size()) <= MAX_EXTRACTED_BYTES,
            "Java ZIP 解压大小超出限制"
        );
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        fs::create_dir_all(target.parent().context("Java ZIP 路径没有父目录")?)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            check_cancelled(cancellation)?;
            let count = entry.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            bytes_written = bytes_written.saturating_add(count as u64);
            ensure!(
                bytes_written <= MAX_EXTRACTED_BYTES,
                "Java ZIP 解压大小超出限制"
            );
            output.write_all(&buffer[..count])?;
        }
        output.sync_all()?;
    }
    check_cancelled(cancellation)?;
    find_extracted_runtime(destination)
}

fn find_extracted_runtime(destination: &Path) -> Result<PathBuf> {
    if java_executable(destination).is_some() {
        return Ok(destination.to_owned());
    }
    let mut roots = Vec::new();
    for entry in fs::read_dir(destination)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() && java_executable(&entry.path()).is_some() {
            roots.push(entry.path());
        }
    }
    ensure!(
        roots.len() == 1,
        "Java ZIP 必须包含一个完整的 Java 安装目录"
    );
    Ok(roots.remove(0))
}

fn validate_archive_path(path: &Path) -> Result<()> {
    ensure!(!path.as_os_str().is_empty(), "Java ZIP 路径不能为空");
    ensure!(
        !path.to_string_lossy().contains('\\'),
        "Java ZIP 路径必须使用标准分隔符"
    );
    for component in path.components() {
        let Component::Normal(name) = component else {
            bail!("Java ZIP 包含不安全路径");
        };
        let name = name.to_string_lossy();
        ensure!(
            !name.contains(['\\', ':', '\0']) && !name.ends_with(['.', ' ']),
            "Java ZIP 包含不安全文件名"
        );
        let stem = name
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        ensure!(
            !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9')),
            "Java ZIP 包含系统保留文件名"
        );
    }
    Ok(())
}

fn java_executable(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        let stem = path.file_stem()?.to_string_lossy();
        return (stem.eq_ignore_ascii_case("java") || stem.eq_ignore_ascii_case("javaw"))
            .then(|| path.to_owned());
    }
    for root in [path.to_owned(), path.join("Contents/Home")] {
        let executable = root
            .join("bin")
            .join(format!("java{}", env::consts::EXE_SUFFIX));
        if executable.is_file() {
            return Some(executable);
        }
    }
    None
}

fn add_candidate(
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

async fn collect_directory(
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

fn property(properties: &str, key: &str) -> Option<String> {
    properties.lines().find_map(|line| {
        let (name, value) = line.trim().split_once('=')?;
        (name.trim() == key).then(|| value.trim().to_owned())
    })
}

fn parse_major_version(version: &str) -> Option<u32> {
    version
        .trim()
        .strip_prefix("1.")
        .unwrap_or(version.trim())
        .split(['.', '_', '-', '+'])
        .next()?
        .parse()
        .ok()
}

fn matches_current_architecture(architecture: &str) -> bool {
    let architecture = architecture.trim().to_ascii_lowercase();
    match env::consts::ARCH {
        "x86_64" => matches!(architecture.as_str(), "amd64" | "x86_64" | "x64"),
        "aarch64" => matches!(architecture.as_str(), "aarch64" | "arm64"),
        "x86" => matches!(
            architecture.as_str(),
            "x86" | "i386" | "i486" | "i586" | "i686"
        ),
        platform => architecture == platform,
    }
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

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    #[test]
    fn java_versions_and_properties_are_parsed_precisely() {
        for (version, expected) in [
            ("1.8.0_181", 8),
            ("17.0.2", 17),
            ("21.0.12+1-LTS", 21),
            ("26-ea", 26),
        ] {
            assert_eq!(parse_major_version(version), Some(expected));
        }
        assert_eq!(parse_major_version("invalid"), None);
        assert_eq!(
            property(
                " java.version = 21.0.1\n java.vm.version = 21.0.1+1",
                "java.version"
            ),
            Some("21.0.1".into())
        );
    }

    #[test]
    fn zip_paths_cannot_escape_or_address_windows_devices() {
        for path in [
            "../outside",
            "/outside",
            "C:/outside",
            "dir/../outside",
            "dir\\outside",
            "NUL.txt",
            "file:stream",
            "dir/COM1",
            "file.",
        ] {
            assert!(validate_archive_path(Path::new(path)).is_err(), "{path}");
        }
        assert!(validate_archive_path(Path::new("jdk/bin/java.exe")).is_ok());
    }

    #[test]
    fn installed_metadata_controls_java_compatibility() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("中文实例");
        fs::create_dir(&root).unwrap();
        let metadata = root.join("中文实例.json");
        fs::write(&metadata, br#"{"javaVersion":{"majorVersion":21}}"#).unwrap();
        assert_eq!(required_java_major_version(&root).unwrap(), 21);
        fs::write(&metadata, b"{}").unwrap();
        assert_eq!(required_java_major_version(&root).unwrap(), 8);
        for invalid in [
            br#"{"javaVersion":{"majorVersion":0}}"#.as_slice(),
            br#"{"javaVersion":{"majorVersion":"21"}}"#.as_slice(),
            br#"{"javaVersion":null}"#.as_slice(),
            b"{invalid}".as_slice(),
        ] {
            fs::write(&metadata, invalid).unwrap();
            assert!(required_java_major_version(&root).is_err());
        }
    }

    #[test]
    fn malicious_zip_entries_never_create_outside_files() {
        for symlink in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let archive = directory.path().join("malicious.zip");
            let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
            if symlink {
                writer
                    .add_symlink("link", "../outside", SimpleFileOptions::default())
                    .unwrap();
            } else {
                writer
                    .start_file("../outside", SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(b"unexpected").unwrap();
            }
            writer.finish().unwrap();
            let staging = directory.path().join("staging");
            fs::create_dir(&staging).unwrap();
            assert!(extract_archive(&archive, &staging, &CancellationToken::new()).is_err());
            assert!(!directory.path().join("outside").exists());
            assert_eq!(fs::read_dir(staging).unwrap().count(), 0);
        }
    }

    #[test]
    fn archive_extracts_only_inside_staging_and_respects_cancellation() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("runtime.zip");
        let file = File::create(&archive).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                format!("jdk/bin/java{}", env::consts::EXE_SUFFIX),
                SimpleFileOptions::default(),
            )
            .unwrap();
        writer.write_all(b"placeholder executable").unwrap();
        writer.finish().unwrap();
        let staging = directory.path().join("staging");
        fs::create_dir(&staging).unwrap();
        let cancellation = CancellationToken::new();
        assert_eq!(
            extract_archive(&archive, &staging, &cancellation).unwrap(),
            staging.join("jdk")
        );
        let cancelled_staging = directory.path().join("cancelled");
        fs::create_dir(&cancelled_staging).unwrap();
        cancellation.cancel();
        assert!(extract_archive(&archive, &cancelled_staging, &cancellation).is_err());
        assert_eq!(fs::read_dir(cancelled_staging).unwrap().count(), 0);
    }

    #[test]
    fn untrusted_java_package_urls_are_rejected() {
        let mut package = JavaPackage {
            major_version: 21,
            version: "21.0.1".into(),
            filename: "runtime.zip".into(),
            url: "https://github.com/adoptium/temurin21-binaries/releases/download/v1/runtime.zip"
                .into(),
            sha256: "a".repeat(64),
            size: 1024,
        };
        assert!(validate_package(&package).is_ok());
        for url in [
            "http://github.com/adoptium/temurin21-binaries/releases/download/v1/runtime.zip",
            "https://github.com/other/runtime.zip",
            "https://example.com/runtime.zip",
            "https://user:secret@github.com/adoptium/temurin21-binaries/releases/download/v1/runtime.zip",
        ] {
            package.url = url.into();
            assert!(validate_package(&package).is_err(), "{url}");
        }
    }
}
