//! UI-suite file storage, revision compare-and-swap, and exact-byte recovery.
use super::{RecoveryInspection, RecoveryToken, UiSuiteLibrary, canonical, model, validation};
use anyhow::{Context, Result, ensure};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Exactly one application-owned store; no business configuration lock is used.
#[derive(Debug)]
pub struct UiSuiteStore {
    path: PathBuf,
    gate: Mutex<()>,
    #[cfg(test)]
    pub(super) fault: std::sync::atomic::AtomicU8,
}
impl UiSuiteStore {
    pub fn new(config_path: &Path) -> Self {
        let namespace = canonical::hash(config_path.to_string_lossy().as_bytes());
        Self {
            path: config_path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new("."))
                .join(format!("ui-suite-library-{namespace}.json")),
            gate: Mutex::new(()),
            #[cfg(test)]
            fault: std::sync::atomic::AtomicU8::new(0),
        }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.gate
            .lock()
            .map_err(|_| anyhow::anyhow!("UI suite store lock unavailable"))
    }
    pub(super) fn parse(bytes: &[u8]) -> Result<UiSuiteLibrary> {
        ensure!(bytes.len() <= model::LIBRARY, "Suite library exceeds limit");
        // Parse to the same JSON value domain as the host before strict typed validation.
        let value: serde_json::Value = serde_json::from_slice(bytes)?;
        canonical::canonical(&value)?;
        let library: UiSuiteLibrary = serde_json::from_value(value)?;
        validation::library(&library)?;
        Ok(library)
    }
    fn current(&self) -> Result<UiSuiteLibrary> {
        let file = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(UiSuiteLibrary::default());
            }
            Err(e) => return Err(e).context("Read UI suite library"),
        };
        let mut raw = Vec::new();
        file.take((model::LIBRARY + 1) as u64)
            .read_to_end(&mut raw)?;
        Self::parse(&raw)
    }
    pub fn load(&self) -> Result<UiSuiteLibrary> {
        let _guard = self.lock()?;
        self.current()
    }
    pub fn save(&self, library: &UiSuiteLibrary, expected_revision: u64) -> Result<UiSuiteLibrary> {
        validation::library(library)?;
        let _guard = self.lock()?;
        let current = self.current()?;
        Self::compare(&current, expected_revision)?;
        let mut committed = library.clone();
        committed.revision = current.revision + 1;
        validation::library(&committed)?;
        self.write(&canonical::canonical(&committed)?)?;
        Ok(committed)
    }
    fn compare(current: &UiSuiteLibrary, expected: u64) -> Result<()> {
        ensure!(
            expected <= model::MAX_SAFE && current.revision == expected,
            "UI suite revision conflict"
        );
        ensure!(
            current.revision < model::MAX_SAFE,
            "UI suite revision overflow"
        );
        Ok(())
    }
    pub fn reset(&self, expected_revision: u64) -> Result<UiSuiteLibrary> {
        let _guard = self.lock()?;
        let current = self.current()?;
        Self::compare(&current, expected_revision)?;
        let reset = UiSuiteLibrary {
            revision: current.revision + 1,
            ..UiSuiteLibrary::default()
        };
        self.backup()?;
        self.write(&canonical::canonical(&reset)?)?;
        Ok(reset)
    }
    fn raw(&self) -> Result<Option<Vec<u8>>> {
        match fs::read(&self.path) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e).context("Read recoverable UI suite bytes"),
        }
    }
    pub fn read_recoverable(&self) -> Result<Vec<u8>> {
        let _guard = self.lock()?;
        Ok(self.raw()?.unwrap_or_default())
    }
    pub fn inspect_recovery(&self) -> Result<RecoveryInspection> {
        let _guard = self.lock()?;
        let raw = self.raw()?;
        let token = match &raw {
            None => RecoveryToken::Missing,
            Some(b) => RecoveryToken::Raw {
                sha256: canonical::hash(b),
            },
        };
        Ok(RecoveryInspection {
            raw: raw.unwrap_or_default(),
            token,
        })
    }
    pub fn reset_recoverable(&self, expected_token: &RecoveryToken) -> Result<UiSuiteLibrary> {
        let _guard = self.lock()?;
        let raw = self.raw()?;
        let actual = match &raw {
            None => RecoveryToken::Missing,
            Some(b) => {
                ensure!(
                    Self::parse(b).is_err(),
                    "Valid UI suite library requires revision reset"
                );
                RecoveryToken::Raw {
                    sha256: canonical::hash(b),
                }
            }
        };
        ensure!(
            &actual == expected_token,
            "UI suite recovery token conflict"
        );
        let reset = UiSuiteLibrary {
            revision: 1,
            ..UiSuiteLibrary::default()
        };
        self.backup()?;
        self.write(&canonical::canonical(&reset)?)?;
        Ok(reset)
    }
    fn backup(&self) -> Result<()> {
        let mut original = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e).context("Open UI suite backup source"),
        };
        let parent = self.path.parent().unwrap_or(Path::new("."));
        let mut backup = tempfile::NamedTempFile::new_in(parent)?;
        std::io::copy(&mut original, &mut backup)?;
        backup.as_file().sync_all()?;
        #[cfg(test)]
        ensure!(
            self.fault.load(std::sync::atomic::Ordering::SeqCst) != 2,
            "Injected backup publication failure"
        );
        let name = format!(
            "{}.recovery-{}.json",
            self.path.file_stem().unwrap_or_default().to_string_lossy(),
            uuid::Uuid::new_v4()
        );
        backup.persist_noclobber(parent.join(name))?;
        Ok(())
    }
    fn write(&self, bytes: &[u8]) -> Result<()> {
        let parent = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(bytes)?;
        temporary.as_file().sync_all()?;
        #[cfg(test)]
        ensure!(
            self.fault.load(std::sync::atomic::Ordering::SeqCst) != 1,
            "Injected library publication failure"
        );
        temporary.persist(&self.path)?;
        Ok(())
    }
}
