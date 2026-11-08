# Paradox Launcher

基于 **Rust + QuintElement SDK**（Elemental 的自有 fork）的 Minecraft 桌面启动器，使用 **Tauri 2、React 19、TypeScript**。已交付版本为 `v0.2.0`：原版安装、Java 管理、实例管理、双样式界面、自定义外观预设与简体中文 / English 已完成，四组游戏运行矩阵、61 项 Rust 测试与正式 release 构建已通过，可使用 Windows x64 功能测试版。

当前开发工作区版本为 `0.4.0-dev`，直接依赖 `vendor/QuintElement/` 子模块源码，修改 fork 后重新编译启动器即可生效。已补齐 v0.3 账户体验与 v0.4 四种主要加载器；下方 v0.2 产物继续保留，实际范围见 v0.3 / v0.4 测试指南。

开发工作区已接入 Microsoft 设备代码登录、账户刷新、OS 凭据库和启动 / 登录取消恢复。项目默认 Client ID 为 `7fd2b4de-f119-4ab8-8d8e-906af5efe6f3`，账户页可改用自定义 ID。已用真实账户通过浏览器授权、完整后台认证链、Windows 凭据持久化、独立进程刷新与登出清理；真实游戏启动、在线服务器认证和完整原生 GUI 流程仍需独立验收。现有发行版的账户能力以下方记录为准。

## 当前能力

- 两种完整默认来源：「沉浸式」参考 HMCL 的分组侧栏、紧凑列表与右下启动区；「Modern 工作台」使用固定导航、实例表和详情区。首次普通启动展示两套预览，明确确认后记住选择。两种样式共用永久业务 owner、配置、账户和任务状态。
- 默认界面使用纯色底面，已移除全部内置图片背景和旧 SVG 风景。自绘标题栏、自由调整窗口大小、正文独立滚动，以及融入主题的细滚动条继续保留。已有用户背景配置与自定义套件素材能力保留。
- 导航包括首页、实例、游戏版本库、下载任务、账户、资源发现、设置和日志；实例详情另提供概览、有效设置摘要及本地模组 / 资源包 / 光影 / 存档。查看实例与设为当前启动实例分别操作，版本库与下载任务分别承担版本选择和任务管理。
- 实例创建、重命名、切换、编辑与已有 Vanilla 实例导入。导入引用完整游戏根目录中的原文件；默认移除仅删除启动器记录，删除实例文件需要另行确认。
- 每实例 Java、最小 / 最大内存、分辨率、JVM 与游戏参数覆盖；未启用覆盖的项目继承全局设置。
- Microsoft 设备代码登录、OS 凭据库、过期刷新、登出、多账户与启动前身份选择；当前身份和缓存头像在首页 / 侧栏同步，获取代码与授权均可取消，失败遗留凭据可恢复清理。
- Fabric / Quilt / 现代 Forge / NeoForge 创建与安装，扫描实际加载器版本并在启动前核对；模组列表、启停事务、打开目录和兼容提醒。Forge 开放 Minecraft 1.17 及以上，具体运行矩阵见测试指南。
- QuintElement 真实版本目录与磁盘扫描，版本目录缓存、手动刷新、网络失败时缓存回退，并显示缓存来源与警告。
- 原版安装 / 修复下载队列，文件数、字节数与速率，取消、失败重试、校验与已有完整文件复用。
- 本地 Java 检测、可执行文件选择、版本与架构检查；Windows x64 / ARM64 可下载 Adoptium JRE，并校验下载文件与实际运行时版本。
- 原版离线启动、游戏日志流、停止游戏与异常退出提示；任务运行时关闭窗口可询问、停止任务并退出，或隐藏窗口继续任务。
- 网络超时、文件并发、重试次数、HTTP / HTTPS 代理与 Mojang 兼容镜像配置。
- 深色 / 浅色 / 跟随系统、强调色、85–120% 应用缩放、字体、圆角、侧栏不透明度和减少动效；外观在设置页即时预览，保存后持久生效。默认设置页不提供图片背景导入、模糊和遮罩项。
- 自定义界面预设：保存完整外观、命名、应用、重命名、移除和可移植 JSON 导入 / 导出；预设库独立于未保存的设置草稿。
- UI 来源套件（`0.4.0-dev`）：默认 modern/immersive 完整来源，支持套件文件与素材、CSS / HTML / TSX、ZIP 导入导出、Original 和公开业务动作；普通编辑器也可替换，固定 Recovery 与 `--ui-safe` 支持可信修复。Ctrl+Shift+F11 打开编辑器；选择目标后为精确位置、同一业务项或所有同类目标创建文件覆盖，Preview 应用草稿，Save 持久保存。HTML / TSX 共用一个入口，切换和重置保留普通文件。Ctrl+Shift+F12 打开固定 Recovery，可导出原始数据并修复同一草稿。
- 套件自行决定图标如何显示：`route.icon` 可以是自定义名称或 `null`，名称最多 128 个 Unicode 字符，不含 ASCII 控制字符。默认 UI 从 Lucide 依赖解析具体图标及别名，未知名称省略图标；自定义 UI 可用自己的 SVG、组件或素材，不再受固定图标清单限制。
- 套件文件名由启动器自动检查：Unicode 工具位于 `ui/src/host/` 内部，套件作者无需维护或导入数据表。保留原有 Unicode 15.1 文件名、大小写碰撞和相对路径规则，已有套件无需迁移。
- i18n：简体中文、English 与跟随系统；页面、弹窗、常用通知与状态即时切换并持久化，翻译资源随 exe 离线提供。使用及扩展说明见 界面预设与多语言。
- 版本化配置与原子保存、参数校验、损坏配置保护、Git 基线、依赖锁文件和质量检查。

Microsoft 正版游戏与在线服务器身份、原生完整交互、更多 loader、整合包、系统安装包和自动更新按 [路线图](ROADMAP.md) 继续验收与开发。当前可以在正版账户和离线身份之间选择。

本轮默认 UI 重设计已完成，清理后的源码已通过开发与实际 CSP 编译后各七项专项、36 个场景矩阵上下文，以及编辑器和普通生产入口复验；当前源码对应的 Windows debug 构建已生成。完整结果、复现命令与本人原生验收边界见 [默认 UI 重设计验收](docs/TESTING-UI-REDESIGN.md)。该记录与下方历史发行构建的结果分别保存。

实际验证范围见 验证记录：1.12.2 / Java 8、1.20.1 / Java 17、1.21.1 / Java 21、验证时最新稳定版 26.3 / Java 25 均已完成两次日志就绪与自然退出，完整资源修复检查传输量为 0。26.3 已通过原生库搜索目录兼容处理后的复验。原生 exe 已验证首页加载、键盘导航、最大化 / 还原、现代样式保存后重启恢复与 Alt+F4 正常退出。预设、双语切换、持久化、草稿隔离及 320 × 240 / 120% 缩放无页面溢出已在浏览器验收；完整原生视觉、鼠标任意尺寸拖动、高 DPI 和任务运行期间全部关闭分支继续验收。

## Windows 测试版

此前 v0.4 功能测试构建为 `releases/v0.4.0-dev/Paradox-Launcher-0.4.0-dev-windows-x64.exe`，前端已内嵌，大小 31,013,888 字节。该构建的账户体验、四种 loader 普通 / Windows 扩展路径共 16 次真实启动就绪、200 项 workspace 与 6 项 SDK 测试以及 release 构建已通过。默认 UI 重设计的当前 debug 构建及 SHA-256 另见 [默认 UI 重设计验收](docs/TESTING-UI-REDESIGN.md)。正版游戏 / 在线服务器身份和完整原生交互仍需单独验收；历史构建信息、SHA-256 和测试指南随原测试目录提供。

可执行文件为 `releases/v0.2.0/Paradox-Launcher-0.2.0-windows-x64.exe`，测试包为 `releases/Paradox-Launcher-0.2.0-windows-x64.zip`。最终 exe 已验证为 Windows x64 GUI 程序，大小 **25,362,432 字节**，SHA-256：

```text
b5d2f6027a33e640e6de66cf1e57c4e8f5b6fc33bcd3cec0311c2591cc998158
```

测试包包含 exe、许可证、构建元数据与测试说明。操作步骤见 v0.2 测试指南，实际校验结果见 验证记录。此前 v0.1 文件保留在 `releases/v0.1.0/`。

发布版内嵌前端，运行无需 Rust、Node.js 或 Vite。Windows 需要 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。安装游戏需要网络，启动 Minecraft 需要与该版本匹配的 Java；可以选择本地 Java，或下载启动器管理的运行时。

游戏或下载进行中默认询问关闭行为。「隐藏窗口，继续运行任务」会在任务结束后退出，再次打开同一 exe 可唤回窗口。改变游戏根目录不会自动迁移已有文件；导入的外部实例继续引用原目录。

## 开发与构建

环境要求：Rust **1.92.0**（`rust-toolchain.toml` 与 CI 固定此版本）、Node.js **22.13+ 或 24+**、npm、Windows WebView2 Runtime。Windows 编译需要 Visual Studio Build Tools 的 C++ 桌面开发组件、Windows SDK；当前 TLS 使用 native-tls / Windows schannel，无 AWS-LC TLS 编译依赖。

SDK 仓库 [3093FengMing/QuintElement](https://github.com/3093FengMing/QuintElement) 以 Git submodule 放在 `vendor/QuintElement/`，根 `Cargo.toml` 直接依赖 `vendor/QuintElement/crates/elemental`。首次克隆请使用 `git clone --recurse-submodules <启动器仓库地址>`；已有 checkout 先执行：

```powershell
git submodule update --init --recursive
```

核心联动开发在 `vendor/QuintElement/` 中进行，无需发布 crate。先提交并推送子模块中的核心修改，再在启动器仓库提交该子模块的新指针；CI 递归检出启动器记录的 SDK 提交。初始化通常使子模块处于 detached HEAD，开始开发前在子模块中创建功能分支。完整流程见 SDK 接入说明。

```powershell
npm ci
npm --prefix ui ci
npm run dev
```

仅前端预览使用 `npm run dev:ui`，地址为 <http://127.0.0.1:1420/>。网页模式将配置存放在浏览器本地存储，安装、启动、本地文件选择和 Java 检测仅在桌面版开放。两个模式的数据独立。

构建 Windows 可执行文件：

```powershell
npm run build -- --features tauri/custom-protocol -- --locked
```

输出为 `target/release/paradox-launcher.exe`。发布构建必须启用 `tauri/custom-protocol`，使前端资源内嵌；当前未启用系统安装包打包。

### Actions 编译成果

新增的 [Build 工作流](https://github.com/3093FengMing/Paradox-Launcher/actions/workflows/build.yml) 在 push、pull request 和手动运行时编译三平台 release 成果。打开对应运行记录，在页面下方 **Artifacts** 下载：

| Artifact | 编译成果 |
| --- | --- |
| `Paradox-Launcher-windows-x64` | Windows x64 `.exe`，需要 WebView2 Runtime |
| `Paradox-Launcher-macos-arm64` | Apple Silicon `.app.tar.gz`，解压后使用 `.app` |
| `Paradox-Launcher-linux-x64` | Linux x64 `.tar.gz`，解压后运行 `paradox-launcher`；需要与 Ubuntu 24.04 兼容的 WebKitGTK 4.1、GTK 3 等系统库 |

每份 artifact 附带 `BUILD-INFO.json`、`SHA256SUMS`、许可证与运行说明，文件名包含版本和平台；Actions 保留 14 天。前端已内嵌，运行不需要 Rust、Node.js 或 Vite。macOS 成果为未签名、未公证的 CI 测试构建；原有 CI 工作流继续负责质量检查。

`dev` 推送后自动构建；GitHub 网页的 **Run workflow** 手动入口在该工作流合入默认分支 `main` 后显示，也可以在已有运行记录中重新运行。

## 校验

```powershell
npm run lint:ui
npm run check:i18n
npm run test:ui
npm run build:ui
cargo fmt -p paradox-core -p paradox-launcher -- --check
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
```

网络目录查询不纳入常规单元测试。只读 SDK 诊断可使用：

```powershell
cargo run -p paradox-launcher -- --check-catalog
cargo run -p paradox-launcher -- --inspect
```

游戏兼容验证工具为 `crates/launcher-core/examples/verify_mvp.rs`，会真实下载并启动游戏，使用独立目录运行，步骤见测试指南。下载故障、路径与移除保护等测试的实际结果记录在验证文档中。

当前开发工作区的验证记录见 验证记录。v0.2 交付时为 55 项 core 与 6 项 desktop 测试通过，翻译检查覆盖 502 个资源键和 420 处静态翻译调用；Vite 主 JavaScript 产物为 627.11 kB，构建有非阻断的体积提示。

## 项目结构与数据

```text
apps/desktop/          Tauri 宿主、IPC、下载队列、窗口与游戏进程生命周期
crates/launcher-core/  配置、实例、网络、下载、Java、目录缓存与 QuintElement 适配
ui/                   React 页面、共享组件、状态 Hook、主题与 API adapter
assets/               原始矢量图标
vendor/QuintElement/  自有 SDK fork（Git submodule，独立 Cargo workspace）
.github/workflows/    质量检查与跨平台 CI 配置
```

启动器 workspace 只包含 `paradox-core` 与 `paradox-launcher`；SDK 保持独立 workspace，并通过子模块 path 依赖参与编译。Rust 格式命令明确指定这两个 package，前端执行 ESLint、类型、翻译和回归检查；SDK 自己的格式、测试和发布在其仓库独立维护。

前端依赖升级的兼容范围、TypeScript 编译 API 约束和图标职责见 [ui/DEPENDENCIES.md](ui/DEPENDENCIES.md)；内部文件名规则见 [Unicode 工具说明](ui/src/host/unicode/README.md)。

桌面默认配置为 `%LOCALAPPDATA%/ParadoxLauncher/config.json`，默认游戏根目录为同目录下的 `minecraft/`。游戏根目录包含 `versions/`、`assets/`、`libraries/`；显示名称与实例存储键分离，重命名不会移动存档。启动器管理的 Java 放在配置目录旁的 `runtimes/`。

开发测试可设置 `PARADOX_CONFIG` 指向独立配置文件。该变量只改变配置位置，游戏目录需在设置中另外指定。配置加载错误时 GUI 保持可达、显示原因并拒绝写入，以保留原文件。

开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。在 `dev` 分支开发，将可发布版本整合到 `main`。源码仓库为 [Paradox-Launcher](https://github.com/3093FengMing/Paradox-Launcher)。

## SDK、设计与许可

SDK 使用 [QuintElement fork](https://github.com/3093FengMing/QuintElement) 子模块的 `crates/elemental/`；启动器仓库记录的 gitlink 固定实际 SDK 提交。facade crate 仍为 `elemental-kit 0.2.0`，Rust 依赖别名 `elemental` 和应用适配器名称 `ElementalService` 保留，源码实际来自子模块。2026-11-08 已同步 [Elemental 上游主线 `540c3b3`](https://github.com/ElectronicWave/Elemental/commit/540c3b361e7d9796b1c04f5ec4992e19418a3bff)，固定 SDK fork 合并提交 [`92a4d18`](https://github.com/3093FengMing/QuintElement/commit/92a4d1848ab8840e29abd5d0c700b0089a58fb06)。本次接入 Minecraft 版本名称解析、新的凭据与启动命令 API，以及 launchpad CLI；启动器继续使用配置的网络客户端，并分别处理 JVM 与游戏参数。应用保留 Vanilla 下载引擎、加载器隔离 worker、网络与路径策略，并将 Forge / NeoForge 身份兼容修复迁入新扩展点。认证通过 `oauth2-reqwest` 统一为 reqwest 0.13，保留 native-tls / Windows schannel，已移除 helper 的 vendor 补丁；详见 [vendor/README.md](vendor/README.md)。SDK 部分 future 不满足 `Send`，宿主在后台线程创建和驱动这些操作，界面保持响应。

项目采用 **AGPL-3.0-only**，与 QuintElement / Elemental 保持一致。源码参考：[QuintElement](https://github.com/3093FengMing/QuintElement)、[Elemental 上游](https://github.com/ElectronicWave/Elemental)、[DeepWiki](https://deepwiki.com/ElectronicWave/Elemental)。此前 DeepWiki 请求返回 429，当前接口以本地 fork 源码为准。
