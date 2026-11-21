//! Resolve official Java packages and publish verified installations atomically.

use super::archive::extract_archive;
use super::{JavaInstallation, JavaPackage, download_supported, inspect, is_link};
use crate::{
    download::{Artifact, Checksum, DownloadEngine, DownloadError, DownloadProgress},
    network::NetworkOptions,
};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{env, fs, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

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

pub(super) fn validate_package(package: &JavaPackage) -> Result<()> {
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

pub(super) fn check_cancelled(cancellation: &CancellationToken) -> Result<()> {
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
