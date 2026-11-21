//! Download fault, integrity, scheduling and cleanup regressions.

use super::transfer::{discard_temporary, finish_transfer_output};
use super::*;
use fixtures::{checksum, response, serve, test_options};
use sha2::Digest;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

mod cancellation;
mod cleanup;
mod concurrency;
mod fixtures;
mod integrity;
