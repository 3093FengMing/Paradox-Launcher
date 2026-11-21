//! Independent UI suite persistence, revision CAS and exact-byte recovery.

mod assets;
mod canonical;
mod model;
mod paths;
mod storage;
mod validation;
pub use model::{
    ParentSnapshot, RecoveryInspection, RecoveryToken, UiFile, UiSuiteBundle, UiSuiteLibrary,
    UiSuiteRecord,
};
pub use storage::UiSuiteStore;

/// Raw bytes are base64 only at the dedicated IPC boundary.
pub fn encode_recoverable_bytes(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests;
