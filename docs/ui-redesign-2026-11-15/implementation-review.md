# 折页＋石墨默认 UI 实施记录

日期：2026-11-15（Asia/Shanghai）。分支：`dev`。实现基线：`18ce9b29da7e712cfcbb52f729c425d8aea1bec8`。

**状态：两套默认界面已实施，本轮可执行的自动验收已完成。Windows 原生交互验收保留待验。** 用户已明确选择“折页的设计＋石墨的配色”，并授权“按这版实施”；提交与推送沿用会话既有授权。

## 实际交付

沉浸式采用顶部主导航，首页分为左侧账户、当前实例与启动摘要，以及右侧实例集合；完整实例详情提供上下文导航。小窗口改为可滚动内容和持续可达的启动区域。Modern 采用约 85px 的窄侧导航、连续实例表、可收起查看栏和当前启动目标条。查看实例、设为当前启动目标、打开详情及启动分别使用现有公开动作，查看不会静默更换启动目标。

两套均覆盖九条现有页面路线、九类业务弹窗，以及首次样式选择、加载、错误和通知。默认使用石墨 `#24272d`、面板 `#30353d`、冷白 `#edf1f7`、紫蓝 `#6676dc` 和主动作字色 `#0d1022`。普通控件约 34px；默认玩家正文 14px，85% 缩放保留 13px 下限；元信息保留 12px 下限。Modern 100% 普通桌面首页与实例页面行高实测均为 53.890625px，长名称、小窗口和较大缩放允许自然增高。

新配置默认强调色和圆角改为 `#6676dc` / 6px；已有保存值不迁移。公开字体、强调色、圆角、图片和套件定制能力保留。默认界面不创建或消费背景图片。普通 UI 编辑器保持既有来源、外观与控制器，玩家字号基准不覆盖其原有 16px 外层缩放基准。

## 业务与定制契约

继续使用唯一永久 `LauncherProvider`、真实 `@paradox/launcher` snapshot/actions/capabilities；详情使用真实 `profileKey`，缺少或无效身份不会回退到当前启动实例。没有新增业务 owner、私有 IPC、下载队列或直接 Modrinth 请求。

保留 UI schema/API 1、公开 routes/views、UiView/UiIdentity/site、Original props/ref/callbacks，以及 draft、CAS、preview、save 和导出/重导入协议。普通导航、标题栏、控件、页面、弹窗和补充状态仍可由套件来源替换。Recovery 仍为唯一固定紧急界面；`Ctrl+Shift+F11`、`Ctrl+Shift+F12` 和 `--ui-safe` 保留。

## 冻结来源与图像

最终应用来源为 final-v4；125 个 Modern/Immersive TS/TSX/CSS 的聚合 SHA-256 为：

```text
8688318cc7db1a2b48767db03e6c1f2d2112e5291d40969ff9714e40fc81e124
```

算法为仓库相对正斜杠路径的 JavaScript `files.sort()` 默认排序，然后依次加入 UTF-8 path、NUL、原始字节、NUL；不归一化换行。两份 suite 清单按实际来源重算：Modern 86 文件、沉浸式 85 文件，各 43 views / 9 routes。暂存 blob 的 bytes/SHA 与清单逐项一致。

四张 final-v4 应用截图、每文件字节与 SHA、实际 viewport/theme/language/scale，以及 invoke/event 边界说明位于 [evidence/application/provenance.json](evidence/application/provenance.json)。完整当前输入见 [final-source-inputs.json](evidence/application/final-source-inputs.json)，原生构建输入见 [native-build-inputs.json](evidence/application/native-build-inputs.json)。

| 应用表面 | final-v4 截图 |
| --- | --- |
| 沉浸式首页 | [immersive-home.png](evidence/application/immersive-home.png) |
| 沉浸式实例 | [immersive-instances.png](evidence/application/immersive-instances.png) |
| Modern 首页 | [modern-home.png](evidence/application/modern-home.png) |
| Modern 实例 | [modern-instances.png](evidence/application/modern-instances.png) |

这些图像来自真实应用 root 和永久业务 owner，实例/账户为测试夹具数据；独立合成原型和中间图不计为本次应用验收或原生成功。

## 本轮实际验证

| 范围 | 当前结果与证据 |
| --- | --- |
| 静态与 Node | `check:ui`、`lint:ui`、`check:i18n`、`test:ui`、`ui test:suite` 均自然退出 0；i18n 1099 keys / 1950 usages、两种语言 |
| Rust | 本轮 `cargo fmt --all -- --check`、`cargo test --locked -p paradox-core`、`cargo clippy --locked -p paradox-core --all-targets -- -D warnings` 均自然退出 0；core 219 通过、1 忽略 |
| Foundation | DEV/COMPILED 每条 12 个完整脚本，加独立 Inspector preview/picker；各 14/14 项均有完整、自然退出 0、全输入无漂移的有效证据；原整组退出 DEV=0 / COMPILED=1 及三项复跑分别保留 |
| Builtin 套件 | DEV/实际 COMPILED＋CSP 各 8/8 上下文完整通过、自然退出 0、879 输入无漂移 |
| 重设计专项和矩阵 | DEV/COMPILED 各七专项 7/7＋完整 36/36 上下文，完整 runner 自然退出 0；无 filter，879 输入前后无漂移 |
| 普通生产入口 | 普通 `ui/dist` 三个全新上下文通过、自然退出 0；无 fixture globals、pageError、CSP、source/node_modules/external 请求 |
| Windows 构建 | 本轮 final-v4 `npm run build -- --debug --no-bundle` 自然退出 0；构建前后 879 输入无漂移 |

逐项执行、自然退出码、脚本 SHA、输入清单、原始失败与有效复跑索引见 [verification-summary.json](evidence/application/verification-summary.json) 和 [foundation-verification.json](evidence/application/foundation-verification.json)。正式证据来源为：

- 根静态、Rust、构建、生产和图像：`.test-data/ui-redesign/2026-11-15/20261114T215444Z/`。
- Foundation：`.test-data/ui-redesign/2026-11-15/20261114T215848834Z/foundation-agent/` 下 final-v4、final-v4-repeat-foundation 和 final-v4-stable-repeat；原整组状态保留。
- Builtin 八上下文：`.test-data/ui-redesign/2026-11-15/20261114T230047Z/{dev,compiled}/builtins/suite/`。
- 七专项＋36 矩阵：`.test-data/ui-redesign/2026-11-15/20261114T232332Z/{dev,compiled}/builtins/redesign/`；该次开始/结束均为完整当前输入。它相对较早 build freeze 的唯一已知差异为 Logs 测试导航更新。

新增有意义的默认值与对比度回归覆盖保存配置不迁移、主动作前景算法一致、默认/自定义强调色和 256 灰阶；普通主动作与真实主题中的强调标签保持 4.5:1，控件边界的实际渲染检查保持 3:1。专项和矩阵保留真实业务身份、守卫、焦点、owner、长名称、错误、缩放、主题和减少动效断言，没有删减断言制造通过。

普通生产脚本报告 startup 约 1650/2001/1983ms；它没有数值性能预算断言。这些是并行负载下本机度量，不宣称性能预算通过。

## 失败、复跑及证据边界

COMPILED Foundation 首次有一次 Select 键盘结果 `'' !== 'b'`，故原完整 COMPILED 主组自然退出 1；同一脚本不作修改、原样完整复跑自然退出 0。原 DEV 完整主组自然退出 0，原失败记录保留。Logs 测试在最后菜单分支仍按旧侧栏结构定位；已改为通过实际顶部导航进入明确 `profileKey` 的实例详情，再验证上下文菜单、实际 section 和回焦，应用来源未改。七专项＋36 矩阵在新目录完整重跑，两条 runner 均自然退出 0。

这次 Logs 测试脚本写入期间，DEV Inspector picker 和 COMPILED customization 的全输入清单各观察到这一份脚本漂移；原记录保留，两项在稳定输入后原样复跑，均自然退出 0、全输入无漂移。没有将这些首轮漂移项标为全输入冻结通过。旧 v1/v2/v3 的来源漂移、失败、中止和探索记录继续保留，不计为 final-v4 的成功。

## Windows 产物与待验范围

归档 EXE：`.test-data/ui-redesign/2026-11-15/20261114T215444Z/artifacts-final-v4/paradox-launcher-final-v4-debug.exe`，44,990,976 bytes。

```text
SHA-256 cfe4c8f06a0db23b5a9d231379deed08de3f2927549b28608683401343977073
```

完整构建执行记录、日志指纹、两测试 outDir 和内嵌普通前端的文件 manifests 见 [build-provenance.json](evidence/application/build-provenance.json)。本轮使用已有本地 Windows SDK/MSVC 工具，没有安装或同步 SDK。

原生探索只观察到早期 native-smoke 构建的 onboarding accessibility tree；其字节与最终 EXE 不同，不能当作 final-v4 验收。截图工具出现 `FrameArrived` / window capture 超时，坐标输入报 `coordinate input geometry is unavailable`，Tab 未产生可观察焦点变化。当前环境无法完成实际原生交互，因此下列项目保留待本人验收：

- final-v4 原生标题栏拖动、双击最大化/还原、窗口控件和文字选择；原生 Tab/Escape、弹窗与菜单焦点、启动及 Recovery 快捷键。
- Windows DPI 100/125/150/200%、中文/英文与小窗口；应用 85/100/120% 缩放已有浏览器覆盖，系统 DPI 另验。
- 真实 Microsoft 授权、刷新、切换、游戏身份、取消与过期恢复。
- 真实安装、修复、启动、停止和运行中关闭策略；普通原生编辑器、损坏来源恢复与 `--ui-safe` 旅程。

## 记录与提交范围

[DESIGN.md](../../DESIGN.md) 和 [.impeccable/design.json](../../.impeccable/design.json) 从实际来源提取，并与 final-v4 截图及来源指纹配对。[design-review.md](design-review.md) 为本轮主计划；[verification-plan.md](verification-plan.md) 保留可复现命令与证据规则。2026-11-07 规格和 2026-11-08 测试记录不改写。

本次只暂存授权 UI、必要回归、设计记录、三份确认原型和精确列出的最终图像/元数据。用户原有 `.gitignore` 改动保留且不暂存；不提交全部 `.test-data` 或无关历史文件，不创建 worktree。
