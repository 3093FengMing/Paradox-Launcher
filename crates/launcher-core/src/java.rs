//! Probe Java executables and enforce the runtime selected for an instance.

mod archive;
mod discovery;
mod installation;

pub use discovery::discover;
use installation::check_cancelled;
pub use installation::{download_and_install, resolve_package};

use std::{
    env,
    fs::{self, File},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

const INSPECTION_TIMEOUT: Duration = Duration::from_secs(6);

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
    let output = crate::process::probe_output(command, INSPECTION_TIMEOUT).await?;
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
    // The selected executable may be javaw or a wrapper outside java.home.
    // Upstream runtime resolution receives the installation root separately;
    // the application must retain this exact executable for game creation.
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

pub(crate) fn matches_current_architecture(architecture: &str) -> bool {
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
mod tests;
