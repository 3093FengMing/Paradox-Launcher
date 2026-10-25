# 验证记录

记录日期：2026-10-25。环境为当前 Windows 开发机；Rust / Cargo 1.92、Node.js 24、npm 11。下表明确区分此前已取得结果与双样式集成后的复核。

## 已取得的结果

以下结果来自新增沉浸式界面之前的基础框架验证，不能直接代替最新源码的检查结果。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 前端 TypeScript 与 Vite 生产构建 | 通过 | 当时的现代工作台、设置、Base UI Dialog 与 Sonner 集成 |
| `cargo check --workspace --all-targets` | 通过 | SDK 固定提交与 vendor 兼容补丁可编译 |
| Clippy，warnings 作为错误 | 通过 | 当时的 workspace 源码 |
| `cargo test --workspace --all-targets --locked` | 7 项通过 | 配置与领域逻辑；不包含游戏安装启动 |
| `--check-catalog` | 获取 920 个版本 | 真实 Elemental / Mojang 目录请求 |
| `--inspect` | 默认游戏目录正常，0 个实例 | 真实 SDK 磁盘扫描；当时没有游戏安装 |
| 原生桌面窗口 | 启动成功，可读取 UI 无障碍树 | Tauri 应用实际运行；当时的旧界面版本 |
| 现代工作台截图 | 已保存 `docs/screenshots/home.png` | 浏览器中实际渲染的宽视口界面 |
| 设计技能安装 | 15 个技能已安装 | `emilkowalski/skills@2d228630ba1446365f614a108cb8252f1feda202` |

原生截图 / 部分自动化点击曾受工具超时或 geometry unavailable 限制。这个限制没有否定原生窗口的成功启动，也不能算作原生交互验收通过。

## 当前双样式集成复核

本轮新增 `Appearance` 字段、沉浸式布局、自绘标题栏和窗口权限，并修复主动停止的完成状态。本轮复核结果如下：

| 检查 | 当前结果 | 需要保留的证据 |
| --- | --- | --- |
| `npm run build:ui` | 通过 | 最终 TypeScript 与 Vite 生产构建完成 |
| `cargo fmt --all -- --check` | 通过 | Rust 格式检查完成 |
| `cargo check --workspace --all-targets --locked` | 通过 | 新模型、窗口权限和进程命令可编译 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 通过 | 无 warnings |
| `cargo test --workspace --all-targets --locked` | 7 项通过 | 配置、路径安全、领域逻辑与版本排序 |
| 浏览器双样式切换与保存 | 通过 | 切换并保存两种布局，重载保留样式和实例 |
| 实例菜单与创建 / 重命名弹窗 | 通过 | 两个中文名称实例；菜单选择、Escape 关闭与焦点返回；方向键和 Enter 打开创建表单 |
| 背景效果、主题与紧凑侧栏 | 通过 | 三个滑块改变 CSS 变量并保存；背景开关、浅色 / 深色、紧凑侧栏切换 |
| 浏览器最小桌面尺寸 | 通过 | 980 × 700，documentElement 无横向溢出；仅网页预览 |
| 最新原生桌面版本 | 仅确认启动 | 已读取最新界面无障碍树；按用户要求暂停原生渲染与窗口控制验收 |
| 本地 Git 基线 | main 初始提交 | 用 `git log -1` 查看；项目未配置远程 |

截图保存在 `docs/screenshots/immersive.png`、`modern.png`、`appearance.png` 和 `immersive-minimum.png`。
截图来自浏览器实际渲染；其中两个实例仅为浏览器本地预览数据，初次运行桌面启动器仍为空实例库。
浏览器截图中的翻译扩展浮标来自测试浏览器，不是启动器组件。

## 尚未完成的验收

- 没有在干净目录完成完整 Minecraft 下载、Java 启动、退出与再次启动闭环。
- 没有实际验证主动停止游戏、崩溃退出与停止失败的运行时行为；修复目前属于代码层面的实现。
- 原生窗口渲染和窗口按钮操作按用户要求留到后续，不作为本轮验收项。
- 没有完成长实例名称、所有缩放比例和高 DPI 的视觉兼容矩阵。
- 没有完成 Java 8 / 17 / 21、路径含中文 / 空格、权限不足、网络中断的兼容矩阵。
- 没有验证 Microsoft 登录、loader、整合包或 Java 自动下载，这些功能仍在路线图中。
- Windows / Linux / macOS 的 CI 已配置，但没有远程运行结果；没有完成系统安装包或高 DPI 的全面验收。

## 复现方式

```powershell
npm ci
npm --prefix ui ci
npm run build:ui
cargo fmt --all -- --check
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
```

SDK 只读检查：

```powershell
cargo run -p paradox-launcher -- --check-catalog
cargo run -p paradox-launcher -- --inspect
```

桌面验证使用 `npm run dev`；仅前端使用 `npm run dev:ui`。可设置 `PARADOX_CONFIG` 为独立配置文件，网页预览则使用浏览器本地存储，两者的数据相互独立。
