//! Shared subprocess fixture and behavior-specific process regressions.

use super::probe::{MAX_PROBE_OUTPUT_BYTES, read_output};
use super::*;
use crate::java::JavaInstallation;
use elemental::core::launcher::command::LaunchCommand;
#[cfg(windows)]
use fixtures::TrackedProcess;
use fixtures::fixture_command;
use std::{path::Path, time::Duration};
#[cfg(windows)]
use tokio::process::Command;

mod fixtures;
mod logs;
mod probe;
#[cfg(windows)]
mod trees;

#[test]
fn process_fixture() {
    fixtures::run_fixture();
}
