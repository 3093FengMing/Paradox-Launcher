use super::*;
#[tokio::test]
async fn cancellation_before_preparation_does_not_poll_preparation() {
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let polled = AtomicBool::new(false);
    let result = prepare_until_cancelled(&cancellation, async {
        polled.store(true, Ordering::Release);
        Ok(())
    })
    .await
    .unwrap();
    assert!(
        result.is_none(),
        "a cancelled preparation must not produce a command"
    );
    assert!(!polled.load(Ordering::Acquire));
}

#[tokio::test]
async fn cancellation_during_preparation_discards_the_ready_command() {
    let cancellation = CancellationToken::new();
    let (entered, entered_rx) = tokio::sync::oneshot::channel();
    let (finish, finish_rx) = tokio::sync::oneshot::channel();
    let work = prepare_until_cancelled(&cancellation, async {
        entered.send(()).unwrap();
        finish_rx.await.unwrap();
        Ok(())
    });
    let stop = async {
        entered_rx.await.unwrap();
        cancellation.cancel();
        let _ = finish.send(());
    };
    let (result, ()) = tokio::join!(work, stop);
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn cancellation_wins_when_preparation_and_stop_are_both_ready() {
    let cancellation = CancellationToken::new();
    let (finish, finish_rx) = tokio::sync::oneshot::channel();
    finish.send(()).unwrap();
    cancellation.cancel();
    let result = prepare_until_cancelled(&cancellation, async {
        finish_rx.await.unwrap();
        Ok(())
    })
    .await
    .unwrap();
    assert!(result.is_none());
}

#[test]
fn stopping_preparation_prevents_spawn_and_holds_busy_until_completion() {
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let (guard, cancellation, _stop) = control.begin(Arc::clone(&busy)).unwrap();
    control.request_stop(|| {}).unwrap();
    let spawned = AtomicBool::new(false);
    assert!(
        control
            .spawn_if_active(|| {
                spawned.store(true, Ordering::Release);
                Ok(())
            })
            .unwrap()
            .is_none()
    );
    assert!(!spawned.load(Ordering::Acquire));
    assert!(cancellation.is_cancelled());
    assert!(control.is_active());
    assert!(busy.load(Ordering::Acquire));
    drop(guard);
    assert!(!control.is_active());
    assert!(!busy.load(Ordering::Acquire));
}

#[test]
fn repeated_stop_coalesces_a_full_channel_and_announces_cancelling_once() {
    let control = Arc::new(LaunchController::default());
    let (_guard, _cancellation, mut stop) =
        control.begin(Arc::new(AtomicBool::new(false))).unwrap();
    let announcements = AtomicUsize::new(0);
    for _ in 0..3 {
        control
            .request_stop(|| {
                announcements.fetch_add(1, Ordering::AcqRel);
            })
            .unwrap();
    }
    assert_eq!(announcements.load(Ordering::Acquire), 1);
    assert!(stop.try_recv().is_ok());
    assert!(stop.try_recv().is_err());
}

#[test]
fn panic_in_cancelling_announcement_still_signals_the_game_supervisor() {
    let control = Arc::new(LaunchController::default());
    let (_guard, cancellation, mut stop) = control.begin(Arc::new(AtomicBool::new(false))).unwrap();
    let result = catch_unwind(AssertUnwindSafe(|| {
        control.request_stop(|| panic!("controlled cancelling notification failure"))
    }));
    assert!(result.is_err());
    assert!(cancellation.is_cancelled());
    assert!(
        stop.try_recv().is_ok(),
        "the supervisor must receive the accepted stop even if notification fails"
    );
}

#[test]
fn terminal_publication_precedes_a_new_launch_and_releases_busy_for_it() {
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let (guard, _, _stop) = control.begin(Arc::clone(&busy)).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let (start, start_rx) = std::sync::mpsc::channel();
    let (at_boundary, boundary_rx) = std::sync::mpsc::channel();
    let (published, published_rx) = std::sync::mpsc::channel();
    let next = std::thread::spawn({
        let control = Arc::clone(&control);
        let busy = Arc::clone(&busy);
        let events = Arc::clone(&events);
        move || {
            start_rx.recv().unwrap();
            // Probe acquisition to coordinate this boundary without sleeps:
            // if the terminal publisher owns the lock, begin must wait.
            let blocked = control.session.try_lock().is_err();
            if blocked {
                at_boundary.send(()).unwrap();
                published_rx.recv().unwrap();
            }
            let work = control.begin(busy).unwrap();
            events.lock().unwrap().push("started");
            if !blocked {
                at_boundary.send(()).unwrap();
            }
            work
        }
    });
    guard.finish(|| {
        assert!(
            !busy.load(Ordering::Acquire),
            "next launch must see busy released after publication"
        );
        start.send(()).unwrap();
        boundary_rx.recv().unwrap();
        events.lock().unwrap().push("finished");
        let _ = published.send(());
    });
    let next_work = next.join().unwrap();
    assert_eq!(*events.lock().unwrap(), ["finished", "started"]);
    assert!(control.is_active());
    assert!(busy.load(Ordering::Acquire));
    drop(next_work);
    assert!(!busy.load(Ordering::Acquire));
}

#[test]
fn stopping_after_spawn_suppresses_running_announcement() {
    let control = Arc::new(LaunchController::default());
    let (_guard, _cancellation, _stop) = control.begin(Arc::new(AtomicBool::new(false))).unwrap();
    assert!(control.spawn_if_active(|| Ok(())).unwrap().is_some());
    control.request_stop(|| {}).unwrap();
    let announced = AtomicBool::new(false);
    assert!(!control.announce_running(|| {
        announced.store(true, Ordering::Release);
    }));
    assert!(!announced.load(Ordering::Acquire));
}

#[test]
fn unwinding_clears_control_and_busy() {
    let control = Arc::new(LaunchController::default());
    let busy = Arc::new(AtomicBool::new(false));
    let result = std::panic::catch_unwind({
        let control = Arc::clone(&control);
        let busy = Arc::clone(&busy);
        move || {
            let (_guard, _, _stop) = control.begin(busy).unwrap();
            control
                .spawn_if_active::<()>(|| panic!("controlled spawn failure"))
                .unwrap();
        }
    });
    assert!(result.is_err());
    assert!(!control.is_active());
    assert!(!busy.load(Ordering::Acquire));
}

#[test]
fn cancelling_credentials_does_not_hide_vault_failure() {
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let result = finish_credentials::<()>(Err(anyhow!("auth.errors.storage")), &cancellation);
    assert_eq!(result.unwrap_err().to_string(), "auth.errors.storage");
}

#[test]
fn cooperative_credential_cancellation_is_a_normal_terminal_result() {
    let result = finish_credentials::<()>(
        Err(anyhow!("auth.errors.cancelled")),
        &CancellationToken::new(),
    );
    assert!(result.unwrap().is_none());
}

#[test]
fn failed_kill_restores_retryable_state_and_allows_a_new_stop_announcement() {
    let control = Arc::new(LaunchController::default());
    let (_guard, cancellation, mut stop) = control.begin(Arc::new(AtomicBool::new(false))).unwrap();
    control.announce_running(|| {});
    let announcements = AtomicUsize::new(0);
    control
        .request_stop(|| {
            announcements.fetch_add(1, Ordering::AcqRel);
        })
        .unwrap();
    stop.try_recv().unwrap();
    control.stop_failed(|| {});
    assert_eq!(
        control.session.lock().unwrap().as_ref().unwrap().phase,
        LaunchPhase::Running
    );
    assert!(
        cancellation.is_cancelled(),
        "preparation stays cancelled after spawn"
    );
    control
        .request_stop(|| {
            announcements.fetch_add(1, Ordering::AcqRel);
        })
        .unwrap();
    assert_eq!(announcements.load(Ordering::Acquire), 2);
    assert!(stop.try_recv().is_ok());
}

#[test]
fn failed_kill_does_not_replace_a_newer_pending_stop_with_running() {
    let control = Arc::new(LaunchController::default());
    let (_guard, _cancellation, mut stop) =
        control.begin(Arc::new(AtomicBool::new(false))).unwrap();
    control.request_stop(|| {}).unwrap();
    stop.try_recv().unwrap();
    control.request_stop(|| {}).unwrap();
    let announced = AtomicBool::new(false);
    control.stop_failed(|| {
        announced.store(true, Ordering::Release);
    });
    assert!(!announced.load(Ordering::Acquire));
    assert_eq!(
        control.session.lock().unwrap().as_ref().unwrap().phase,
        LaunchPhase::Cancelling
    );
}
