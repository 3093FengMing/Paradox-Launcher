//! Shared launch fixtures and regressions organized by lifecycle behavior.

use super::controller::LaunchPhase;
use super::supervision::{GameProcess, supervise_process};
use super::*;
use fixtures::{collect_child_lines, spawn_controlled_child};
use std::{
    process::ExitStatus,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

mod controller;
mod fixtures;
mod logs;
mod processes;

#[test]
#[ignore = "controlled subprocess fixture; launched only by lifecycle tests"]
fn controlled_process_child() {
    fixtures::run_controlled_child();
}
