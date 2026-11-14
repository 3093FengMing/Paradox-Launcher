---
name: Paradox Launcher
description: 折页工作面与石墨纯色的两套完整默认界面，紧凑但可读。
colors:
  primary: "#6676dc"
  primary-foreground: "#0d1022"
  graphite-canvas: "#24272d"
  graphite-panel: "#30353d"
  paper-canvas: "#edf1f7"
  paper-panel: "#fff"
  dark-text: "#edf1f7"
  light-text: "#24272d"
  dark-muted: "#bac5d4"
  light-muted: "#586476"
  dark-selection: "#3d465c"
  light-selection: "#e5e9fa"
  dark-accent-ink: "#b0bcff"
  light-accent-ink: "#4357b4"
  dark-control-line: "#8997ab"
  light-control-line: "#7c899d"
  modern-light-control-line: "#7a879b"
  modern-dark-line: "#48515e"
  modern-light-line: "#cbd2de"
  immersive-dark-line: "#556170"
  immersive-light-line: "#cbd3de"
  modern-dark-hover: "#383e49"
  modern-light-hover: "#e7ecf4"
  modern-dark-danger: "#ffb0b8"
  modern-light-danger: "#a32135"
  modern-danger-action: "#ad2639"
  modern-dark-warning: "#f0ce86"
  modern-light-warning: "#7e570e"
  modern-dark-success: "#a8d9c1"
  modern-light-success: "#23684e"
  immersive-dark-danger: "#ffb1b8"
  immersive-light-danger: "#943342"
  immersive-dark-warning: "#f0c997"
  immersive-light-warning: "#7b4b17"
  modern-overlay: "#101319a3"
  immersive-overlay: "#16181dcc"
typography:
  modern-body:
    fontFamily: "\"Segoe UI Variable\", \"Microsoft YaHei UI\", \"Segoe UI\", \"PingFang SC\", sans-serif"
    fontSize: "14px"
  immersive-body:
    fontFamily: "\"Segoe UI Variable\", \"Microsoft YaHei UI\", \"Segoe UI\", \"PingFang SC\", sans-serif"
    fontSize: "14px"
  modern-meta:
    fontFamily: "\"Segoe UI Variable\", \"Microsoft YaHei UI\", \"Segoe UI\", \"PingFang SC\", sans-serif"
    fontSize: "max(12px, .86em)"
  immersive-meta:
    fontFamily: "\"Segoe UI Variable\", \"Microsoft YaHei UI\", \"Segoe UI\", \"PingFang SC\", sans-serif"
    fontSize: "max(12px, .88em)"
  modern-title:
    fontFamily: "\"Segoe UI Variable\", \"Microsoft YaHei UI\", \"Segoe UI\", \"PingFang SC\", sans-serif"
    fontSize: "max(19px, 1.5em)"
    fontWeight: 600
    lineHeight: 1.3
  immersive-title:
    fontFamily: "\"Segoe UI Variable\", \"Microsoft YaHei UI\", \"Segoe UI\", \"PingFang SC\", sans-serif"
    fontSize: "1.8em"
    fontWeight: 600
    lineHeight: 1.3
  code:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
rounded:
  default: "6px"
  continuous-row: "0"
  circle: "50%"
spacing:
  modern-control-gap: "0.55rem"
  modern-panel-padding: "1.2rem"
  modern-home-row-padding-y: "0.35rem"
  modern-dialog-padding: "1.7rem"
  immersive-control-gap: "0.55em"
  immersive-dialog-padding: "1.7em"
components:
  modern-button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.modern-body}"
    rounded: "{rounded.default}"
    padding: "0.5rem 0.9rem"
    height: "2.45em"
  modern-button-secondary:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.dark-text}"
    typography: "{typography.modern-body}"
    rounded: "{rounded.default}"
    padding: "0.5rem 0.9rem"
    height: "2.45em"
  modern-instance-search:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.dark-text}"
    typography: "{typography.modern-body}"
    rounded: "{rounded.default}"
    padding: "0 0.75rem"
    height: "2.45em"
  modern-rail:
    backgroundColor: "{colors.graphite-canvas}"
    textColor: "{colors.dark-muted}"
    typography: "{typography.modern-meta}"
    padding: "1rem 0.5rem 0.75rem"
    width: "6.1em"
  immersive-top-nav:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.dark-muted}"
    typography: "{typography.immersive-body}"
    padding: "0.5em 0.25em"
  modern-status-tag:
    backgroundColor: "{colors.modern-dark-hover}"
    textColor: "{colors.dark-text}"
    typography: "{typography.modern-meta}"
    rounded: "{rounded.default}"
    padding: "0.15rem 0.45rem"
  modern-dialog:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.dark-text}"
    typography: "{typography.modern-body}"
    rounded: "{rounded.default}"
    padding: "{spacing.modern-dialog-padding}"
    width: "min(440px, calc(100vw - 32px))"
  modern-instance-row:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.dark-text}"
    typography: "{typography.modern-body}"
    rounded: "{rounded.continuous-row}"
    padding: "0.55rem 0.8rem"
    height: "3.85em"
  modern-inspector:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.dark-text}"
    typography: "{typography.modern-body}"
    rounded: "{rounded.default}"
    padding: "{spacing.modern-panel-padding}"
    width: "22em"
  immersive-launch-split:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.immersive-body}"
    rounded: "{rounded.default}"
    height: "4em"
---

# Design System: Paradox Launcher

## Overview

**Creative North Star: "折页＋石墨"**

折页式工作面把目标、状态与可执行动作集中在连续的区域中；石墨纯色表面用明暗、分隔线和紫蓝强调建立层次。默认密度采用 Operate：紧凑但可读，优先保证实例名称、真实状态和关键动作可扫读。

两套默认来源使用同一业务能力与质量要求。沉浸式以顶部主导航、上下文侧导航和折页启动概览组织日常操作；Modern 以窄侧导航、连续实例表和可收起查看栏组织多实例操作。新增页面沿用所在套件的结构，不要求两套套用同一个页面模板。

**Key Characteristics:**

- 纯色画布与面板；默认不使用背景图片、游戏封面或装饰性照片。
- 连续实例集合与明确分隔，选中状态使用表面色和文字标记。
- 正文与动作保持可读下限，元信息采用较小字号与明确用途。
- 正常界面均是可替换套件来源；唯一固定界面是平时隐藏的 Recovery。

本文件从当前实际 TSX/CSS 来源提取，不把合成原型当成应用来源。它记录已经实施的默认视觉系统；本轮可执行的自动验收已完成，Windows 原生交互仍待本人验收，完整证据与边界见 [implementation-review.md](docs/ui-redesign-2026-11-15/implementation-review.md)。两个默认套件的普通页面、控件、标题栏、业务弹窗、首次样式选择、加载/错误和通知仍可通过公开套件来源替换。普通 UI 编辑器保持其既有来源与外观；Recovery 是唯一固定界面。

来源记录（本轮 final-v4 快照）：

| 项目 | 值 |
| --- | --- |
| 提取时间 | 2026-11-14T23:01:33Z |
| Git 基线 | `18ce9b29da7e712cfcbb52f729c425d8aea1bec8` |
| Modern + Immersive TS/TSX/CSS 来源 SHA-256 | `8688318cc7db1a2b48767db03e6c1f2d2112e5291d40969ff9714e40fc81e124` |
| 指纹文件数 | 125；不含 suite.json 清单 |
| 公开字体来源 SHA-256 | `90952b1e2267b3d68ed8cd1de95a54848fc1ec662809f1e27d72ce580fd88401` |

聚合指纹使用仓库相对正斜杠路径，按 JavaScript `files.sort()` 默认比较排序，将 UTF-8 路径、NUL、原始文件字节、NUL 依次加入 SHA-256，不归一化换行。基线 commit 是实现前版本，指纹标识 final-v4 来源。密度证据为 [.test-data/ui-redesign/2026-11-15/20261114T222446443Z-modern-density-probe/report.json](.test-data/ui-redesign/2026-11-15/20261114T222446443Z-modern-density-probe/report.json)。最终 DEV、实际编译后＋CSP、普通生产入口与本轮 Windows 构建结果见 [verification-summary.json](docs/ui-redesign-2026-11-15/evidence/application/verification-summary.json)；系统 DPI、真实认证和游戏操作等原生项目仍待验。

实际应用来源的 final-v4 截图见 [application/report.json](docs/ui-redesign-2026-11-15/evidence/application/report.json)，来源字节与截图 SHA 见 [application/provenance.json](docs/ui-redesign-2026-11-15/evidence/application/provenance.json)。截图使用真实应用 root、永久业务 owner 和桌面 invoke/event 边界夹具；实例与账户为测试数据，不证明原生登录或游戏启动成功。

| 真实应用表面 | 来源截图 |
| --- | --- |
| 沉浸式首页 | [immersive-home.png](docs/ui-redesign-2026-11-15/evidence/application/immersive-home.png) |
| 沉浸式实例 | [immersive-instances.png](docs/ui-redesign-2026-11-15/evidence/application/immersive-instances.png) |
| Modern 首页 | [modern-home.png](docs/ui-redesign-2026-11-15/evidence/application/modern-home.png) |
| Modern 实例 | [modern-instances.png](docs/ui-redesign-2026-11-15/evidence/application/modern-instances.png) |

业务与定制约束来自 [PRODUCT.md](PRODUCT.md)、[design-review.md](docs/ui-redesign-2026-11-15/design-review.md)、[UI-CUSTOMIZATION.md](docs/UI-CUSTOMIZATION.md) 和 [TESTING-UI-REDESIGN.md](docs/TESTING-UI-REDESIGN.md)。2026-11-07 规格和 2026-11-08 通过记录属于各自历史来源。

## Colors

前置 tokens 记录真实 CSS 色值；组件样例默认展示深色主题，浅色主题按用途映射到对应 paper、light-text、light-muted、light-selection 与边界色。组件中的颜色必须经语义层使用，不把前置字段名理解为新的生产 CSS API。

| 用途 | 深色映射 | 浅色映射 |
| --- | --- | --- |
| 画布 / 面板 | graphite-canvas / graphite-panel | paper-canvas / paper-panel |
| 正文 / 辅助文字 | dark-text / dark-muted | light-text / light-muted |
| 选中表面 | dark-selection | light-selection |
| 强调文字与焦点 | dark-accent-ink | light-accent-ink |
| Modern 控件边界 | dark-control-line | modern-light-control-line |
| 沉浸式控件边界 | dark-control-line | light-control-line |
| Modern 工作面分隔 | modern-dark-line | modern-light-line |
| 沉浸式工作面分隔 | immersive-dark-line | immersive-light-line |
| Modern 悬停 | modern-dark-hover | modern-light-hover |

沉浸式的悬停使用选中表面语义。两套分隔线、悬停及错误/警告颜色存在实际差异，保留各自源码值；不要为了表面一致把其中一套覆盖为另一套。Modern 另有真实 success 颜色，沉浸式 ready 指向强调文字。边界色用于辨认控件，较弱的工作面分隔不能替代它。

**The Action Pair Rule.** 主要动作背景与前景必须配对使用公开的 --accent 和 --accent-fg；普通强调文字与焦点使用 --accent-ink，不将主动作背景色直接作为小字颜色。

**The Semantic State Rule.** 错误、警告、准备与运行状态来自真实快照，并以文字说明；状态色不代替文字，也不表示没有业务数据支持的兼容性或同步状态。

实际来源采用 primitive → semantic → component 层级。Modern 在 `styles/tokens.css` 中以 `--p-*` 映射 `--bg/--surface/--text/--control-border`，再由组件引用；沉浸式以 `--p-* → --s-* → --c-*` 映射到常用别名。公开外观变量以内联方式覆盖主题基准：`--accent`、`--accent-fg`、`--accent-ink` 和 `--radius` 来自既有设置。light/dark/system 沿用现有主题解析。

侧车中的色条只复用真实石墨调色值；没有在实现中存在的品牌、错误或警告渐变不合成新 tokens。默认表面为纯色；保留用户图片与套件素材的公开定制能力。

来源：[Modern tokens.css](ui/src/ui-suite/builtins/modern/styles/tokens.css)、[Immersive tokens.css](ui/src/ui-suite/builtins/immersive/styles/tokens.css)、[appearance.ts](ui/src/lib/appearance.ts)。

## Typography

系统字体栈以 Segoe UI Variable、Microsoft YaHei UI、Segoe UI、PingFang SC 和 sans-serif 顺序支持 Windows 与中英文。保留既有 system、YaHei、Arial、serif、monospace 选择。代码、路径和日志沿用 Consolas / Cascadia Code。普通正文使用系统界面字体，不引入展示字体或将英文标签改成全大写。

**The Readable Floor Rule.** 默认正文基准为 14px，应用缩放后的根字号下限为 13px，元信息下限为 12px。小窗口通过换行、重排和滚动容纳内容，不继续压低字号。

根字号由 `max(13, 14 × ui_scale / 100)` 计算：85%、100%、120% 的有效根字号分别为 13px、14px、16.8px。Shell、业务弹窗和通知采用同一基准；弹窗 Popup 保留调用方的 style（包括函数形式）。组件继续使用来源中的 `max()` 字号下限，不能仅以 root 字号代替实际元素字号测量。系统 200% DPI 与应用缩放是两个独立维度。

玩家独立 Menu 的 Positioner 通过公开 style props 使用同一像素基准，Popup 与 Item 显式继承，避免共享浮层默认 rem 字号覆盖玩家基准。普通编辑器保留共享控件的既有字号与缩放行为。

| 角色 | Modern | 沉浸式 |
| --- | --- | --- |
| 页面标题 | max(19px, 1.5em)，600，1.3 行高 | 1.8em，600，1.3 行高 |
| 首页当前实例名 | max(22px, 1.7em)，600 | 2.2em，650，1.2 行高；窄窗口降为 1.8em |
| 查看栏实例名 | max(18px, 1.25em) | 使用所属页面的详情样式 |
| 常规动作 | 至少 13px | 至少 13px |
| 元信息 | 常见 max(12px, .86em) | 常见 max(12px, .88em)，部分标签使用 .9em / .92em |

两套没有一个统一的标题比例；前置 typography 中的角色只记录实际默认角色。名称与状态需要完整识别时允许换行，单行密集列表可截断并保留完整名称标题。日志与路径允许选择和换行。

## Layout

Modern 的窄侧导航为 `--rail-width: 6.1em`，查看栏为 `--inspector-width: 22em`，普通控件为 `--control-height: 2.45em`，非 ready 状态标题栏为 `--titlebar-height: 3.4em`。默认 14px 基准下分别约为 85.4px、308px、34.3px、47.6px。ready 状态的窗口按钮并入工作区标题行，使用其实际独立布局值；不要把非 ready 高度套到集成标题行。

Modern 实例表和首页连续实例行最小高度为 3.85em。100% 普通桌面实际测得两者均为 53.890625px；85% 的首页约 50.05px、实例行约 50.05–50.44px；120% 约 64.67px。首页双行名称/版本默认纵向 padding 为 .35rem，使文字下限与约 54px 默认行高共同成立。窄窗口与长名允许自然增高，不强制固定高度。沉浸式连续行使用 `--c-row-height: 3.86em`，普通控件使用 `--c-control-height: 2.43em`。

前置 component 的 height 字段记录控件或行的最小尺寸基准，实际来源使用 min-height；内容需要更高时允许自然增高。spacing 字段是从各组件提取的真实间距，项目没有将所有 rem/em 间距统一成一个全局等比刻度，不机械改写其单位。

| 响应式条件 | 实际变化 |
| --- | --- |
| Modern 工作区容器 ≤ 64rem | 查看栏改到列表下方；收起后工作区扩展 |
| Modern 列表容器 ≤ 40rem | 隐藏表头，行内补字段标签并重排动作 |
| Modern 窗口 ≤ 1050px | 显示持续可达的当前启动目标条 |
| 两套窗口 ≤ 719px | 使用各自的小窗导航与内容规则 |
| Modern 首页 ≤ 640px | 实例行可换行，名称允许断行，动作重排 |
| 沉浸式窗口 ≤ 1150px / 950px | 逐级压缩顶部导航间距与品牌文本 |
| 沉浸式首页 ≤ 719px 或高度 ≤ 400px | 折页改为单列，启动区固定到下方，预留滚动空间 |

查看某个实例、设为当前启动实例和启动某个实例是独立动作。列表查看只改查看对象；详情和查看栏传递真实 `profileKey`，缺少身份时展示缺失状态。小窗启动区明确显示当前目标，列表中的显式启动明确作用于对应行。两套都有完整玩家页面与真实能力，不将其中一套变成功能子集。

来源：[Modern layout.css](ui/src/ui-suite/builtins/modern/styles/layout.css)、[Modern instances.css](ui/src/ui-suite/builtins/modern/styles/instances.css)、[Modern home.css](ui/src/ui-suite/builtins/modern/styles/home.css)、[Immersive layout.css](ui/src/ui-suite/builtins/immersive/styles/layout.css)、[Immersive home.css](ui/src/ui-suite/builtins/immersive/styles/home.css)。

## Elevation & Depth

**The Flat Workspace Rule.** 普通工作面使用纯色、边界和选中表面建立层次，默认无阴影；弹窗、菜单与通知采用各自来源定义的阴影标记临时浮层。

Modern 业务弹窗使用 `0 12px 40px #00000038`，沉浸式业务弹窗与实例菜单使用 `0 12px 40px #1114192f`。Modern 实例工具菜单使用 `0 8px 24px #0003`；两套通知使用 `0 8px 24px #1114192f`。遮罩分别使用前置 modern-overlay 和 immersive-overlay。浮层保留窗口高度上限、内部滚动和现有嵌套 Select/Menu 层级。

Modern 控件表面/边界过渡为 120ms，业务弹窗透明度为 140ms，缓动为 `cubic-bezier(.2,.8,.2,1)`；沉浸式业务弹窗透明度为 150ms，缓动为 `cubic-bezier(.2,.7,.2,1)`。等待指示为 900ms 线性旋转。应用“减少动效”设置与系统 prefers-reduced-motion 都禁用动画和过渡，键盘导航禁用相关过渡；不要给工作面添加视差、装饰性循环或启动动画延迟。

来源：两套 `styles/components.css`、`styles/notifications.css` 和 `styles/responsive.css`。

## Shapes

默认可配置圆角基准为 6px。控件、面板和浮层通过公开 `--radius` 或沉浸式 `--c-radius` 使用已保存的 0–28px 设置；不对保存圆角施加额外 min() 上限。连续列表行自身保持直角分隔，由外层列表容器裁切；头像、状态点、开关和窗口按钮保留来源中对应的固定形状。

边界承担工作面与控件用途：工作面有较弱分隔，输入和次要按钮有可识别控制边界。键盘 focus-visible 使用可见的 2px 强调轮廓。默认窗口控件保持矩形，分体启动按钮的两个内部按钮共享外层圆角并用分隔线区分动作。

## Components

.impeccable/design.json 提供 10 个独立 HTML/CSS 展示片段：Modern 主/次按钮、实例搜索、窄侧导航、状态标签、业务弹窗容器、连续实例行、查看栏，以及沉浸式顶部导航与分体启动。片段只演示来源样式；字段名和状态文字是展示标签，不执行真实业务、不实现保存或模态协议。每个片段使用 ds- 类和内联 SVG，没有 React、Tailwind、外部字体或远程图片依赖。实际 CSS 变量作用域位于套件容器，片段用来源中的真实字面值作为 fallback。

实际应用继续使用 `@paradox/ui` Button、Dialog、Field、Select、Menu 等公开控件和 `@paradox/launcher` snapshot/actions/capabilities。只有一个永久 LauncherProvider。可替换页面和组件通过 UiView / UiIdentity 保持公开身份；Original 的 props、ref 与 callback 不被设计覆盖吞掉。

| 模式 | 应用约束 |
| --- | --- |
| 主动作 | 动作名称随安装、修复、账户选择、启动、运行、停止等真实状态变化；禁用原因可读取 |
| 实例行 | 名称用于查看；准备/启动、详情、工具菜单各自有明确入口 |
| 查看栏 | 显示精确查看实例；设为当前启动目标另有动作；可收起 |
| 业务弹窗 | 使用现有草稿与提交守卫，遵守 pending 关闭/Escape、初始/返回焦点和嵌套浮层协议 |
| 通知 / 加载 / 错误 | 读取真实状态，提供已有可执行恢复动作；持续错误不只依赖短暂通知 |
| 首次样式选择 | 静态预览、明确确认后保存；准备/保存失败保留选择并允许重试 |
| 普通 UI 编辑器 | 保持 common/editor 既有样式、源码编辑、预览、保存与 CAS 控制器 |
| Recovery | 固定紧急界面；保留 Ctrl+Shift+F11、Ctrl+Shift+F12 和 --ui-safe |

普通编辑器来源位于 [common/editor/style.css](ui/src/ui-suite/builtins/common/editor/style.css)，仍为固定 inset 12px、padding 14px、`font: 14px var(--ui-font, system-ui)` 的既有编辑器表面；它没有被重新设计成石墨玩家页。其普通展示与业务编辑操作继续保持公开替换能力。

## Do's and Don'ts

**Do:**

- 沿用所在套件的导航与工作面，显示真实实例、账户、任务和能力状态。
- 将查看对象、当前启动目标和启动动作分别表达；每个实例动作携带精确 profileKey。
- 用 primitive → semantic → component 层级引用颜色和尺寸，并保留公开外观设置。
- 保留 UiView、UiIdentity、data-ui-site、Original props/refs/callbacks，以及现有草稿、CAS、预览和保存协议。
- 用可见焦点、明确标签、文字状态和可选择日志支持键盘与中英文操作。

**Don't:**

- 不新增没有业务支持的游玩时长、收藏、云同步、多个离线账户、暂停/重排下载或兼容徽标。
- 不使用默认背景图片，不把设计板的示例记录当成真实业务数据。
- 不以查看某个实例静默改变当前启动目标，不在缺少 profileKey 时回退到当前实例。
- 不挂载第二个 LauncherProvider，不从套件直接调用私有 IPC、业务 Hook 或 Modrinth 请求。
- 不将普通编辑器改成新的石墨页面；保持其既有来源和控制器，不改动 Recovery 快捷键或 --ui-safe。
- 不把旧截图、中间截图、静态检查或设计片段当作最终浏览器与 Windows 原生验收。
