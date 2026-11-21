//! Account transaction regressions share one set of injectable fixtures.
// Keep test names stable for targeted CI filters and recovery diagnostics.
include!("tests/fixtures.rs");
include!("tests/commit_validation.rs");
include!("tests/commit_credentials.rs");
include!("tests/commit_rollback.rs");
include!("tests/refresh_cancellation.rs");
include!("tests/refresh_identity.rs");
include!("tests/recovery.rs");
include!("tests/login.rs");
include!("tests/configuration.rs");
include!("tests/metadata.rs");
include!("tests/migration.rs");
