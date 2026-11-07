# Frontend dependency compatibility

The 2026-11-07 update uses Vite 8, React's Vite plugin 6, React 19.3,
Lucide 1.70, TypeScript 6.0 and the latest compatible versions of the remaining
direct dependencies. Both npm lockfiles record the installed versions and
integrities.

## Compiler and runtime versions

The application uses TypeScript's JavaScript Compiler API to parse and transform
user TS/TSX in the browser. Build-time graph generation and the regression
harness use the same API. TypeScript 7.0.2 changes its root export to
`lib/version.cjs` and exposes separate unstable native APIs; it does not provide
the existing browser `transpileModule`/AST API. TypeScript therefore stays on
the latest compatible 6.0 release, rather than silently breaking UI compilation.
A future TypeScript 7 migration needs an explicit compiler implementation change
and browser acceptance tests.

`@types/node` stays on the latest Node 22 version to match the oldest supported
build runtime and the CI version. The project also supports Node 24 and newer;
using Node 26 declarations must not imply that its newer APIs exist on Node 22.

## Icon identifiers and UI rendering

Route metadata stores `icon` as `null` or a nonempty identifier of at most 128
Unicode scalar values, with ASCII controls and DEL rejected. The original text
is preserved without trimming or normalization. Metadata validation and schema 1
bundle digests do not depend on the installed Lucide version, so removed names
such as `Github` and `Chrome` remain readable and custom suites can use their own
identifiers.

UI source code owns the mapping from identifiers to rendered icons. The default
host and built-in suite resolve the installed Lucide namespace's actual concrete
components and aliases, including `Home`, `HomeIcon`, and `LucideHome`. Unknown
names and generic module exports such as `Icon` or `createLucideIcon` produce no
icon. Custom UI sources can implement another icon library or a fallback.
`scripts/check-ui-suite-route-icons.mjs` verifies this boundary, metadata round
trips and unchanged digest framing after dependency upgrades.

## Transitive override

ESLint and typescript-eslint currently constrain minimatch to version 10.
`overrides.minimatch` selects the patched version 11.0.5, which supports the
project's Node versions and the matcher API used by those tools. This removes
the glob amplification denial-of-service advisory
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Remove the override when the upstream tools admit a patched release directly.
Validate any change with ESLint and the full frontend regressions.

## Verification

Run `npm ci` at the repository root, then `npm --prefix ui ci`. The CI checks are
`lint`, `check:i18n`, `test`, and `build` in the UI package. `npm audit` provides
an additional dependency-specific check.
