//! Process ownership, game log streaming, and bounded Java probes.

mod logs;
mod owned;
mod probe;
#[cfg(windows)]
mod windows_job;

pub(crate) use logs::spawn_command_logged;
pub use logs::{LoggedChild, ProcessLogLine, ProcessLogSource};
pub use owned::{OwnedChild, ProcessTree, kill_process_tree, spawn_owned_command};
pub(crate) use probe::probe_output;

#[cfg(test)]
mod tests;
