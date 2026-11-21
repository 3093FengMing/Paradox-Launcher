use super::*;
use paradox_core::{AppConfig, GameProfile};

fn request(name: &str) -> DownloadRequest {
    DownloadRequest::Install {
        config: AppConfig::default(),
        profile: GameProfile::new(name, "1.21.1").unwrap(),
        managed_root: paradox_core::model::default_data_directory().join("runtimes"),
    }
}

#[test]
fn queue_claims_busy_once_and_deduplicates_pending_targets() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(false);
    let first_request = request("first");
    let (first, start) = manager.insert(first_request.clone(), &busy).unwrap();
    assert!(start);
    assert!(busy.load(Ordering::Acquire));
    let (duplicate, start) = manager.insert(first_request, &busy).unwrap();
    assert!(!start);
    assert_eq!(first.id, duplicate.id);
    let (_, start) = manager.insert(request("second"), &busy).unwrap();
    assert!(!start);
    assert_eq!(manager.list().unwrap().len(), 2);
    assert!(
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    );
}

#[test]
fn game_busy_rejects_the_first_download_without_mutating_queue() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(true);
    assert!(manager.insert(request("first"), &busy).is_err());
    assert!(manager.list().unwrap().is_empty());
    assert!(!manager.has_pending());
}

#[test]
fn queued_cancellation_preserves_fifo_and_busy_until_the_queue_drains() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(false);
    let (first, _) = manager.insert(request("first"), &busy).unwrap();
    let (second, _) = manager.insert(request("second"), &busy).unwrap();
    let (third, _) = manager.insert(request("third"), &busy).unwrap();
    manager.cancel_task(&second.id).unwrap();
    let work = manager.take_next(&busy).unwrap().unwrap();
    assert_eq!(work.id, first.id);
    manager.finish_task(&work.id, Ok("done".into())).unwrap();
    assert!(busy.load(Ordering::Acquire));
    let work = manager.take_next(&busy).unwrap().unwrap();
    assert_eq!(work.id, third.id);
    manager.finish_task(&work.id, Ok("done".into())).unwrap();
    assert!(manager.take_next(&busy).unwrap().is_none());
    assert!(!busy.load(Ordering::Acquire));
    assert!(!manager.has_pending());
    let (_, start) = manager.insert(request("fourth"), &busy).unwrap();
    assert!(start);
}

#[test]
fn running_cancellation_keeps_busy_until_safe_completion() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(false);
    let (task, _) = manager.insert(request("first"), &busy).unwrap();
    let work = manager.take_next(&busy).unwrap().unwrap();
    assert!(manager.cancel_task(&task.id).unwrap().is_none());
    assert!(work.cancellation.is_cancelled());
    assert_eq!(
        manager.list().unwrap()[0].status,
        DownloadStatus::Cancelling
    );
    assert!(manager.has_pending());
    assert!(busy.load(Ordering::Acquire));
    let task = manager
        .finish_task(
            &work.id,
            Err(paradox_core::download::DownloadError::Cancelled.into()),
        )
        .unwrap();
    assert_eq!(task.status, DownloadStatus::Cancelled);
    assert!(manager.take_next(&busy).unwrap().is_none());
    assert!(!busy.load(Ordering::Acquire));
}

#[test]
fn cancellation_does_not_replace_a_completed_result_or_a_real_failure() {
    for result in [Ok("installed".into()), Err(anyhow!("network failed"))] {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        let (task, _) = manager.insert(request("first"), &busy).unwrap();
        let work = manager.take_next(&busy).unwrap().unwrap();
        manager.cancel_task(&task.id).unwrap();
        let completed = result.is_ok();
        let task = manager.finish_task(&work.id, result).unwrap();
        assert_eq!(
            task.status,
            if completed {
                DownloadStatus::Completed
            } else {
                DownloadStatus::Failed
            }
        );
        assert_eq!(
            task.message,
            if completed {
                "installed"
            } else {
                "network failed"
            }
        );
    }
}

#[test]
fn cancellation_preserves_the_recovery_directory_and_cleanup_failure() {
    for message in [
        "content.errors.recovery: C:/game/backups/recovery",
        "unable to clean staging directory",
    ] {
        let manager = DownloadManager::default();
        let busy = AtomicBool::new(false);
        let (task, _) = manager.insert(request("first"), &busy).unwrap();
        let work = manager.take_next(&busy).unwrap().unwrap();
        manager.cancel_task(&task.id).unwrap();
        let error = anyhow!(message).context("installation failed");
        let task = manager.finish_task(&work.id, Err(error)).unwrap();
        assert_eq!(task.status, DownloadStatus::Failed);
        assert!(task.message.contains(message));
    }
}

#[test]
fn only_typed_cooperative_cancellation_finishes_as_cancelled() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(false);
    let (task, _) = manager.insert(request("first"), &busy).unwrap();
    manager.take_next(&busy).unwrap().unwrap();
    let error = anyhow::Error::new(paradox_core::download::DownloadError::Cancelled)
        .context("content installation stopped");
    let task = manager.finish_task(&task.id, Err(error)).unwrap();
    assert_eq!(task.status, DownloadStatus::Cancelled);
    assert_eq!(task.message, "下载已取消");
    assert!(!task.message.contains("临时文件已清理"));

    let (task, _) = manager.insert(request("second"), &busy).unwrap();
    manager.take_next(&busy).unwrap().unwrap();
    manager.cancel_task(&task.id).unwrap();
    let task = manager
        .finish_task(&task.id, Err(anyhow!("cancelled")))
        .unwrap();
    assert_eq!(
        task.status,
        DownloadStatus::Failed,
        "a cancellation request cannot classify an arbitrary execution failure"
    );
}

#[test]
fn retries_create_a_new_attempt_behind_existing_queued_work() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(false);
    let (failed, _) = manager.insert(request("first"), &busy).unwrap();
    assert!(manager.retry_request(&failed.id).is_err());
    let work = manager.take_next(&busy).unwrap().unwrap();
    manager
        .finish_task(&work.id, Err(anyhow!("network failed")))
        .unwrap();
    let (second, _) = manager.insert(request("second"), &busy).unwrap();
    let (retry, _) = manager
        .insert(manager.retry_request(&failed.id).unwrap(), &busy)
        .unwrap();
    assert_ne!(retry.id, failed.id);
    assert_eq!(retry.profile_key, failed.profile_key);
    let work = manager.take_next(&busy).unwrap().unwrap();
    assert_eq!(work.id, second.id);
    manager.finish_task(&work.id, Ok("done".into())).unwrap();
    assert_eq!(manager.take_next(&busy).unwrap().unwrap().id, retry.id);
    assert_eq!(manager.list().unwrap()[0].status, DownloadStatus::Failed);
}

#[test]
fn pending_capacity_and_terminal_history_are_bounded() {
    let manager = DownloadManager::default();
    let busy = AtomicBool::new(false);
    for index in 0..MAX_PENDING_TASKS {
        manager.insert(request(&index.to_string()), &busy).unwrap();
    }
    assert!(manager.insert(request("overflow"), &busy).is_err());
    while let Some(work) = manager.take_next(&busy).unwrap() {
        manager.finish_task(&work.id, Ok("done".into())).unwrap();
    }
    for index in 0..MAX_RETAINED_TASKS + 5 {
        manager
            .insert(request(&format!("later-{index}")), &busy)
            .unwrap();
        let work = manager.take_next(&busy).unwrap().unwrap();
        manager.finish_task(&work.id, Ok("done".into())).unwrap();
        assert!(manager.take_next(&busy).unwrap().is_none());
    }
    assert_eq!(manager.list().unwrap().len(), MAX_RETAINED_TASKS);
    assert!(!manager.has_pending());
}
