# GLib 0.18.5 security backport

This directory contains the complete upstream `glib` 0.18.5 crate published on
crates.io, with the original MIT license and package version retained. The launcher
patches this crate through the root `[patch.crates-io]` table because Tauri's GTK 3
dependencies require the GLib 0.18 API. No newer GLib types are substituted.

Original package:

- Source: <https://static.crates.io/crates/glib/glib-0.18.5.crate>
- SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`
- Upstream source revision: `42b9caf98e03ded086362d9653ca58fe94dc8658`
- Upstream repository: <https://github.com/gtk-rs/gtk-rs-core>

The only runtime source change is the exact two-line fix from upstream commit
[`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34)
(PR [#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)). In
`src/variant_iter.rs`, `VariantStrIter::impl_get` declares its output pointer as
`let mut p` and passes `&mut p` to the variadic `g_variant_get_child` C function.
This ensures the C function writes through a valid mutable output pointer before
Rust reads the resulting string. `next`, `nth`, `last`, `next_back`, and `nth_back`
all use that helper and receive the same fix.

Advisory: [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html),
[GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g).
The advisory database identifies upstream released versions below 0.20.0 as
affected; upstream has not published a compatible 0.18 release containing the fix.
This local package deliberately keeps version 0.18.5 and records the backport
instead of claiming a newer released version. Version-only scanners may continue
to report the advisory; assess this copy using the source change and test evidence.

The launcher's `crates/launcher-core/tests/glib_backport.rs` regressions cover all
five affected iterator methods, Unicode strings, empty arrays, exhaustion, and
index overflow. The Linux-only test dependency resolves through this root patch.
Linux verification requires the native GLib development libraries. Run both debug
and optimized execution because the original shared-reference violation can depend
on optimizer assumptions:

```sh
cargo test -p paradox-core --test glib_backport --locked
cargo test -p paradox-core --test glib_backport --locked --release
```

The standard Linux workspace test step includes the debug regressions, and CI
additionally runs the focused release command. These commands are validation
requirements; their presence in CI does not claim an unobserved run has passed.

Replace this backport when the parent GTK/Tauri dependency permits an upstream
release containing the fix. Preserve upstream formatting and keep future source
changes limited to reviewed security backports.
