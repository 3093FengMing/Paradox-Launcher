# Paradox Launcher 默认 UI 重设计：第一版设计

日期：2026-11-07。工作区：`F:\rust-code\Paradox Launcher`。分支：`dev`。探索起点：`208198063f5bcb63da27cfa88bc995ab7cd82ead`。

状态：2026-11-08 两套默认来源的实现与自动验收已完成，最终开发和实际 CSP 编译后各七项专项、36 个矩阵上下文全部通过。按既有授权进行 dev 提交与推送；需要用户本人操作的 Windows WebView2、DPI、登录和游戏检查单独记录，完整结果见 [默认 UI 重设计验收](../../TESTING-UI-REDESIGN.md)。

## 1. 已确定的设计树

- 正常应用全部可定制：导航、页面结构、标题栏、控件、业务弹窗、首次样式选择、加载、错误、通知、普通 UI 编辑器。唯一固定界面为平时隐藏的 Recovery。
- 两套独立默认设计：沉浸式服务日常选择实例、登录与启动；Modern 服务多实例与内容管理。两套均包含全部现有玩家功能。
- 沉浸式参考本次六张图的布局语言：紫蓝标题栏、随页面变化的分组侧栏、紧凑列表与设置行、首页右下角分体启动按钮。
- **最新决定覆盖最初背景方向：删除两套默认设计的全部图片背景，包括现有 world.svg、landscape.svg；本版不制作、不提供背景图片。** 使用纯色底面，首页仍保留空间。默认页面不消费已有背景图片变量；保留用户套件的素材能力、公开图片动作与用户已保存数据。
- Modern 的第一版由本设计提出，采用固定导航、实例筛选与表格、选中实例详情区和完整详情页。
- 版本库独立入口；下载页只承担任务与状态；本地内容进入实例详情；在线内容通过资源发现入口搜索安装。
- 第一次普通启动展示两套用途与界面预览，用户确认后记住选择；该界面也是普通可替换来源。
- 当前内测版本无需旧 UI、旧覆盖位置或旧设计迁移；不删除用户配置、套件、账户或游戏数据。
- 普通 UI 编辑器沿用目前外观和全部定制能力。保留 F11/F12、Recovery 与安全启动。
- 深浅主题、跟随系统、缩放、减少动效、中英文、键盘、小窗与高 DPI 纳入本次验收。

本轮剩余实质决策只有默认背景来源；用户已明确改为完全无图片背景。其余布局细节作为下文可审阅的第一版设计，不另行重复访谈。

### 2026-11-07 执行前补充

用户提供 https://github.com/HMCL-dev/HMCL 作为沉浸式实现参考，并明确允许适当设计改进。以该项目的上下文导航、紧凑列表、设置分组和启动交互辅助本次六张参考图；实现为本项目独立的 React/TSX 来源，不移植其 JavaFX 业务实现。保留 Paradox 品牌、全部正常 UI 定制、无图片背景、独立 Modern 与既有公开业务协议。用户“继续执行任务”视为对这份具体方案的实施授权；当前 grilling 决策前沿为空，不重复确认。

## 2. 实际参考图与项目事实

已实际查看 `docs/ui-redesign-references-2026-11-07/` 的六张图片：01 首页、02 账户、03 实例、04 游戏版本、05 设置、06 实例详情。借鉴信息层级、侧栏随页变化、面板密度与启动位置。图片中的 HMCL 品牌、人物账户、推广文字、桌面内容及未实现的产品功能不进入设计。

真实运行入口为 `ui/src/main.tsx` → 永久 `LauncherProvider` / `UiEditorProvider` → `App.tsx` → `SuiteProvider`。默认来源为 `ui/src/ui-suite/builtins/{modern,immersive,common}`。探索起点只有 Shell/Home 的主要视觉独立，其余六页和九类弹窗多为 common 来源；本轮实现后，两套分别拥有全部玩家视图，common 保留纯辅助与普通编辑器。

当前公开能力足以支撑本次完整重排：账户、实例、安装/修复/启动、版本目录、loader 查询、Java、本地内容、Modrinth 搜索、整合包导入导出、下载队列、日志和设置。数据来自 `@paradox/launcher` 的 snapshot/actions；可视组件、Identity 与视图解析来自 `@paradox/ui`。

页面不能使用私有 hooks、api.ts、原始 IPC、直接 Modrinth fetch 或第二个业务 Provider。新版本库使用现有 catalog，详情与发现共用现有 content 所有者，安装共用现有下载队列。

## 3. 采用的实现结构与取舍

采用“独立套件视图 + 共享业务协议和纯展示辅助函数”。两套分别拥有 Shell、全部玩家页面、组件样式、弹窗和状态视图；公共基础组件继续负责键盘、焦点、Portal 和事件语义。共享的是行为保障和数据解释，不约束两套采用相同按钮外观、表单或页面结构。

比较过的另外两种组织方式：

| 组织方式 | 优点 | 代价 / 判断 |
| --- | --- | --- |
| 推荐：两套独立视图，纯 helpers 和 foundation 行为共用 | 每套可完整复制编辑，布局独立，业务只实现一次 | 要维护两套视觉验收；符合本次目标 |
| 所有源码连 helpers 都在每套复制 | 文件完全自足 | 版本、账户、任务状态解释易分叉；不采用 |
| 另加 renderless 页面组合框架再由套件组装 | 页面间可复用较多逻辑 | 增加新的抽象、slot 协议和调试层；现有公开 API 已足够，本版不采用 |

`common` 保留纯数据 helpers、源码解析辅助、原有正常编辑器及其独立 CSS。玩家 UI 不再通过 `common/style.css` / `common/styles/common.css` 叠加两套布局。两套 styles 各自分 tokens、layout、components、pages；媒体查询留在所归属文件。消除 `common/lib/view.tsx` 这种通用 helper 的玩家 CSS 副作用。

## 4. 总体导航与页面职责

| 公开路由 | 默认入口 | 职责 |
| --- | --- | --- |
| `home` | 首页 | 当前实例、账户与主启动动作；Modern 另展示实例与任务概况 |
| `instances` | 实例 | 搜索、浏览、扫描、导入、打开详情、选择当前实例 |
| `custom.versions` | 游戏版本库 | 版本搜索与类型筛选、缓存状态、选择版本创建实例 |
| `downloads` | 下载任务 | 队列、进度、取消、失败、重试与任务详情 |
| `accounts` | 账户 | 离线账户与 Microsoft 账户、登录、切换、刷新、登出、恢复 |
| `content` | 资源发现 | Modrinth 搜索与安装目标；整合包搜索/导入 |
| `custom.instance-details` | 实例详情（隐藏主导航） | 指定 profileKey 的概览、设置摘要、本地内容与工具 |
| `settings` | 设置 | 外观/游戏/高级设置与 UI 套件管理 |
| `logs` | 日志 | 当前已公开日志、级别与文字筛选、导出与清除 |

沿用 schema_version=1 / api_version=1 和已有七个保留 route，新增合法的 `custom.*`，不为默认页面增加裸路由或迁移格式。版本库 navigation/startupSelectable 为 true；详情均为 false。发现沿用 `content`，只改变默认标题与内容职责。

每个 route.entry 对应同一个 `page.<routeId>`。进入详情使用已有 `navigation.navigate('custom.instance-details', { profileKey })`；不新增 URL 参数协议。自定义套件可以自行修改 routes、页面顺序、标题、图标和可见入口，也可以完全隐藏默认导航。

## 5. 沉浸式视觉与布局

深色基准：窗口纯色 `#263247`，紫蓝标题栏 `#606DCC`，侧栏基准 `#354259`，主列表/表单面板 `#151923`，正文 `#DCE3F0`，次级文字 `#BAC7DD`。半透明侧栏以侧栏颜色叠加窗口纯色；不需要背景图片或装饰景物。浅色采用纯色 `#EDF1F8`、近白面板、深色正文，标题栏保留品牌紫蓝并单独校验对比度。

常规标题栏约 44px、侧栏 220–230px，主内容距侧栏 20–24px。侧栏组标签 12px，正文 14–15px，普通操作 32–36px 高，实例/账户行 60–68px，设置行 56–64px。面板圆角最大 5–6px，分隔线而非大量独立卡片。数值随现有 ui_scale 缩放；圆角仍遵从用户设置上限。

### 首页

标题栏只保留品牌、帮助/关于入口和窗口动作。左侧账户摘要使用实际 active Microsoft 账户与缓存头像，或离线名；游戏组含当前实例详情、实例列表、版本库、下载；通用组含资源发现、设置、日志。

主内容维持大面积纯色留白。顶部可关闭的短提示引导切换外观或打开 UI 编辑器，不展示推广/新闻假数据。右下角 300–350px 分体启动按钮：主体按当前实例状态显示“启动游戏”“安装游戏”“启动中”“运行中”等；右侧打开向上的实例选择菜单。菜单显示稳定的实例身份、版本与安装状态，并提供实例列表/新建入口。运行中保留独立停止动作；取消中禁用重复提交。主动作不依据视图自己拼的 busy 判断绕过 capabilities。

无实例时主按钮为“创建实例”，旁边引导版本库/导入；已有实例但当前为空时为“选择实例”。浏览器预览仍可选择外观和浏览 UI，真实游戏/目录动作显示已有桌面能力限制。

### 实例与详情

实例页侧栏显示当前游戏目录和导入入口，不制造多个根目录管理功能。顶部是搜索、扫描、新建（进入版本库）、导入已有实例、导入整合包；主面板为紧凑行列表。每行包括名称、MC/实际 loader、安装/修复/运行状态、打开详情与更多菜单。当前启动实例的选择控件与“打开详情”分开，避免查看实例时意外改变启动目标。

详情顶栏显示返回、实例名称与状态，侧栏改为概览、游戏设置、本地模组、资源包、光影、存档；下部是导出、打开当前内容分类目录、相关任务和日志入口。内容头部显示版本、实际 loader、启动/安装/修复动作。运行根目录只读显示；现有 openDirectory 只能打开所选 mods/resourcepacks/shaderpacks/saves 子目录，本版不增加打开实例根目录动作。

游戏设置页展示有效值、继承/覆盖来源及运行目录。“编辑游戏设置”打开该套件独立设计的既有 `dialog.instance-settings`：沉浸式采用较宽、紧凑分组的设置弹窗，内部按继承开关与字段组织。**本版详情页展示摘要，编辑通过既有草稿弹窗完成；不另建行内设置状态。** Java、目录选择和提交仍经 instanceDraft 的原校验路径。详情中的本地内容是实际列表，可刷新、打开文件夹、切换模组启用、确认移除支持的内容、导出实例；存档只浏览与打开目录。

### 版本、任务、账户、发现、设置、日志

- 版本库：侧栏分正式版与“包含快照/历史版”，主面板顶部搜索和刷新，行展示 id、kind 与创建按钮；显示 catalog 缓存来源/更新时间/过期提醒。切换包含非正式版本沿用 show_snapshots 现有语义。选择版本打开既有创建草稿，可选 loader，再创建后明确安装。目录使用分段“加载更多”或分页呈现全部可用结果，取消现在固定前 100 项的不可达限制。
- 下载：侧栏按全部/进行中/失败/已结束筛选，主面板紧凑任务列表和可展开详情。显示已知字节、速度、文件数量、failed_files 数量、current_file/message 与缓存重用；不承诺未公开的失败文件清单。未知总量为不定进度。任务支持已有取消和重试，不增加暂停、恢复、排序操作。
- 账户：侧栏为添加 Microsoft、离线设置、登录配置入口；主面板为账户行，选择、刷新、登出在每行明确区分。离线只呈现项目当前支持的一个名字设置，不虚构多个离线账户或外置认证。登录弹窗保留代码复制/打开网页/过期/取消与失败恢复。
- 资源发现：侧栏分模组/整合包/资源包/光影，主面板搜索与结果行，非整合包明确当前安装目标。结果只显示真实 title/description/project_type/downloads；安装时按现有后端挑兼容版本并处理 required 依赖。文字明确“安装时校验兼容”，不标成搜索已筛兼容。搜索每页 20 条。
- 设置：侧栏为外观、游戏与 Java、高级；高级内容按启动参数/环境与模板、网络下载、窗口关闭、快捷键、日志、关于组织。使用原三类 settings tab，并在来源内添加 section anchors；保存条固定在可滚动内容末端，dirty/saving/受限原因明确。默认不展示图片背景导入、适配、模糊与遮暗项；字体、颜色、主题、缩放、透明度、圆角、减少动效、预设和编辑器入口保留。
- 日志：侧栏为全部及实际 LogLine.level 级别，主面板是可选取文字的等宽日志和搜索框。支持本地过滤、跟随末尾开关、导出、清除；不虚构日志归属到某个实例或历史会话。详情的“日志”入口打开现有全局日志，并标明当前日志范围。

## 6. Modern 工作台视觉与布局

深色基准：窗口 `#10151E`、标题栏 `#171E29`、导航 `#18212E`、卡片/表格 `#192432`，边界 `#2A3A50`，正文 `#EAF1FD`。浅色使用 `#F3F6FA` 窗口、白色面板、`#DBE3EF` 分隔线、`#17253A` 正文。品牌强调色沿用配置的 `accent_color`（当前默认 `#6387F5`），与沉浸式紫蓝标题栏分开。两套均尊重现有用户颜色配置，不在切换套件时自动重写设置。

标题栏约 42px、固定导航约 204px，主区 24–28px 间距。控件高度 36–40px，卡片圆角最大 8–10px；使用明确标题、表格列、局部工具栏和 Inspector 详情面板。允许同一功能采用与沉浸式不同的对齐、表单布局、按钮与弹窗大小。

### 首页与实例工作区

首页左侧主要卡片是当前实例：版本、实际 loader、账户、安装/运行状态、主启动动作和完整详情入口。右侧任务概况取真实队列；下方实例概览由当前 profiles.items 派生，提供新建/导入/版本库/资源发现快捷入口。没有后端最近游玩、收藏或更新时间字段，因此不展示假时间或“最近游玩”排序。

实例页顶部搜索与本地状态/loader/版本筛选，中间实例表，右侧约 320–350px 的选中实例 Inspector。查看行是来源内的展示选择，默认落在 activeKey；“设为当前实例”才调用 profiles.select。Inspector 提供启动/安装/修复、有效设置摘要、完整详情与本地内容管理入口；运行根目录只读显示，进入内容类别后才提供对应子目录的打开动作。表格首屏优先名称、MC、loader 与状态；更多工具放菜单。导入/导出与删除继续调用已有动作，不添加批量修改功能。

完整详情页使用标题摘要 + 横向本地页签：概览、设置、模组、资源包、光影、存档。右侧或顶栏显示实例动作和相关任务。设置摘要与编辑弹窗的业务边界与沉浸式一致；Modern 弹窗使用常规居中、清晰标签和两栏分组，较窄窗口改一栏。

### 其余页面

- 版本库：工具栏 + 类型 chips + 版本表；选择版本显示创建摘要或打开既有创建弹窗。不做无数据支撑的全库 loader 支持筛选、发布时间、更新日志或最新徽章。
- 下载：状态页签、任务表、选中任务详情。失败原因、失败文件数量、当前文件与重试在详情区；活动任务可取消。
- 账户：离线摘要与 Microsoft 卡片列表；侧边登录配置面板，设备代码仍用可访问弹窗。凭据故障与清理恢复单独成组。
- 资源发现：分类页签 + 搜索工具栏 + 结果卡/列表，顶部固定安装目标。卡片不添加项目图库/在线详情/收藏/版本选择等缺失能力。
- 设置：固定主导航保留，设置内部为外观/游戏/高级页签，模块化表单与固定保存条；高级组可以来源内折叠。普通编辑器入口与套件选择清晰可达。
- 日志：搜索、级别筛选、跟随、导出、清除的工具栏；剩余空间给等宽日志。已有时间/level/message 是唯一数据基础。

## 7. 第一次样式选择与持久化

普通全页视图 `onboarding.style-choice` 位于 Shell 内容区，标题栏和窗口动作仍可用。两张卡片分别显示静态 UI 结构预览、适用用途、选中态，下方“使用此界面”。预览是套件源码中的轻量 markup，不挂载另一业务应用或订阅 IPC。默认聚焦推荐沉浸式卡片，方向键可切换，Tab 到确认按钮；推荐不会自动提交。

新增只读 `UiEditorSnapshot.initialSelectionRequired: boolean`，从既有编辑器控制器与 authoritative library 推导。触发条件：DATA 读取成功，库 revision=0、suites 为空、active_suite_id=null，config 与 trusted 来源就绪，非 safe/recovery/suspended。现有 null 自动选择仅在非 pristine 库继续使用；真正首次等待用户动作。

选择复用 `UiEditorActions.selectSuite(id): Promise<boolean>`。首次分支先准备候选 builtin，再走原 serialize/CAS；成功持久化并 install 后才解除选择页。controller 内有非持久的首次选择会话 latch：CAS ACK 将 revision 改为 1 时仍保持选择页，直到同 generation 的 install 成功。校验、编译、CAS 或激活失败时留在选择页、保留选择、清 pending、展示可定制错误与重试。

CAS 冲突后重新读取 authoritative DATA；若另一个窗口已成功选择，按权威来源准备/激活并解除会话，否则重新取当前 revision 后允许重试。serialize 真正执行前检查 life/write/activation generation，F12 前排队但未写入的选择不能消费 pristine。已写入后的晚到 ACK 可以更新权威库，但不得重新激活或关闭被 Recovery 接管的界面；下次普通重启按成功写入的 active 来源加载。安全恢复后回到可信普通 UI 时，未写入的 pristine 仍展示选择，已写入记录不要求用户再次首次选择。

不增加库 schema 或另一个“已选择”持久字段：正常 reset 增加 revision，损坏库恢复 reset 产生 revision=1，因此不会重新变成首次。safe 模式不消费 pristine 首次标记，普通重启仍可选择。损坏库使用 Recovery，不被误认为首次。

## 8. 正常状态与全部弹窗

| 状态 | 沉浸式 | Modern | 业务要求 |
| --- | --- | --- | --- |
| 初始/配置加载 | 纯色窗口与小型加载来源 | 工作区框架与加载来源 | `host.loading`；不重新挂载 Provider |
| 列表加载/刷新 | 面板内保留标题与旧数据，行骨架/状态行 | 表格/卡片区域内进度 | 只读 pending；旧结果不可当新实例结果 |
| 空列表 | 一行解释 + 一个明确下一步 | 空态面板 + 新建/导入 | 区分“无数据”和“筛选无结果” |
| 可重试错误 | 面板内错误与重试 | 错误条 + 详情区域 | 使用已有 actions；持续错误不依赖短暂 toast |
| 配置致命错误 | 可替换 `host.error` | 可替换 `host.error` | reload 原路径，游戏数据不重置 |
| 未安装/需修复 | 实例行与主按钮显示安装/修复 | 状态列与 Inspector 主动作 | 用 actualInstance 和 capabilities |
| 启动/运行/取消 | 首页主按钮状态 + 停止按钮 | 当前实例卡/任务区状态 + 停止 | use launch.phase / canStop；重复提交受原 guard 限制 |
| 下载失败/未知总量 | 状态行与展开失败详情 | 任务详情与不定进度 | 不伪造百分比；动作传原 task id，重试创建后端分配的新 id |
| 账户加载/过期/取消 | 账户面板与登录弹窗状态 | 账户卡与弹窗状态 | ready/loadError/promptExpired/cancelling 全覆盖 |
| 保存/选目录中 | 保存条显示处理中并禁用原受限动作 | 模块保存条与 pending | 草稿不移入页面局部 state |
| 浏览器预览 | 动作解释桌面能力限制 | 动作解释桌面能力限制 | 不触发真实安装/启动/文件动作 |

两套分别提供九类来源弹窗：`dialog.profile`、`dialog.instance-settings`、`dialog.import-instances`、`dialog.remove-profile`、`dialog.close-request`、`dialog.launch-account`、`dialog.login`、`dialog.preset`、`dialog.argument-template`。内容移除、账户登出确认也按各套件布局重做，继续绑定原 content/accounts 状态。删除残留文件重试不能丢 token；运行中关闭保留停止/后台/留在窗口选择；提交中按原规则阻止关闭。

全部弹窗使用既有 Dialog/Portal/Title/Description、初始焦点和返回焦点。长表单内部滚动，操作区可达；UI 不通过 page-local 状态代替账户登录、下载或业务草稿状态。通知继续 info/success/warning 3000ms、error 5000ms，hover/focus 暂停，错误细节仍可查；可定制 notification 来源不得吞掉持续状态。

App 当前可信来源编译前有硬编码 `suite-loading`。实现时去掉这块可见普通 UI：来源不可用的极短宿主引导阶段不另画固定文字/页面；可信来源可用后所有正常加载/错误走 `host.*`。可信来源本身无法准备的失败直接交给既有固定 Recovery。这样唯一不可替换的可见工具仍是 Recovery，而非另加固定启动画面。

## 9. 可定制来源、目标与接口

两份 suite.json 各自绑定 layout.shell、全部 page.*、component.*、dialog.*、host.*、onboarding.style-choice。新增组件视图为 `component.instance-detail`（`props.profileKey`）、`component.local-content`（`props.profileKey`）、`component.style-preview`（`props.style: 'modern' | 'immersive'`）；这些是新增 view ID，不是新增业务服务。

账户头像继续用 `component.account-avatar`，准确传 account/name，并使用 `UiIdentity namespace="account" value={account.id}`。重复实例行、详情和任务以稳定 key 与业务 identity 登记。所有新增 button/input/menu/row/状态的可视部分参与现有 JSX identity；CSS/HTML/TSX、position/business/type、Original 回退、ref/事件与主题 Portal 继续有效。无需保留旧位置链；新增位置要明确且稳定。

基础控件使用已有 `@paradox/ui` 的 Button/Input/Select/Toggle/Field/Panel/Progress/Dialog/Menu/Tabs/Tooltip/DragRegion；其可视控制节点仍可由 control.* 或现有 JSX 精确目标替换。两套分别声明控件外观，foundation CSS 只保留功能性基线。不要假设所有 compound parts 都已有一个新的 control.* ID，继续使用实际注册的 target 和来源内部 JSX 目标。

必要公开增量都由已有 owner 生成，不新增服务、队列或 IPC：

| 只读增量 | 类型 | 所有权与生命周期 |
| --- | --- | --- |
| `UiEditorSnapshot.initialSelectionRequired` | `boolean` | 既有编辑器控制器，含上述会话 latch |
| `LauncherSnapshot.launch.profileKey` | `string \| null` | useLauncher 的同步 launch/activity owner；准备发起真实 launch 时记录，终态/未登记请求失败释放；不从 activeKey 猜 |
| `LauncherSnapshot.profiles.scanning` / `scanError` | `boolean` / `string \| null` | useLauncher 现有 scanSequence 与配置根目录身份，旧 scan 回调不覆盖新请求 |
| `ContentSnapshot.listRequest` | `{profileKey:string; directory:string; category:ContentCategory; loading:boolean; error:string\|null} \| null` | 现有 content listToken/generation owner，与实际目录身份绑定 |
| `ContentSnapshot.searchError` | `string \| null` | 现有 searchToken/generation，随新搜索清除，失败保留可重试信息 |

启动账户选择期间归属来自 selection.profileKey；真正发起运行后归属来自 launch.profileKey。当原生重连/外部运行状态无可靠实例身份时 profileKey 为 null，只显示全局“游戏正在运行”与受限原因，不把状态归给 activeKey。从 B 直接启动且 activeKey 为 A 时，只把实例运行状态绘制在 B；A 保留自己的状态并显示全局操作限制。launch.profileKey 在配置重载/套件切换中不会被 activeKey 重写。

上述字段同时更新 public types、snapshot 白名单与 Provider 投影；列表 loading 不使用 content.pending（后者只表示变更动作）。既有版本用 `LauncherSnapshot['catalog']['versions'][number]` 推导类型，实际字段仅 id/kind；不从公共 barrel 导入未导出的 GameVersion。

详情内容同步在现有 content controller 泛化：routeId 为 content 或 custom.* 且显式提供 params.profileKey 时，由相同 owner 校准目标；同一事件内 guard 和随后 render 使用同一个 key，晚到旧列表按现有 token 丢弃。详情 route 缺失/已删除/非法 key 时是明确“实例不存在”状态，禁用本地操作并返回实例页，不能回退 active 或先前实例；其他 custom 页未提供 key 时仍可使用公开显式 content.selectProfile。来源进入详情时调用已有 content.selectProfile(key) 与 setCategory；列表绘制还核对 list.profileKey/category/directory。这样即使自定义套件重新安排详情，仍不产生第二份内容实现。

版本库在 source mount 调用已有 `catalog.refresh()`，由当前 owner 去重；去掉 Provider 进入 downloads 时自动加载版本目录的页面耦合。搜索、版本分组、实例筛选、日志过滤、Inspector 选择和详情本地页签为展示 state，可以在来源里保存。游戏选中、设置草稿、登录、下载和错误生命周期继续由永久 owner 管理。

普通编辑器仍是 `tool.editor` 与 files/source/assets，沿用外观、控制器、CAS 与素材管理。两套玩家样式不得污染 launcher.editor 根。用户可复制整套默认来源、编辑/导入/导出 CSS/HTML/TS/TSX/素材、添加自定义导航与页面。背景公开字段/动作不删除，默认来源不消费它们；用户来源可按自己的设计继续使用。

## 10. 无背景清理与显示修复

移除默认源码 `common/assets/world.svg`、`landscape.svg`，两份 manifest 的文件描述与所有默认 CSS 的图片 fallback / pseudo-element 背景消费。处理 legacy `ui/src/styles.css` 与 desktop.css 的旧路径，使无悬空引用；不借机改 unrelated legacy UI。现代首页 banner illustration、沉浸式 full-window 图片层和 has-background 分支都移除。

新配置 `appearance.background_art` 默认设为 false，前端 preview 与 Rust default 一致；已有配置不迁移、不清空。两套默认即使读取到用户以前保存的 background_file 也不渲染图片；通用图片 chooser/asset 协议和自定义来源能力保留。独立素材校验夹具不是默认背景，保留验证能力。

同时修复：modern 和 immersive 首页账户摘要均使用 active Microsoft 账户，否则显示离线；immersive 顶栏/侧栏向头像传 account；Modern 个性化入口先 setTab('appearance') 再 navigate('settings')；清理当前 common 与 immersive 后段反复覆盖的样式。

## 11. 可访问性、响应式与系统偏好

常规基准 1240×780；另验 960×640、800×600、640×480、320×240。宽度小于 960px 的 Modern Inspector 改为详情按钮/单页显示；小于 720px 两套导航折为明确菜单，内容一栏；首页启动按钮变为底部流式操作区，取消绝对定位覆盖。以缩放后的可用 CSS 空间布局，320×240 可以滚动到全部关键操作，不能要求内容一次全部可见。

表格在窄窗改带标签的行/卡，不横向挤压关键名称和操作；设置行变 label → value → control。Dialog 使用 viewport 上限和内部滚动。键盘可达导航、筛选、实例选择、主动作、弹窗关闭和保存；焦点有可见轮廓，Escape 只关闭最上层，不同时关 Select 和 Dialog。Ctrl+Enter 沿用既有永久守卫；Ctrl+Shift+F11/F12 始终按已有规则可达。

深浅主题由现有 `appearance.theme` 解析结果驱动，跟随系统不产生新的主题 owner。现有 ui_scale（合法85–120%）、font、radius、sidebar_opacity 使用相同公开变量，两套可用不同上限和排列，不拓宽配置校验范围。减少动效同时服从应用设置与 prefers-reduced-motion；只用 120–160ms opacity/轻微位移，无景物、视差或持续动画。正文普通对比度 >=4.5:1，组件边界/焦点 >=3:1；高 DPI 按 100/125/150/200% 原生检查，DPI与应用ui_scale分别测试，无固定像素裁切。

中文与英文翻译键一一对应，长实例名、路径、英文文案和错误可换行/截断并可查看完整内容。日志允许选取、保留换行和等宽字体。

## 12. 验收与完成标准

实施分为协议/状态、独立套件视觉、功能页面、回归验收四个依赖阶段，详见配套实施计划。静态/Node 检查之外，增加两套 × 主题 × 全页面/主要状态的浏览器矩阵、实际键盘操作、320×240 操作可达性、源码定制与切换连续性测试。生产编译后按实际 Tauri CSP 重跑；正常发行入口单独确认无测试 globals。

通过条件：两套全玩家流程可用；无默认背景图片请求或悬空 SVG；账户一致；版本库与下载职责清楚；详情内容不串实例；首次选择成功持久且错误可重试；全正常可见 UI 可由来源修改；普通编辑器保持可用；F12/--ui-safe Recovery 在损坏来源时可恢复；无重复 Provider/IPC/下载队列；用户数据和未完成业务草稿在切套件时保留。

Windows WebView2 的真实标题栏拖动/双击最大化、焦点、DPI、Microsoft 设备登录和游戏启动/停止另行原生验收。浏览器 mock 和截图不算原生成功证据；验收记录必须列出来源 commit、构建与实际测试结果。完成全部任务并验收后，检查 dev 差异、提交、推送远程。

## 13. 第一版草图

草图为离线绘制的设计示意，不是当前应用截图；样例实例/账户仅用于展示信息位置，最终图标用现有 Lucide。图中只有 UI 纯色面，没有游戏背景或图片背景。首轮覆盖五个关键布局，其余页面以上文完整页面/状态表为实施规格。

首轮自绘草图保留在本地工作区 `docs/ui-redesign-draft-2026-11-07/`，作为设计过程记录。交付验收采用实际默认来源的浏览器截图、命令结果和当前构建记录，见 [默认 UI 重设计验收](../../TESTING-UI-REDESIGN.md)。
