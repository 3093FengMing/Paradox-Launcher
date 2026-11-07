# Host Unicode protocol utilities

The launcher owns these internal Unicode 15.1.0 tables and algorithms. UI-suite
authors create ordinary CSS, HTML, TS and TSX files; they do not import these
tables or choose path normalization rules.

`../suite-paths.ts` applies NFC validation, C/S simple-fold collision checks and
relative-path resolution to suite files. The internal `ui-suite/paths.ts` facade
keeps existing format, storage, archive and compiler consumers on that same host
protocol. `scalars.ts` also supplies well-formed Unicode checks to canonical JSON
and byte encoding without depending on the suite layer.

The JSON resources, their adjacent provenance and `unicode-license.txt` retain
the original bytes and pinned version. Rust embeds the same simple-fold table
from this directory and uses `unicode-normalization = "=0.1.23"` for NFC.
Normalization validates paths; it does not rewrite paths, file contents or
bundle hash inputs. Unassigned scalars retain Unicode 15.1 behavior.

The shared official normalization fixture stays at
`ui/scripts/fixtures/ui-suite/NormalizationTest-15.1.0.txt` and is consumed by the
JavaScript and Rust conformance checks.
