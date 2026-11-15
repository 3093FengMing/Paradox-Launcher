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
- Both suites have one download entry, with version library, resource discovery, and task records inside it. Keep the existing custom.versions, content, and downloads business routes and controllers distinct. Downloads continue to manage progress, cancellation, and retry. Local mods, resource packs, shaders, and saves belong to instance details.
- Keep accounts registered with navigation=false in the built-in manifests. The home account entry is available whenever the accounts route is registered; a hidden main-navigation entry does not remove the account page.
- Immersive uses Home, Instances, Downloads, and Settings as its four primary entries, with other navigable routes in More. At widths of 900px or less, use the menu for all navigable routes. Keep the instance-details contextual navigation and readable brand text.
- Modern uses a separate permanent title bar, including the ready workspace, and a narrow side rail. Low-height windows use a compact rail and full navigation menu; the home page omits the memory summary and duplicate shortcut/task sections. Its desktop current-instance card groups instance information and account/launch actions side by side, returning to one column at 640px. Compact Inspector does not render directories; full details retain directories, memory configuration, and other existing capabilities.
- Normal instance lists omit directory tool regions and use wider filters. Version pages use a continuous list, one search field, the public type Select, and batches of 30 rendered rows. Modern's type Select places its value and arrow at opposite ends. The existing API returns the complete cached index; UI load-more is not server pagination.
- Player logs use 1.4 line height, 2px vertical row padding, written severity labels, and theme-aware severity ink. Preserve log filtering, selection, wrapping, and supported copy/clear/follow actions.
- Use the single permanent LauncherProvider and the real @paradox/launcher snapshot/actions/capabilities. Do not mount duplicate business owners, private hooks/IPC, or direct Modrinth requests.
- Do not invent unsupported recent play, playtime, favorites, cloud sync, galleries, multiple offline accounts, task pause/reordering, or compatibility badges.
- Instance details require a real profileKey; missing keys must not silently use the launch-selected instance.
- Normal navigation, page structure, controls, title bar, business dialogs, onboarding, loading, errors, notices, and ordinary UI editor remain customizable through CSS, HTML, TS, TSX, suite assets, and public business actions.
- Preserve UI schema/API 1, stable UiView/UiIdentity/site keys, Original props/refs/callbacks, drafts, CAS, preview, and save protocols.
- The ordinary UI editor keeps its existing appearance for this redesign unless the user expands the scope.
- The hidden emergency Recovery is the only fixed interface. Preserve Ctrl+Shift+F11, Ctrl+Shift+F12, and --ui-safe.
- Both default suites use solid surfaces. This release does not create, provide, or consume default background images. Preserve public image/asset customization capabilities.
- Shared common/player-interaction.css adds squircle corners only when supported, including core home surfaces and account entries, retaining the public saved radius and its fallback. Hover feedback uses 150ms and active feedback 45ms. The shared use-route-motion hook uses 170ms opacity feedback on the existing route-stage; motion must not remount UiRouteViewport or the permanent provider. Respect application and system reduced-motion preferences.
- No old default-design migration is needed in this beta. Preserve accounts, games, user configuration, assets, suites, and parent snapshots.

## Brand Commitments

Keep the Paradox Launcher identity and the user-approved “折页＋石墨” direction: Fold hierarchy, Graphite solid surfaces, and compact but readable density. HMCL and PCL CE screenshots remain authorized design references. The latest navigation and interaction refinements develop this implemented direction.

## Evidence on Hand

- Current scope: the user's explicit 2026-11-15 navigation and interaction requests, recorded in DESIGN.md and this file. Frozen sourceStage is navigation-refinement-final, generatedAt 2026-11-15T09:35:34.728Z, gitBaseline e3e880f397ad3d22dc5301819b8832d9f672cb86, and source SHA-256 b9c0dd1c29c61bd6231369c579bbd37af4723bc86ccff61e0a7cc6999edc99e4. The fingerprint includes 156 common/modern/immersive TS/TSX/CSS files, with manifests separately hashed. Modern has 91 files / 45 views / 9 routes; Immersive has 90 files / 45 views / 9 routes. Source records are in docs/ui-navigation-refinement-2026-11-15/evidence/provenance.json.
- Current application capture: 22 screenshots recorded at 09:30:17.655–09:30:31.756 UTC on 2026-11-15, with both suites reporting empty errors/CSP arrays and squircle support. The report and screenshot hashes are saved in the new evidence directory. These use desktop-boundary fixtures and test data, not native authentication, download, or game acceptance.
- Current builds and limited checks: new Windows debug executable SHA-256 bf786e5bd61b72c95fe2641614a4451713764d0a76baf7e4da907cbca4381530, compiled fixture, production packaging, TS, lint, and i18n checks succeeded. i18n recorded 1108 keys, 1952 usages, and 2 languages. Static npm test exited 0 before the last presentation refinements; detector ran once and returned []. Build details are in evidence/build-provenance.json. All four DEV and all four compiled+CSP targeted browser checks passed; evidence/verification-summary.json records the actual results and boundaries.
- Independent review: docs/ui-navigation-refinement-2026-11-15/independent-review.md records four repaired and rechecked findings, with no remaining tested P0–P2. The Modern desktop home card measured 141.5px high in the tested scene and returned to one column at 640px; compact Inspector directory nodes were absent, core surfaces used squircle, and type Select used space-between with keyboard focus recovery. This is limited review evidence, not complete regression acceptance.
- Historical Fold/Graphite delivery: commit e3e880f397ad3d22dc5301819b8832d9f672cb86 and docs/ui-redesign-2026-11-15/evidence/application/. Preserve those sources, screenshots, build provenance, and acceptance boundaries as history; they do not verify the current refinements.
- Earlier specification and verification: docs/superpowers/specs/2026-11-07-default-ui-redesign-design.md and docs/TESTING-UI-REDESIGN.md, for their respective historical sources.
- Customization contract: docs/UI-CUSTOMIZATION.md.
- Six HMCL references: docs/ui-redesign-references-2026-11-07/.
- Earlier visual baseline: .test-data/ui-redesign/dev/browser-batch/redesign-2026-11-08T04-51-28-954Z/check-ui-redesign-browser/. Its hashes were checked against the historical 18ce9b29da7e712cfcbb52f729c425d8aea1bec8 source. It is neither the current visual baseline nor a fresh native functional acceptance.
- Six PCL CE screenshots supplied in this conversation on 2026-11-15; persist readable copies in the redesign reference folder before using them in durable documents.

## Product Principles

1. Make the launch target, account, and actual preparation/running state clear.
2. Let the two suites organize the same real capabilities around different player tasks.
3. Keep all normal presentation replaceable without weakening business ownership or emergency recovery.
4. Let progress, errors, and availability describe real state and offer supported next actions.
5. Group download navigation while retaining the existing version, discovery, and task capabilities; preserve registered routes even when they are hidden from the main navigation.

## Accessibility & Inclusion

Support Chinese and English, keyboard operation, resizable small windows, Windows high DPI, light/dark/system theme, 85–120% application scale, custom radius/accent, and reduced motion. System 200% DPI is distinct from application scale. Verify actual rendering and interaction; screenshots alone do not prove accessibility or native functionality.

## Open Design Decisions

The user selected “折页的设计+石墨的配色”, then authorized implementation with “按这版实施”. The two complete suites were delivered in historical commit e3e880f; their application evidence and native acceptance boundaries remain in docs/ui-redesign-2026-11-15/evidence/application/ and implementation-review.md. The user then explicitly requested the unified download entry, account-entry policy, reduced navigation, separate Modern title bar, simpler home and instance surfaces, continuous version list, denser logs, and progressive corners and feedback described above. This round updates that same direction; it does not generate a new design system. Final source hashes, screenshots, and build provenance are now saved in docs/ui-navigation-refinement-2026-11-15/evidence/. Final targeted browser checks are complete in DEV and compiled+CSP, with zero page errors or CSP violations; the compiled checks made no application source module requests. Historical prototypes and screenshots remain references and cannot mark any unverified current item as passed.

本轮最终自动回归：DEV与编译＋CSP分别完成首页、统一下载导航、版本/任务流程和日志响应式四组检查，全部退出0；每环境48个导航布局组合与540个日志/路由布局组合，编译环境没有源码模块请求、页面错误或CSP违规。最终记录为[verification-summary.json](docs/ui-navigation-refinement-2026-11-15/evidence/verification-summary.json)，独立设计复查为[independent-review.md](docs/ui-navigation-refinement-2026-11-15/independent-review.md)。实际原生认证、联网下载、游戏启动和系统DPI操作仍保留为未验边界。
