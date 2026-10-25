# 验证记录

更新日期：2026-10-26（Asia/Shanghai）。以下记录基于当前 Windows 开发机的实际结果。v0.2 功能测试版已完成构建与交付文件校验，原生视觉和跨平台发行验收的剩余范围单独列出。

## v0.2 原版运行矩阵

汇总记录为 `.test-data/v0.2-runtime-matrix.json`，验证工具使用 Rust 1.92.0，每组包含原始 JSON 与日志路径。四组均通过：两次游戏就绪由渲染、材质图集和声音引擎日志判定，自然退出记录的退出码为 0。日志证据不等同于游戏主菜单视觉截图验收。

| Minecraft              | Java | 首次实际传输     | 再次修复传输     | 两次启动与自然退出 | 状态               |
| ---------------------- | ---- | ---------------- | ---------------- | ------------------ | ------------------ |
| 1.12.2                 | 8    | 180,858,254 字节 | 0 字节，0 个文件 | ready=true，exit=0 | 通过               |
| 1.20.1                 | 17   | 623,394,062 字节 | 0 字节，0 个文件 | ready=true，exit=0 | 通过               |
| 1.21.1                 | 21   | 919,460,315 字节 | 0 字节，0 个文件 | ready=true，exit=0 | 通过               |
| 26.3，验证时最新稳定版 | 25   | 511,526,738 字节 | 0 字节，0 个文件 | ready=true，exit=0 | 兼容处理后复验通过 |

1.21.1 的完整安装位于 `.test-data/v0.2-中文路径 全新安装/`。报告确认游戏目录初始为空，安装 3,960 个文件，再次修复复用全部文件；两次自然退出耗时分别为 72 与 113 秒。该报告同时记录实际下载并校验 Adoptium Java 21 JRE，实际传输 48,999,141 字节，检测主版本 21，并成功用于游戏启动。旧失败或中断记录保留在历史目录。

26.3 最初因元数据的 `natives/java` 与 SDK 实际解压目录 `natives/` 不一致而退出，原失败记录保留。应用在启动命令中追加实际原生库搜索目录后，两次启动均日志就绪并自然退出，耗时分别为 178 与 203 秒。复验安装及再次修复传输均为 0 字节，首次安装传输量单独保留，避免将复用安装误记为全新下载。

Windows OpenGL 游戏截图曾超时，因此当前矩阵证明安装、运行日志就绪、自然退出和文件复用；原生游戏主菜单的视觉截图未完成。

## v0.2 最终质量与交付复核

| 检查                                | 当前状态                   | 范围 / 证据                                                                                                                          |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 版本统一 0.2.0                      | 通过                       | Cargo workspace、Tauri、根 / UI package 与锁文件；locked 检查通过                                                                    |
| Web 格式、ESLint、TypeScript / Vite | 通过                       | 最终 `format:check`、`lint:ui`、TypeScript 与 Vite 生产构建                                                                          |
| Rust 格式、check、Clippy            | 通过                       | `cargo fmt`、workspace all-targets check / Clippy，locked，warnings 作为错误                                                         |
| Rust 单元与异步故障测试             | 61 项全部通过              | 55 项 core + 6 项 desktop，覆盖配置、预设严格校验与磁盘持久化、路径、移除保护、缓存、网络、下载故障 / 取消 / 复用、Java 包校验与队列 |
| i18n 资源与运行时                   | 通过                       | 502 个资源键、420 处静态翻译调用；30 项运行时检查覆盖系统语言响应、切换、复数、错误翻译与旧配置迁移                                  |
| 外观预设与双语浏览器交互            | 通过                       | 预设 CRUD、JSON 导入 / 导出、复制、语言切换与重载、外观重载、草稿隔离及 320 × 240 / 120% 无溢出                                      |
| 下载队列事件与 Java 自动刷新        | 代码审查 / 静态检查通过    | 先订阅再快照、过期快照排除、并发检测合并、任务期间按钮状态；原生并发操作尚未单独复验                                                 |
| 原生 Tauri 窗口                     | 基本键盘交互通过           | 实例首页、Tab / Enter 打开设置、最大化 / 还原、切现代样式保存与空闲关闭                                                              |
| 原生样式持久化                      | 通过                       | 交付目录 exe 重启后恢复已保存的现代工作台；新增预设 / 双语已完成浏览器和存储测试，尚未完整原生交互复验                               |
| 原生弹窗与文件选择                  | 尚未完整覆盖               | 鼠标操作受工具几何错误限制；全部弹窗与文件选择器留待后续原生验收                                                                     |
| 游戏期间关闭行为                    | 功能已实现，实际行为待补充 | 返回启动器、隐藏继续、停止并退出、失败时保留窗口                                                                                     |
| 路径与配置错误                      | 通过已列范围               | 中文 / 空格全新安装、最终 exe 切换已安装 / 空目录、损坏配置退出并保留文件；只读配置写入失败由真实文件测试覆盖                        |
| custom-protocol release             | 通过                       | `npm run build -- --features tauri/custom-protocol -- --locked`，固定 Rust 1.92.0，包含预设与双语资源                                |
| 独立 v0.2 exe / CLI / PE / SHA-256  | 通过                       | 最终产物大小、SHA-256、Windows x64 GUI PE 与 5 组 CLI 检查已归档                                                                     |

Vite 最终 JavaScript bundle 为 627.11 kB，产生体积提示，构建成功。Rust 和 CI 固定使用 1.92.0；功能实现、代码检查和运行验收分别记录。

## v0.2 交付文件

最终 exe 为 `releases/v0.2.0/Paradox-Launcher-0.2.0-windows-x64.exe`，包含外观预设和简体中文 / English 资源，大小为 **25,362,432 字节**。PE machine 为 `0x8664`，GUI subsystem 为 `2`。SHA-256：

```text
b5d2f6027a33e640e6de66cf1e57c4e8f5b6fc33bcd3cec0311c2591cc998158
```

2026-10-26 对最终文件执行的只读 CLI 检查全部符合预期：`--version` 输出 `Paradox Launcher 0.2.0`；已安装测试目录的 `--inspect` 返回 1 个 Vanilla 实例，切换空目录返回 0 个；损坏配置退出码为 1 且原文件 SHA-256 保持不变；`--check-catalog` 返回 920 个版本，首项为 26.3。所有检查均保留配置原文件，记录位于 `.test-data/v0.2-cli/final-report.json`。

测试包为 `releases/Paradox-Launcher-0.2.0-windows-x64.zip`，包含 exe、许可证、测试指南、预设与多语言说明、验证记录和构建信息。`build-info.json` 与 `SHA256SUMS.txt` 随 exe 提供；包内不包含测试游戏、Java 运行时或个人配置。此前 v0.1 exe 保留在独立交付目录。

## v0.2 外观预设与多语言验收

首批语言为简体中文、English 和跟随系统，翻译资源内嵌，无需联网。浏览器实际验证了即时切换、保存后重载恢复、中文 / emoji 预设命名、重命名、导出全部 11 个外观字段和复制反馈。无效 JSON 显示本地化错误并保留弹窗；有效导入生成新预设；应用预设改变风格、颜色与模糊，保存后重载恢复。

预设库操作不会提交尚未保存的语言或其他设置。验收中，英文已保存、中文仍为草稿时重命名预设，重载仍恢复英文；取消移除保留记录，移除全部测试预设后重载为空库，当前外观继续保留。后端严格验证完整预设字段、UUID 语义重复和数量 / 名称限制；真实磁盘测试确认非法数据或写入失败保留原配置。

浏览器覆盖 640 × 480 与 320 × 240。在 320 × 240、120% 缩放下，document 无横纵溢出，预设卡片和设置面板无内部横向溢出。正文保持独立滚动。实际截图为 `docs/screenshots/v0.2-presets-en.jpg`（英文沉浸式）和 `v0.2-presets-zh.jpg`（中文现代工作台）。使用与格式见 [CUSTOMIZATION-I18N.md](CUSTOMIZATION-I18N.md)。

这批新增交互由浏览器及存储测试覆盖；最终 exe 的完整预设 / 双语原生交互尚未单独复验。

## v0.2 原生桌面交互记录

使用正式构建 exe 加载测试配置，首页显示已有测试实例。通过 Tab / Enter 进入设置；键盘调用最大化后 OS 无障碍窗口按钮变为 Restore，还原后变回 Maximize，确认原生窗口状态实际改变。

切换为现代工作台并保存，配置文件的 `appearance.interface_style` 确认为 `modern`。空闲状态按 Alt+F4 后测试进程 78304 已退出，确认正常关闭。从交付目录重新启动后，现代工作台正确恢复，确认原生样式持久化。全部弹窗与运行期间关闭行为尚未完整验收。

原生截图捕获仍超时，鼠标点击返回 geometry unavailable。已取得的无障碍状态、键盘交互和配置文件结果可证明上述操作，完整视觉截图与鼠标拖动任意尺寸尚未覆盖；高 DPI 与全部尺寸矩阵安排在后续发行验收。

## 此前 v0.1 与双样式结果

v0.1 已完成格式、ESLint、TypeScript / Vite、Cargo check、Clippy 与 7 项配置 / 领域单元测试。正式 custom-protocol Windows x64 exe 为 22,462,464 字节，PE machine 0x8664、GUI subsystem 2；交付文件 `releases/v0.1.0/Paradox-Launcher-0.1.0-windows-x64.exe` 的 SHA-256：

```text
b56b3626778fddfb5c2501e0010d50e4c77d6e9ad4e062460d574d7821207aa9
```

该 exe 的 `--version`、`--inspect`、`--check-catalog` 已验证，目录查询取得 920 个版本。损坏配置的 CLI 检查失败退出且保留原文件。上述属于历史构建；最终 v0.2 的独立结果见交付文件章节。

浏览器已验证双样式切换与保存、创建 / 重命名、Escape 与焦点返回、外观滑块、主题、紧凑侧栏和真实目录查询。窗口适配检查覆盖 1240 × 720、980 × 600、320 × 240 和 120% 缩放：document 无横纵溢出，正文滚动时标题栏 / 侧栏稳定，切页重置正文位置。

历史浏览器截图保存在 `docs/screenshots/immersive.png`、`modern.png`、`appearance.png`、`immersive-minimum.png` 和 `scrolling-modern-980x600.png`。实例为浏览器验证数据，首次启动桌面程序保持空实例库。浏览器翻译扩展浮标不属于启动器界面。

## 尚未覆盖的发行范围

- Windows 高 DPI、多显示器及全部缩放比例的完整视觉矩阵。
- Linux / macOS 原生桌面与 Java 下载；目前自动 Java 下载开放 Windows x64 / ARM64。
- 所有代理、镜像服务与实际网络环境；当前镜像要求兼容 Mojang 元数据、assets 和 maven 路径。
- Microsoft 正版登录、loader、整合包、自动更新、代码签名和系统安装包；这些功能属于后续里程碑。
- GitHub Actions 远程运行结果；存在 CI 配置不代表远程平台已经通过。

## 复现

```powershell
npm ci
npm --prefix ui ci
npm run format:check
npm run lint:ui
npm run check:i18n
npm run build:ui
cargo fmt --all -- --check
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
npm run build -- --features tauri/custom-protocol -- --locked
```

游戏矩阵工具会下载并运行真实游戏，使用独立绝对目录，按 [v0.2 测试指南](TESTING-v0.2.md) 操作。桌面 `PARADOX_CONFIG` 与网页预览本地存储相互独立；指定配置路径后也应显式设置测试游戏根目录。
