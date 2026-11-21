//! Extract a Java ZIP only into fresh staging, with path and resource limits.

use super::{check_cancelled, java_executable};
use anyhow::{Context, Result, bail, ensure};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

const MAX_ARCHIVE_ENTRIES: usize = 20_000;
const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub(super) fn extract_archive(
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

pub(super) fn validate_archive_path(path: &Path) -> Result<()> {
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
