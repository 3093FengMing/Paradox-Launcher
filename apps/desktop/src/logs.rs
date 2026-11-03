use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{Context, Result};
use serde::{Deserialize, Deserializer, Serialize};

const ROTATE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;
const MAX_RECORDS: usize = 500;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LogIdentity {
    pub session: String,
    // JSON numbers cannot preserve every u64 value in a JavaScript client.
    #[serde(deserialize_with = "deserialize_sequence")]
    pub sequence: String,
}

fn deserialize_sequence<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    value
        .parse::<u64>()
        .map(|sequence| sequence.to_string())
        .map_err(serde::de::Error::custom)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoredLog {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<LogIdentity>,
    pub level: String,
    pub message: String,
    pub time: u64,
}

struct LogState {
    session: String,
    sequence: u64,
}

pub struct LogStore {
    path: PathBuf,
    state: Mutex<LogState>,
}

impl LogStore {
    pub fn new(config_path: &Path) -> Self {
        Self {
            path: config_path.with_extension("logs.jsonl"),
            state: Mutex::new(LogState {
                session: uuid::Uuid::new_v4().to_string(),
                sequence: 0,
            }),
        }
    }

    pub fn record(&self, level: &str, message: &str, retain: bool) -> Result<StoredLog> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("日志锁不可用"))?;
        state.sequence = state.sequence.checked_add(1).context("日志序号已耗尽")?;
        let record = StoredLog {
            id: Some(LogIdentity {
                session: state.session.clone(),
                sequence: state.sequence.to_string(),
            }),
            level: level.into(),
            message: message.chars().take(16384).collect(),
            time: paradox_core::auth::now(),
        };
        // The same allocated record is emitted even if its optional disk write fails.
        if retain && let Err(error) = self.persist(&record) {
            tracing::warn!(%error, "Unable to persist launcher log");
        }
        Ok(record)
    }

    fn persist(&self, record: &StoredLog) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::metadata(&self.path).is_ok_and(|metadata| metadata.len() > ROTATE_BYTES) {
            let previous = self.path.with_extension("previous.jsonl");
            if previous.try_exists()? {
                fs::remove_file(&previous)?;
            }
            fs::rename(&self.path, previous)?;
        }
        let mut file = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&self.path)?;
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
        Ok(())
    }

    pub fn read(&self) -> Result<Vec<StoredLog>> {
        let _guard = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("日志锁不可用"))?;
        if !self.path.try_exists()? {
            return Ok(Vec::new());
        }
        anyhow::ensure!(
            self.path.metadata()?.len() <= MAX_READ_BYTES,
            "content.errors.size"
        );
        let text = fs::read_to_string(&self.path)?;
        let mut logs: Vec<StoredLog> = text
            .lines()
            .rev()
            .take(MAX_RECORDS)
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        logs.reverse();
        Ok(logs)
    }

    pub fn clear(&self) -> Result<LogIdentity> {
        let state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("日志锁不可用"))?;
        // Remove rotation first, so its failure leaves the current diagnostic log intact.
        for path in [&self.path.with_extension("previous.jsonl"), &self.path] {
            if path.try_exists()? {
                fs::remove_file(path)?;
            }
        }
        // Allocation, persistence and deletion share this lock. Every later record
        // therefore has a greater sequence, even before the clear IPC is acknowledged.
        Ok(LogIdentity {
            session: state.session.clone(),
            sequence: state.sequence.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier, mpsc};

    fn fixture() -> (tempfile::TempDir, LogStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = LogStore::new(&directory.path().join("launcher.json"));
        (directory, store)
    }

    #[test]
    fn persisted_record_has_a_serialized_identity_shared_with_its_live_event() {
        let (_directory, store) = fixture();
        let first = store.record("info", "same game output", true).unwrap();
        let second = store.record("info", "same game output", true).unwrap();
        let disk = store.read().unwrap();
        assert_eq!(disk, vec![first.clone(), second.clone()]);
        assert_ne!(first.id, second.id, "equal messages are distinct records");
        let json: serde_json::Value = serde_json::from_str(
            fs::read_to_string(&store.path)
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        assert!(
            json["id"].is_object(),
            "persisted records need the same identity as their live event"
        );
        assert_eq!(json["id"]["sequence"], "1");
        assert_eq!(second.id.unwrap().sequence, "2");
    }

    #[test]
    fn old_rows_without_identity_remain_separate_and_readable() {
        let (_directory, store) = fixture();
        let legacy = r#"{"level":"info","message":"same game output","time":1704067200}"#;
        fs::write(&store.path, format!("{legacy}\n{legacy}\n")).unwrap();
        let current = store.record("info", "same game output", true).unwrap();
        let disk = store.read().unwrap();
        assert_eq!(disk.len(), 3);
        assert!(disk[0].id.is_none());
        assert!(disk[1].id.is_none());
        assert_eq!(disk[2], current);
        assert_eq!(disk[0].time, 1_704_067_200);
    }

    #[test]
    fn disabled_retention_still_allocates_ordered_live_identities() {
        let (_directory, store) = fixture();
        let first = store.record("info", "not persisted", false).unwrap();
        let second = store.record("info", "also live", false).unwrap();
        assert!(!store.path.exists());
        assert!(store.read().unwrap().is_empty());
        let boundary = store.clear().unwrap();
        assert_eq!(boundary, second.id.unwrap());
        assert_eq!(first.id.unwrap().sequence, "1");
        assert_eq!(boundary.sequence, "2");
    }

    #[test]
    fn a_delayed_clear_acknowledgement_excludes_new_persisted_events() {
        let (_directory, store) = fixture();
        let store = Arc::new(store);
        let old = store.record("info", "old event", true).unwrap();
        let (cleared_tx, cleared_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker_store = Arc::clone(&store);
        let worker = std::thread::spawn(move || {
            let boundary = worker_store.clear().unwrap();
            cleared_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            boundary
        });
        cleared_rx.recv().unwrap();
        let new = store
            .record("info", "new event before clear acknowledgement", true)
            .unwrap();
        release_tx.send(()).unwrap();
        let boundary = worker.join().unwrap();
        assert_eq!(boundary, old.id.unwrap());
        assert_eq!(new.id.as_ref().unwrap().session, boundary.session);
        assert_eq!(new.id.as_ref().unwrap().sequence, "2");
        assert_eq!(store.read().unwrap(), vec![new]);
    }

    #[test]
    fn concurrent_writers_produce_complete_records_with_unique_ordered_ids() {
        let (_directory, store) = fixture();
        let store = Arc::new(store);
        let start = Arc::new(Barrier::new(5));
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let store = Arc::clone(&store);
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..20 {
                        store.record("info", "concurrent output", true).unwrap();
                        let snapshot = store.read().unwrap();
                        assert!(!snapshot.is_empty());
                    }
                })
            })
            .collect();
        start.wait();
        for worker in workers {
            worker.join().unwrap();
        }
        let disk = store.read().unwrap();
        assert_eq!(disk.len(), 80);
        for (index, record) in disk.into_iter().enumerate() {
            assert_eq!(record.id.unwrap().sequence, (index + 1).to_string());
        }
    }

    #[test]
    fn failing_clear_returns_no_boundary_and_retains_current_diagnostics() {
        let (_directory, store) = fixture();
        let old = store.record("info", "keep for retry", true).unwrap();
        fs::create_dir(store.path.with_extension("previous.jsonl")).unwrap();
        assert!(store.clear().is_err());
        assert_eq!(store.read().unwrap(), vec![old]);
        fs::remove_dir(store.path.with_extension("previous.jsonl")).unwrap();
        assert_eq!(store.clear().unwrap().sequence, "1");
        assert!(store.read().unwrap().is_empty());
    }

    #[test]
    fn storage_failure_still_returns_the_identified_live_record() {
        let directory = tempfile::tempdir().unwrap();
        let obstacle = directory.path().join("not-a-directory");
        fs::write(&obstacle, b"existing file").unwrap();
        let store = LogStore::new(&obstacle.join("launcher.json"));
        let live = store
            .record("error", "visible despite storage failure", true)
            .unwrap();
        assert_eq!(live.message, "visible despite storage failure");
        assert_eq!(live.id.unwrap().sequence, "1");
        assert_eq!(fs::read(obstacle).unwrap(), b"existing file");
    }

    #[test]
    fn new_process_sessions_do_not_reuse_previous_record_ids() {
        let (directory, first) = fixture();
        let old = first.record("info", "same game output", true).unwrap();
        let next = LogStore::new(&directory.path().join("launcher.json"));
        let new = next.record("info", "same game output", true).unwrap();
        assert_ne!(
            old.id.as_ref().unwrap().session,
            new.id.as_ref().unwrap().session
        );
        assert_eq!(
            old.id.as_ref().unwrap().sequence,
            new.id.as_ref().unwrap().sequence
        );
        assert_eq!(next.read().unwrap(), vec![old, new]);
    }

    #[test]
    fn history_keeps_the_latest_500_records() {
        let (_directory, store) = fixture();
        for i in 1..=510 {
            store.record("info", &i.to_string(), true).unwrap();
        }
        let records = store.read().unwrap();
        assert_eq!(records.len(), 500);
        assert_eq!(records[0].message, "11");
        assert_eq!(records[499].message, "510");
    }

    #[test]
    fn rotation_and_clear_remove_both_generations_of_disk_history() {
        let (_directory, store) = fixture();
        fs::write(&store.path, vec![b' '; ROTATE_BYTES as usize + 1]).unwrap();
        let current = store.record("info", "after rotation", true).unwrap();
        assert!(store.path.with_extension("previous.jsonl").exists());
        assert_eq!(store.read().unwrap(), vec![current]);
        store.clear().unwrap();
        assert!(!store.path.exists());
        assert!(!store.path.with_extension("previous.jsonl").exists());
    }

    #[test]
    fn sequence_serialization_preserves_values_beyond_javascript_integer_precision() {
        let (_directory, store) = fixture();
        store.state.lock().unwrap().sequence = 9_007_199_254_740_992;
        let record = store.record("info", "large sequence", true).unwrap();
        assert_eq!(record.id.as_ref().unwrap().sequence, "9007199254740993");
        assert_eq!(store.read().unwrap(), vec![record.clone()]);
        assert_eq!(store.clear().unwrap(), record.id.unwrap());
    }

    #[test]
    fn malformed_identified_rows_cannot_send_invalid_sequences_to_the_client() {
        let (_directory, store) = fixture();
        let legacy = r#"{"level":"info","message":"legacy retained","time":1704067200}"#;
        let invalid = r#"{"id":{"session":"session","sequence":"invalid"},"level":"info","message":"bad id","time":1704067200}"#;
        let overflow = invalid.replace("invalid", "18446744073709551616");
        fs::write(&store.path, format!("{legacy}\n{invalid}\n{overflow}\n")).unwrap();
        let current = store.record("info", "valid current record", true).unwrap();
        let records = store.read().unwrap();
        assert_eq!(records.len(), 2);
        assert!(records[0].id.is_none());
        assert_eq!(records[1], current);
    }
}
