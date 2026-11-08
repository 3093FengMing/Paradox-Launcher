# UI 套件验证

当前两套默认来源均已完成重设计：首次普通启动需明确选择，默认界面均无图片背景，所有玩家页和弹窗由各自套件源码提供。每套为 85 个文件描述、43 个视图、9 个路由、0 个内置素材。当前源码、编译后 CSP 与本人原生验收按 [默认 UI 重设计验收](TESTING-UI-REDESIGN.md) 记录；本文件中的历史验收结果保留其对应源码的含义。脚本定位可编辑源码使用当前草稿 `manifest.views`。

开发版本：`0.4.0-dev`；更新日期：2026-11-08。使用格式、容量和受支持语法见 [UI-CUSTOMIZATION.md](UI-CUSTOMIZATION.md)。

本文件描述当前套件协议和可复现入口。历史构建的通过数量、截图、主资源与二进制保留各自版本含义。当前自动检查分别记录开发、编译后实际 CSP、普通生产、Rust 和嵌入前端二进制的来源、退出值与 SHA-256；真人原生验收单独记录。

## 自动检查

在仓库根目录运行：

```powershell
npm run test:ui
npm run check:ui
npm run lint:ui
npm run check:i18n
npm run build:ui
cargo test --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt -p paradox-core -p paradox-launcher -- --check
```

Node 链保留业务取消、配置重载、账户、加载器、参数模板、日志与个性化检查；新套件 model/compiler/ownership/builtins/editor 生命周期覆盖边界、CAS、Original、作用域与晚到结果。CSS inline 加载器剥离仅 CSS 的查询后缀，并保留可执行查询 specifier 的失败控制。Rust 套件测试覆盖独立库、容量、CAS、原子保存和 raw recovery；`ui_safe` 测试只证明安全 URL/已有窗口导航处理。

Windows 图形构建使用 MSVC、Windows SDK 和 native-tls/schannel。当前依赖不需要 AWS-LC TLS/CMake；Cargo 检查保存实际 locked/offline Windows normal/build/dev 图，核对没有 aws-lc-sys/aws-lc-rs/ring/rustls/hyper-rustls/tokio-rustls/openssl-src，且存在 native-tls/schannel。新增 feature 构建另存精确 feature 图；不同 feature 或来源需要重新核对依赖。

## 浏览器矩阵

`foundation-test` 编译模式包含测试观察器；普通生产不会安装测试 globals。观察器读取真实默认入口的同一控制器和业务动作。浏览器使用独立数据与 Chromium 上下文，持久化回归分别经过真实 IndexedDB 或捕获桌面边界；未访问用户原生配置。

```powershell
# ui/ 中启动独立服务，端口应选择空闲值
npm exec vite -- --host 127.0.0.1 --port 1433 --strictPort --mode foundation-test
# 根目录另一个终端
$env:PARADOX_UI_URL='http://127.0.0.1:1433'
node ui/scripts/check-ui-final-browser.mjs
node ui/scripts/check-ui-customization-browser.mjs
node ui/scripts/check-ui-foundation-browser.mjs
node ui/scripts/check-ui-foundation-review-browser.mjs
node ui/scripts/check-ui-notices-browser.mjs
node ui/scripts/check-ui-suite-storage-browser.mjs
```

编译后测试先用 `vite build --mode foundation-test --outDir <独立输出>`，服务该实际输出，再设置 `PARADOX_TEST_NATIVE_CSP=1`。脚本把 `apps/desktop/tauri.conf.json` 的实际 CSP 加入文档响应，保留 startup page errors/CSP violations 和请求记录，要求没有 /src/ 或 /node_modules/ 请求。普通生产另行构建并测量入口、chunk、预加载和实际启动请求；默认可信套件也需要编译器，旧“未启用时零编译器请求”结论不能沿用。

最终套件检查包含 `custom_editor_then_recovery`、`complete_suite_switch_keeps_controllers`、`old_namespace_untouched`：正常 editor 自我替换、CSS 更新同组件/DOM、隐藏 CSS 与真实错误、固定 Recovery 原字节导出、同控制器修复、两套完整切换不重启业务服务，以及新库操作不改动任何旧命名空间字节。

完整 custom-source 脚本保留 Preview/Save/reload、单实例及原生选取、源导入/下载字节、HTML Original 与业务新建、弹窗草稿/样式根、三个卡片 wrapper、原生 props/事件、账户/下载/日志/所点实例内容导航、语法位置诊断、CSS-only 本地输入、raster/危险源拒绝、禁用代码、渲染回退、隐藏 CSS/F12、raw library 备份/导出、safe startup 和 320×240 Save 实际点击。

Foundation/review 保留 ShadowRoot Select/Escape/Tab、原 Profile 输入与 editor 源草稿、控件值/有效性/回调、两主题/两根/尺度、源文本选择与拖动排除。中键测试后 Escape 结束 Chromium 自动滚动，再测试独立双击序列。Notice 检查保留 2999/3000 与 4999/5000 TTL、hover/focus leases、独立 expiry、卸载释放、持续诊断，以及 320×240 空/非空诊断、可编辑源码、实际 Save、四个保留 alert 及可达关闭按钮。普通编辑器 Dialog.Portal 的来源样式为通知提供底部 70px 与 max-height calc(100dvh - 130px)，基础默认仍为 20px/50dvh。

自动检查保留独立命名的输出、源码哈希、时间、退出值、报告和下载。替换构建前保存原产物；当前编译结果单独记录输入与输出哈希，确认来源未漂移。最终空白清理后，开发与实际 CSP 编译后均重新执行 final-browser、Inspector overrides 和完整 customization；下载队列另用真实当前自动位置验证 CSS 隔离及 TSX Original 的保存重载、事件和回调。旧失败及按精确执行依赖核对后复用的九份 Foundation 记录分别保留，完整范围见默认 UI 重设计验收。

## 用户本人原生验收

自动完成后，用当前来源、feature、CSP 和哈希对应的 `target/debug/paradox-launcher.exe` 进行人工验收，核对其实际编译结果与构建记录。

1. 启动普通界面，切换 modern/immersive；保留设置、账户和查询草稿，核对业务动作。
2. Ctrl+Shift+F11 打开真实正常 editor，复制套件并修改来源；预览与保存、关闭/重开、选取/Escape 和 Profile 草稿/焦点。
3. 标题空白左按拖动并观察窗口位置变化；右/中键和 Close/Select/checkbox/输入/源文本选择不拖动；空白双击最大化。
4. 在 320×240 与实际 DPI 下编辑源码、展开诊断、保留四个通知，点击 Save 与每个关闭按钮。
5. 替换正常 tool.editor；用隐藏 CSS 和抛错来源使普通 UI 不可用，Ctrl+Shift+F12 打开固定 Recovery，导出精确原字节并打开默认 editor 修复同一草稿。
6. 关闭后使用 `--ui-safe`，确认用户来源在工厂执行前被跳过；导出、确认重置、备份与旧命名空间不变。

这些手动项目当前属于用户验收，浏览器 invoke spies 和 Rust URL tests 不代表真实位移/最大化/WebView2 焦点或平台信任等价。


## 文件覆盖整套自动回归

`node scripts/check-ui-inspector-overrides-browser.mjs` 在实际默认入口和同一控制器运行 `pick_edit_preview_save_reload_export`：真实侧栏账户位置拾取、CSS 精确位置与 type 扩大、成功预览后的当前 DOM、保存后实际页面重载、真实 ZIP 导出/重导入。它再次替换普通 editor 的公开来源布局完成同一旅程，并检查 HTML / TSX 业务 props、事件、ref、Original、准确重置与保留普通文件、两种语言/主题、320×240 可达 Save 和固定 Recovery 原字节导出。窗口桌面 IPC 使用浏览器边界替身，结果属于自动浏览器证据。

开发使用 `--mode foundation-test`，编译使用同一模式并通过 `PARADOX_TEST_NATIVE_CSP=1` 注入 `apps/desktop/tauri.conf.json` 的当前 CSP。foundation、suite、inspector 是三组现有回归脚本；编译测试结果与普通发行构建、原生 debug 二进制 provenance 分别记录。`npm run test:ui` 包含业务 Node 回归；Rust 测试和 Clippy 前必须核对实际 locked Windows normal/build/dev feature graph 为 native-tls/schannel 且无 AWS-LC、ring、rustls。

`ui-framework-select.png`、`ui-framework-inspector.png`、`ui-framework-picker.png` 与 `ui-framework-editor-320x240.png` 是当前 headless 浏览器自动截图，不是原生窗口验收。人工验收由用户完成：真实窗口拖动与焦点、F12/Escape 取消、`--ui-safe`、正版账户/游戏身份和真实 WebView2 在本机的视觉表现。
