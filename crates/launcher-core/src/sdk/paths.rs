//! Translate checked filesystem paths into the syntax accepted by Java.
use std::path::{Path, PathBuf};

/// Java's classpath/JAR readers do not accept Windows verbatim prefixes.
/// Resolve filesystem boundaries with the original path, then give SDK Java
/// operations the equivalent conventional drive or UNC path.
pub(crate) fn java_compatible_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(drive) = value.strip_prefix(r"\\?\")
            && drive.as_bytes().get(1..3) == Some(b":\\")
            && drive
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
        {
            return PathBuf::from(drive);
        }
    }
    path.to_owned()
}
