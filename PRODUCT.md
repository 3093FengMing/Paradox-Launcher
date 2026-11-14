# Paradox Launcher

<!-- impeccable:product-schema 1 -->

## Platform

web

React UI rendered by a Windows Tauri/WebView2 desktop application. The repository also provides browser fixtures for verification.

## Users

Minecraft players who select an account and instance, install or repair a game, and launch it. Players managing multiple instances also organize versions and local/online content.

## Product Purpose

Make selecting, preparing, launching, and managing Minecraft instances understandable and dependable. The entire normal interface is a user-replaceable suite; built-in designs are editable examples.

## Operating Context

An existing React/Vite/Tauri application, with Base UI primitives exposed through @paradox/ui. Use the existing workspace and dev branch. Preserve the user's uncommitted .gitignore change. Do not create a worktree or perform unrelated SDK synchronization.

## Capabilities and Constraints

- Keep two complete, independent built-in suites: immersive for everyday launch and Modern for multi-instance/content management. Both provide the full player feature set.
- Version library is independent. Downloads manage task progress, cancellation, and retry. Local mods, resource packs, shaders, and saves belong to instance details; online supported content is discovered and installed through resource discovery.
- Use the single permanent LauncherProvider and the real @paradox/launcher snapshot/actions/capabilities. Do not mount duplicate business owners, private hooks/IPC, or direct Modrinth requests.
- Do not invent unsupported recent play, playtime, favorites, cloud sync, galleries, multiple offline accounts, task pause/reordering, or compatibility badges.
- Instance details require a real profileKey; missing keys must not silently use the launch-selected instance.
- Normal navigation, page structure, controls, title bar, business dialogs, onboarding, loading, errors, notices, and ordinary UI editor remain customizable through CSS, HTML, TS, TSX, suite assets, and public business actions.
- Preserve UI schema/API 1, stable UiView/UiIdentity/site keys, Original props/refs/callbacks, drafts, CAS, preview, and save protocols.
- The ordinary UI editor keeps its existing appearance for this redesign unless the user expands the scope.
- The hidden emergency Recovery is the only fixed interface. Preserve Ctrl+Shift+F11, Ctrl+Shift+F12, and --ui-safe.
- Both default suites use solid surfaces. This release does not create, provide, or consume default background images. Preserve public image/asset customization capabilities.
- No old default-design migration is needed in this beta. Preserve accounts, games, user configuration, assets, suites, and parent snapshots.

## Brand Commitments

Keep the Paradox Launcher identity. HMCL and PCL CE screenshots are authorized design references, not branding or content to copy. On 2026-11-15 the user requested a bolder change to visual design and navigation, with compact but readable density.

## Evidence on Hand

- Latest accepted product scope: docs/superpowers/specs/2026-11-07-default-ui-redesign-design.md.
- Latest existing delivery/verification record: docs/TESTING-UI-REDESIGN.md.
- Customization contract: docs/UI-CUSTOMIZATION.md.
- Six HMCL references: docs/ui-redesign-references-2026-11-07/.
- Current default visual baseline: .test-data/ui-redesign/dev/browser-batch/redesign-2026-11-08T04-51-28-954Z/check-ui-redesign-browser/. Source hashes were checked against HEAD 18ce9b29da7e712cfcbb52f729c425d8aea1bec8; this is visual evidence, not a fresh native functional acceptance.
- Six PCL CE screenshots supplied in this conversation on 2026-11-15; persist readable copies in the redesign reference folder before using them in durable documents.

## Product Principles

1. Make the launch target, account, and actual preparation/running state clear.
2. Let the two suites organize the same real capabilities around different player tasks.
3. Keep all normal presentation replaceable without weakening business ownership or emergency recovery.
4. Let progress, errors, and availability describe real state and offer supported next actions.

## Accessibility & Inclusion

Support Chinese and English, keyboard operation, resizable small windows, Windows high DPI, light/dark/system theme, 85–120% application scale, custom radius/accent, and reduced motion. System 200% DPI is distinct from application scale. Verify actual rendering and interaction; screenshots alone do not prove accessibility or native functionality.

## Open Design Decisions

The user has confirmed immersive top-level navigation with contextual side navigation, and Modern narrow side navigation with an instance workspace and collapsible details. On 2026-11-15, after reviewing candidates, the user selected “折页的设计+石墨的配色”: the Fold layout and hierarchy with the Graphite palette, then explicitly authorized implementation with “按这版实施”. Both complete default suites have been implemented; current-source verification and native acceptance boundaries are recorded in docs/ui-redesign-2026-11-15/implementation-review.md. HTML/CSS design boards were explicitly authorized because the current conversation has no built-in Image Gen tool; prototype evidence remains separate from application and native acceptance. Final application screenshots and input/build provenance are saved in docs/ui-redesign-2026-11-15/evidence/application/.
