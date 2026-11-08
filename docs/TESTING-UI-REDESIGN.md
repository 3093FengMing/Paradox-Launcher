# 默认 UI 重设计验收

本轮针对 `0.4.0-dev` 的两套默认来源。沉浸式参考 [HMCL](https://github.com/HMCL-dev/HMCL) 的上下文导航、紧凑列表和启动区；Modern 使用固定导航与实例工作台。两套均使用纯色底面，不提供或消费默认图片背景，包括旧 `world.svg` 和 `landscape.svg`。用户已有的配置、账户、游戏、素材和套件父快照继续保留。

当前状态（2026-11-08）：两套默认来源已实现，最终空白清理后的源码已完成自动复验。类型、lint、翻译、Node、构建、完整开发／实际 CSP 编译后矩阵、减少动效、编辑器和普通生产入口检查均已通过，当前 Windows debug 构建已生成。下表区分本轮实际重新运行与按执行依赖、源码输出等价性核对后复用的补充证据；需要本人操作的原生项目继续单独列为待验。

## 页面与操作

首次普通启动在窗口内展示沉浸式与 Modern 的静态预览。选中选项后必须明确确认才保存；准备、编译或保存失败时保留选择并允许重试。正常重启采用已保存套件。安全启动与损坏数据恢复不自动消费首次选择。

| 页面 | 路由 | 主要验收点 |
| --- | --- | --- |
| 首页 | `home` | 无实例、未选实例、安装、修复、启动中、运行中、停止；实际账户摘要 |
| 实例 | `instances` | 搜索、扫描、导入、查看详情与设为当前实例分别操作 |
| 实例详情 | `custom.instance-details` | 明确 `profileKey`，缺失身份不回退；设置摘要、实际本地内容、任务和全局日志入口 |
| 游戏版本库 | `custom.versions` | 搜索、类型、缓存来源、刷新失败、创建草稿，所有版本可继续加载 |
| 下载任务 | `downloads` | 全部状态、未知总量、错误、取消、重试产生实际新任务 |
| 账户 | `accounts` | 一个离线名设置、Microsoft 身份、刷新、登出、过期和错误恢复 |
| 资源发现 | `content` | 分类、搜索空态与错误、实际安装目标、安装时校验兼容 |
| 设置 | `settings` | 外观、游戏/Java、高级；同一草稿、保存中与失败、套件和编辑器入口 |
| 日志 | `logs` | 全局范围、级别/文本过滤、跟随、可选择文字、导出、清除 |

九类业务弹窗为创建/重命名实例、实例设置、导入实例、移除实例、运行中关闭窗口、启动账户选择、Microsoft 登录、外观预设、参数模板。另检查内容移除和登出确认。提交中的关闭、Escape、初始/返回焦点和嵌套 Select/Menu 必须遵守原业务守卫。

## 自动验收

完整输出和截图归档于 `.test-data/ui-redesign/`，分别保存 `dev`、`compiled`、`production` 和 `native`。早期分项证据只证明当时源码，不替代最终冻结源码的验收。

根目录运行：

```powershell
npm run check:ui
npm run lint:ui
npm run check:i18n
npm run test:ui
npm --prefix ui run test:suite
npm run build:ui
```

浏览器检查使用项目现有 Playwright 工具入口，不增加生产依赖。两个独立开发服务分别采用 `foundation-test`（1433）和 `suite-builtins-test`（1434）模式；各脚本使用 `PARADOX_UI_URL` 选择对应服务。测试必须操作该模式现有的实际应用 root、永久业务 owner 和公开 actions，错误/延迟从原生 invoke/event 边界注入，不合成另一个业务 snapshot。

完整重设计入口先执行首页、实例、版本/下载、账户/发现、默认设置、弹窗、日志/响应式七个专项脚本，再执行两套 × 两个主题 × 三个应用缩放 × 三个窗口尺寸的 36 个独立上下文。每个矩阵上下文包含 14 类状态场景、九类业务弹窗和真实导航/键盘操作；主屏 100% 的四个上下文另完成来源定制旅程及两种减少动效用例。主矩阵尺寸为 1240×780、640×480 和 320×240，960×640、800×600 等额外布局由专项脚本覆盖。

在 `ui` 目录启动 suite-builtins 服务：

```powershell
npm exec vite -- --host 127.0.0.1 --port 1434 --strictPort --mode suite-builtins-test
```

另一个终端在仓库根目录运行全部专项和矩阵：

```powershell
$env:PARADOX_UI_URL='http://127.0.0.1:1434'
$env:PARADOX_SUITE_BUILTINS='1'
npm --prefix ui run test:redesign-browser
```

若当前工具环境未自动找到 Playwright，可将 `PARADOX_PLAYWRIGHT_MODULE` 指向已有模块路径。最终完整验收清除所有 focused/matrix 子集筛选变量，不以单行定向证明代替 36 个上下文。

| 验收层 | 要求 | 当前最终状态 |
| --- | --- | --- |
| 静态、类型、翻译、Node、构建 | 全部必需命令退出 0；两份清单的实际来源 bytes/SHA 匹配 | 六项命令均退出 0；两套各 85 files /43 views /9 routes /0 assets，170 个来源长度与 hash 匹配 |
| 开发浏览器 | 两套 × 深浅主题 × 全页/主要状态；中文、英文和键盘操作 | Foundation 的 final-browser、Inspector overrides、customization 三脚本重新运行退出 0，其余九份检查经源码和执行依赖核对后复用；最终七组 focused 与 36 个矩阵上下文重新运行均退出 0，输入无漂移 |
| 小窗与应用缩放 | 1240×780、960×640、800×600、640×480、320×240；合法 `ui_scale` 85/100/120 | 每种模式的专项 540 个布局、90 个键盘检查及矩阵 2016 条实际可达性记录均通过，无水平溢出 |
| 编译后浏览器 | 测试模式独立编译，注入实际 Tauri CSP；无 `/src/` 或 `/node_modules/` 请求 | Foundation 三脚本重新运行退出 0，其余九份检查按独立复用审查保留；套件八个上下文、最终七组 focused 与 36 个矩阵上下文重新运行均退出 0；CSP 精确匹配，无页面错误、违规或源码请求 |
| 普通生产入口 | 真实 `ui/dist`；无测试 globals/fixture 安装器、页面错误或 CSP 违规 | 三个全新普通生产上下文通过；错误、CSP、源码及外部请求守卫均通过 |
| 完整套件编辑 | 两套复制、CSS/HTML/TSX、Original、普通编辑器、预览/保存/重启、导出重导入、F12/安全恢复 | 开发与编译后 Foundation 的完整定制脚本均退出 0；每种模式四次完整矩阵定制旅程及四份实际导出 ZIP 均通过 |
| Rust | 已记录的 253 通过、0 失败、2 既有 ignored；最终输入 hash 一致才复用 | 46 个 Rust 文件和六项构建输入 hash 全部一致；复用 tests/Clippy/fmt 退出 0 的记录，vendor 干净 |
| 当前原生构建 | 当前源码的内嵌前端 debug exe、完整构建日志、输入/输出 hash | 构建退出 0；389 个输入无漂移；真人验收另列 |

编译后检查分别使用 `foundation-test` 和 `suite-builtins-test` 的独立产物，通过 preview 服务运行。设置 `PARADOX_TEST_NATIVE_CSP=1` 使用 `apps/desktop/tauri.conf.json` 的实际策略。不能用开发服务加 CSP 标志替代编译后证据。普通发行入口另外检查所有测试 globals 均不存在。

当前 Foundation 的三脚本开发复验为 `dev/browser-batch/foundation-2026-11-08T04-53-12-946Z/batch.json`，编译后复验为 `compiled/browser-batch/foundation-2026-11-08T05-02-34-898Z/batch.json`；两者均为 final-browser 7 组、Inspector overrides 4 组、customization 15 组退出 0，425 个运行输入无漂移。旧完整 12 脚本开发记录 `dev/browser-batch/foundation-2026-11-08T02-18-34-612Z/batch.json` 和编译后记录 `compiled/browser-batch/foundation-2026-11-08T02-47-49-977Z/batch.json` 均保留。其余九份执行脚本及本地 Node 依赖字节未变，玩家来源的普通输出与 CSS 等价，且不依赖本次三个偏移的自动位置；源包的实际字节变化已独立记录，不把旧批次标为当前源码的新运行。新编译后套件为 `compiled/browser-batch/suite-2026-11-08T04-52-34-974Z/batch.json`，八个上下文通过，含 40 项通知与暂停租约检查；新普通生产为 `production/browser-batch/production-2026-11-08T04-54-36-158Z/batch.json`。这些路径均相对本地 `.test-data/ui-redesign/`。

最终开发矩阵为 `dev/browser-batch/redesign-2026-11-08T04-51-28-954Z/batch.json`，编译后矩阵为 `compiled/browser-batch/redesign-2026-11-08T04-56-42-584Z/batch.json`。每种模式均为七项专项退出 0、128 个专项检查组、36/36 矩阵通过、872 个矩阵检查、1636 张实际截图和 2016 条矩阵可达性记录；所有记录的截图 SHA 与原文件一致。两条运行均自然退出 0，425 个运行输入无漂移，全部自有浏览器上下文已关闭。当前独立总验收记录在本地 `.superpowers/sdd/2026-11-07-default-ui-redesign/staged-whitespace-independent-sol/`，两条清理前 03:35/03:33 的完整通过仍只属于各自历史来源字节。

较早的失败、停止运行及通知补充记录继续保留其真实结果，不能视为完整通过。通知补充仍为 3 PASS /1 late-ID assertion FAILED，该失败未捕获完成时间，不能精确证明自然 TTL；最终 Foundation 的实际通知生命周期回归与套件通知租约检查均已通过。最终三份 Node 脚本（矩阵 runner、场景 helper 和 Home 专项）只修正真实页面/tab、取消登录 ACK 与 terminal、持久诊断历史、当前可见详情控件及菜单关闭/回焦终态等测试前置，全部业务断言和覆盖范围保留。Home 的原始即时断言失败也保留；五个终态等待已独立审查、实际整合，并由上述两条新完整运行验证。Foundation、生产和原生构建不执行或导入这三份脚本。本次空白清理后的 UI 六命令、两种测试模式构建、原生构建、套件与生产检查均重新执行；Foundation 九份补充复用的边界另有独立核对。暂存检查曾实际捕获新文件行尾空白，已按精确字节清理，不改变 Git 检查政策。

当前自动位置补充检查另在开发与实际 CSP 编译后完成下载队列的 TaskActions、TaskProgress、TaskDetails 三处位置共八次真实 DOM 拾取（每 lane 8 次）、精确 CSS 覆盖及其它任务隔离。TaskActions 还通过真实普通编辑器创建 TSX 入口，执行 `<Original {...props}/>`，核对调用来源、完整位置与下载身份，并完成 Preview、Save、实际页面重载、原生事件、取消原任务和重试产生新任务。覆盖后同一目标有调用源码与覆盖文件多个来源，检查器返回多来源说明；结构来源重新安装可以更新临时挂载编号和原生详情展开态，持久位置仍以完整 selector 为准。检查通过真实详情控件展开并等待可见 DOM 消息更新。原单一来源、跨结构替换保持临时编号及展开态的假设导致的补充检查失败保留，V4 另因直接比较 JSON 属性插入顺序误判完整 selector，失败记录保留；V5 改用生产 canonical selector 比较，保持全部属性值及数组顺序，按实际合同完成全部旅程。仅 CSS 阶段继续严格核验 DOM 保留；业务草稿、同页永久 controller 和来源守卫全程保持一致。

默认来源的全页、导航、控件、弹窗、首次选择、通知、加载/错误与普通编辑器均可定制；唯一固定工具是 Recovery。仅 CSS 预览保留真实输入 DOM；TSX/HTML 的 Original 保留回调、ref 与业务草稿。切换套件时不增加 Provider、IPC 订阅或业务队列。

减少动效独立覆盖应用开关与操作系统偏好，每个深浅主题、每套默认来源分别运行两个独立用例。最终开发和实际 CSP 编译后共八个主屏上下文、16 个完整用例、10,368 个可见元素及伪元素样本通过，动画与过渡持续时间均为零；真实 ProfileDialog 外部 Portal 的 backdrop/popup 另有独立核验。每个用例恢复原配置、主题、缩放、系统偏好与路由，永久 owner 保持一致。

当前 debug 应用为 `target/debug/paradox-launcher.exe`，43,617,280 bytes，SHA-256 为 `46ECC856E8696C1A63626DF20A12D33EC8A70342E12E30E0E5EF1EE2A79CCBD3`。对应构建记录位于本地 `.test-data/ui-redesign/native/native-whitespace-final/`，包含源码输入、内嵌前端文件、构建输出和完整日志；该目录另存同一构建的 `Paradox-Launcher-UI-Redesign-debug.exe`。构建命令 `npm run build -- --debug --no-bundle` 退出 0，389 个输入无漂移。Vite 仍报告已有的配置导入与大 chunk 提示；本轮没有变更依赖或 vendor。

## 本人原生验收

以下检查需要使用本轮当前构建的 Windows WebView2 应用。浏览器边界模拟和 Rust 测试不能标为这些项目通过。记录构建路径、SHA-256、Windows 显示缩放与实际结果；尚未记录的项目保持待验。

| 项目 | 实际操作 | 结果 |
| --- | --- | --- |
| 标题栏 | 鼠标拖动、双击最大化/还原；按钮、输入、复选框和文字选择不触发拖动 | 待本人验收 |
| 键盘与焦点 | Tab、Escape、嵌套菜单、关闭返回焦点、Ctrl+Enter、Ctrl+Shift+F11/F12 | 待本人验收 |
| DPI 与语言 | Windows 100/125/150/200% DPI；中文/英文；窄窗能滚动到关键操作 | 待本人验收 |
| Microsoft 账户 | 设备代码授权、实际账户刷新/切换、游戏身份和登录取消/过期恢复 | 待本人验收 |
| 游戏与窗口关闭 | 实际安装/修复、启动、停止；运行中停止退出、后台继续、留在窗口 | 待本人验收 |
| 来源恢复 | 普通编辑器定制、损坏/隐藏来源后 F12、原始导出、修复同一草稿、`--ui-safe` | 待本人验收 |

应用缩放的 85–120% 与 Windows DPI 分开记录；200% 是原生显示缩放，不是合法的 `ui_scale` 配置。
