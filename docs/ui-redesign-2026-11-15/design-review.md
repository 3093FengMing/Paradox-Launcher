# 默认 UI 重设计评审与实施计划

日期：2026-11-15。工作区：`F:\rust-code\Paradox Launcher`。分支：`dev`。当前应用来源基线：`18ce9b29da7e712cfcbb52f729c425d8aea1bec8`。

**状态：两套默认界面已实施，本轮可执行的自动验收已完成，Windows 原生交互保留待验。用户已明确选择“折页的设计 + 石墨的配色”，并回复“按这版实施”。当前结果、final-v4 应用截图、输入/构建指纹与 Windows 待验边界见 [implementation-review.md](implementation-review.md)。仅本轮实际运行的报告、截图与构建产物计入验收，原型和历史结果不计为应用通过。**

这份文档是本轮唯一规划记录，保留设计阶段的方案、实施顺序与原型观察。它沿用现有业务与定制契约，不改写2026-11-07规格或2026-11-08验收记录。`DESIGN.md` 与 `.impeccable/design.json` 已从实际 final-v4 来源提取；原型记录不作为已实施来源或原生成功。

## 1. 已确认范围与本轮选择

用户已确认两套完整且独立的默认来源：沉浸式围绕日常实例选择、账户与启动；Modern 围绕多实例及内容管理。两套都具备全部现有玩家功能，共享质量体系和业务协议，不要求同一页面模板。

本轮采用“折页”结构与“石墨”配色的合成方向。沉浸式保留顶部主导航和上下文侧导航能力；Modern 保留窄侧导航、实例工作区和可收起的查看栏。密度紧凑但可读。HMCL与PCL CE参考图提供布局、控件和工艺参照，保留 Paradox Launcher 身份，不复制参考产品的品牌或功能。此前独立候选是设计过程材料，不作为同时叠加的默认风格。

两套均采用纯色表面，不创建或消费默认照片、插画、游戏封面或图片背景。用户已有图片、素材和公开定制能力保留。不得添加无支持数据的最近游玩、时长、收藏、云同步、兼容徽标、多个离线账户、下载暂停或排序。

中文/英文、键盘、可调整窗口、Windows高DPI、light/dark/system、85–120%应用缩放、现有字体/圆角/强调色设置与减少动效属于实施验收范围。系统DPI与应用缩放分别处理，不拓宽现有配置校验范围。

正常标题栏、导航、页面、控件、业务弹窗、首次样式选择、通知、加载/错误和普通UI编辑器继续可由套件来源定制。普通编辑器本轮维持既有外观与控制器。平时隐藏的 Recovery 是唯一固定界面；保留 `Ctrl+Shift+F11`、`Ctrl+Shift+F12` 和 `--ui-safe`。

事实来源：`PRODUCT.md`；`docs/superpowers/specs/2026-11-07-default-ui-redesign-design.md`；`docs/TESTING-UI-REDESIGN.md`；`docs/UI-CUSTOMIZATION.md`。本轮合成选择已记录于 PRODUCT.md；历史规格及验收记录不改写。

## 2. 视觉基线及证据时间边界

根流程在本会话核对149个builtin真实输入文件的SHA一致，并确认 `7a4b971..HEAD` 没有builtin变动。因此，既有截图可作为当前应用视觉基线的比较依据。这个输入集与旧验收记录中的套件打包文件数口径不同，不用文件数量代替字节一致性核对。

可比较的旧截图位于：

```text
.test-data/ui-redesign/dev/browser-batch/redesign-2026-11-08T04-51-28-954Z/check-ui-redesign-browser/
```

这些是2026-11-08 fixture/浏览器记录，不能标为2026-11-15合成设计的新运行结果，也不能当作本轮Windows原生成功证据。旧规格和 TESTING 文件中的“已通过”只描述其当时来源。本轮新应用来源一旦发生变化，就需使用新构建、新截图、新输入hash与实际命令输出重新记录。

设计阶段新增证据仅为独立HTML/CSS合成原型、原型静态核对及根流程另行补充的实际浏览器展示。原型里的实例与状态用于设计演示，不证明真实安装、修复、账户授权、下载、文件操作或游戏启动已成功。后续实际应用实施与验收证据另见 [implementation-review.md](implementation-review.md)。

## 3. 合成两页的视觉结构

本轮原型：

- `.impeccable/mocks/decision/fusion-immersive.html`
- `.impeccable/mocks/decision/fusion-modern.html`
- `.impeccable/mocks/decision/fusion.tokens.json`

沉浸式第一屏按折页组织为两块连续工作面。顶部承载主导航；左侧合并账户、当前实例、版本/加载器和配置摘要，以及明确的启动与详情动作；右侧承载实例集合、搜索/筛选和创建/导入。原型主列为 `.82fr / 1.38fr`，左侧启动摘要有最小宽度。选择实例后，启动摘要和目标名称可清楚对应。完整目标名不与操作挤在同一狭窄行；小窗改为单列可滚动内容及持续可达的启动区。其余页面的侧导航随上下文组织，不把首页实例列表硬套到设置或详情。

Modern 保留窄侧导航，主内容采用连续实例表与可收起查看栏。原型导航宽度为 `6.1rem`，查看栏为 `22rem`，关闭后表工作区扩展。实例名称、游戏版本、加载器、真实状态、详情动作形成可扫读的行列。查看、设为当前启动实例、打开完整详情是不同动作；查看项变化不得静默修改启动目标。查看栏或小窗启动区必须写明动作作用的实例，正式来源不能直接将设计板同名事件钩子当作业务实现。

原型 `data-route="versions"` / `"discover"` 等仅用于设计板演示。正式来源映射到既有 `custom.versions` / `content`；实例详情使用 `custom.instance-details` 和真实 `profileKey`，不新增裸路由或URL参数协议。

### Token来源与实施边界

设计阶段以 `fusion.tokens.json` 和两份fusion原型的实际inlineCSS作为视觉token候选来源。下表保留原型候选及当时实施原则；最终应用文件、实际尺寸和公开外观变量映射以 [DESIGN.md](../../DESIGN.md) 为准。

| 层级 | 合成原型中的值/语义 | 正式实现原则 |
| --- | --- | --- |
| Primitive | 石墨 `#24272D`、面板 `#30353D`、冷白 `#EDF1F7`、紫蓝 `#6676DC`、主动作字色 `#0D1022`；系统/CJK字体栈；14px正文基准；4/8/12/16/24/32px间距；约6px圆角 | 原始颜色与尺寸只在底层定义；不散落到页面组件。字体允许现有用户设置覆盖，正文不引入营销展示字体。 |
| Semantic | 浅/深主题分别定义app/panel/text/muted/line/controlLine/selection/error/ready/accentText/hover/input；主动作背景/前景单独配对 | 主题切换改变用途映射；system复用现有解析结果。错误、就绪、选择和品牌强调互不混淆；持续错误不靠短暂通知表达。 |
| Component | 34px普通控件、54px实例行、`.42rem`圆角；正文/主动作至少13px、元信息至少12px；窗口控件并入顶部导航或工作区标题行；小窗持续可达的启动条 | 组件引用语义层；两套布局可覆盖组件尺寸和排布，行为保障一致。实际文件应将原型中的直接语义色值收回primitive层，并核对JSON/CSS一致性。 |

主动作使用 `#6676DC` 与 `#0D1022`，原型token计算文字对比约4.66:1；同色配白字约4.05:1，不满足普通文字4.5:1目标，因此不采用白字。这个候选颜色计算不能替代实际所有控件及状态的渲染验收。

正式实现采用“primitive → semantic → component”三层CSS变量，复用当前公开theme/scale/font/radius/accent变量。原型字号、行高、极窄窗口标签、85%后的有效字号、点击目标和完整目标名称仍须实际验证；需要时设可读下限，不能把示意样式数值当作已经验收的标准。

## 4. 九条页面路线

两套分别实现以下全部页面，不把剩余页面留成首页占位。下面的排布是用户已确认的实施方案；实际来源与本轮验证结果另见实施记录。

| 公开route | 沉浸式设计 | Modern设计 | 必须保留的真实行为 |
| --- | --- | --- | --- |
| `home` | 折页启动摘要与实例选择工作面；账户、目标、状态和主动作形成一个明确动作链 | 当前启动目标摘要与实例/任务入口；与查看栏选择区分 | 无实例/未选实例、安装、修复、启动中、运行中、停止；使用真实账户与能力守卫 |
| `instances` | 上下文实例工具、紧凑连续行；搜索/扫描/导入/详情/设为启动目标明确分开 | 宽表、局部工具栏、数据驱动筛选、可收起Inspector | 查看不更改activeKey；稳定实例身份；扫描错误/残留文件重试；动态列表稳定key |
| `custom.instance-details` | 实例标题摘要、上下文本地内容导航、配置摘要和动作区 | 标题摘要、概览/设置/模组/资源包/光影/存档页签及相关任务 | 显式profileKey；缺失/删除/非法实例显示不存在，不回退当前或旧实例；编辑仍经既有draft弹窗 |
| `custom.versions` | 版本类型与搜索工具、紧凑版本集合、创建动作 | 类型筛选与版本表、选中版本创建摘要/弹窗 | catalog真实id/kind、缓存来源、刷新失败、继续加载；不造发布时间、更新日志或全库loader兼容筛选 |
| `downloads` | 连续任务行与可展开失败详情，当前任务动作靠近状态 | 状态分组、任务列表、详情与错误恢复工作面 | 真实进度/未知总量/取消/重试；动作传原task id，重试的新id由后端产生；无暂停或排序 |
| `accounts` | 账户行与上下文添加/离线设置/登录配置入口 | Microsoft账户集合、离线摘要和登录配置面板 | 一个离线名设置；选择/刷新/登出分开；设备代码、复制/打开网页、过期/取消/失败恢复 |
| `content` | 在线发现搜索与分类、真实结果和明确安装目标 | 搜索工具栏、结果工作面和安装目标选择 | 现有content owner及下载队列；支持的分类与导入；安装时校验兼容，不造事前兼容徽标 |
| `settings` | 上下文外观/游戏与Java/高级导航，紧凑label/value/control分组 | 分类导航与分区表单、保存状态清楚、小窗一栏 | 同一settings draft、保存中/失败/目录选择；套件管理与普通编辑器入口；保留用户配置 |
| `logs` | 简洁工具栏与可选择、可滚动的日志正文 | 全局日志工作面、级别/文本过滤和跟随开关 | 保留换行、等宽数据字体、可选择文字、导出/清除；不把全局日志误画为查看项私有日志 |

`custom.versions` 保持navigation/startupSelectable；`custom.instance-details` 不进入普通主导航。每个route.entry对应现有 `page.<routeId>`，继续走公开 `UiRouteViewport` 回退链。源码定位读取当前清单 `manifest.views`，不依赖旧common/pages或common/dialogs路径。

## 5. 九类业务弹窗与补充确认

两套拥有各自的弹窗来源与布局，但全部复用已有 `@paradox/ui` Dialog/Portal/Title/Description、键盘与焦点语义。沉浸式采用与摘要/上下文一致的紧凑分组；Modern采用清晰字段与常规分组，宽窗可两栏、小窗一栏。长表单在内部滚动，确认/取消操作可达。

| source ID | 具体设计原则与状态 |
| --- | --- |
| `dialog.profile` | 创建/重命名同一类：名称与版本/loader选择分组，错误贴近字段；有效值来自原草稿；查询/提交pending、失败与关闭守卫保留 |
| `dialog.instance-settings` | 继承/覆盖与有效值清楚；Java、内存、目录和参数有持续标签及来源说明；不新增页面局部编辑草稿；目录选择和提交走原校验 |
| `dialog.import-instances` | 导入来源、检测结果与待导入项连贯；解析错误可恢复；原pending与取消边界保留，不造扫描结果 |
| `dialog.remove-profile` | 实例完整名称、删除范围与不可撤销后果清楚；危险操作独立于普通启动；残留文件重试保留原token |
| `dialog.close-request` | 运行中明确列“停止并退出 / 后台继续 / 留在窗口”；不要把窗口X直接改成杀进程；停止中受原守卫保护 |
| `dialog.launch-account` | 账户身份、当前选择与可用性清楚；切换/确认分开；缺少账户、刷新中、不可启动与错误沿用公开状态 |
| `dialog.login` | 设备代码可选择/复制，授权网页入口清楚；过期、取消中和失败可恢复；不添加密码表单或未经支持的认证 |
| `dialog.preset` | 外观值与预览采用本轮语义色；明确应用范围、保存/取消与pending；不修改普通编辑器样式 |
| `dialog.argument-template` | 模板名称与参数编辑结构分明；代码/参数用等宽字体、保留文本选择；校验错误、草稿和保存守卫不变 |

内容移除、账户登出是另外两个确认入口，继续使用各套件视觉与原content/accounts状态；不将它们错误计入上面九类。

Escape只处理最上层：打开Select/Menu时不同时关闭业务Dialog。关闭返回触发点，初始焦点不落到高风险提交按钮。提交中能否关闭由原业务守卫决定，UI不新增绕过守卫的关闭按钮。

## 6. 所有正常状态的呈现

| 状态组 | 设计与业务要求 |
| --- | --- |
| host加载/配置致命错误 | 使用可替换 `host.loading` / `host.error`；不重挂Provider、不添加新的固定普通启动页；来源本身无法准备时交既有Recovery |
| 列表加载与刷新 | 保留框架、标题和合理旧数据；局部骨架/状态行，避免整个工作区跳动；列表loading不等同content变更pending，旧结果不能显示到新实例 |
| 无数据与筛选无结果 | 两种明确文案；前者提供新建/导入，后者提供清除条件；不伪造条目填充空白 |
| 可重试错误 | 错误就近、原因与恢复动作清楚；持续错误和诊断仍可查，不只用toast |
| 未安装/需修复 | 主动作与实例状态共同变化，依据actualInstance/capabilities；没有支持能力时解释不可用原因 |
| 启动/运行/停止/取消 | 明确launch.phase、目标与canStop；原重复提交guard保留；停止不能伪装为普通取消 |
| 下载失败/未知总量 | 未知总量不画假百分比；失败详情可展开；取消/重试传真实任务身份 |
| 账户ready/加载/过期/取消/失败 | 使用loadError/promptExpired/cancelling等实际状态；短暂取消不丢账户上下文 |
| 保存/选择目录/pending | 操作区显示真实处理中，禁用原受限动作；输入与草稿由永久owner保留，失败后可继续编辑 |
| 通知与持续诊断 | 沿用info/success/warning约3000ms、error约5000ms，hover/focus暂停；通知来源仍可替换，过期不清空持续诊断 |
| 浏览器预览能力限制 | 明确桌面专属操作；演示不触发真实文件、安装或游戏动作，不将预览成功写成业务成功 |
| 首次样式选择与套件失败 | 两套预览、选择后明确确认；准备/编译/CAS/激活失败保留选择并重试；不会因设计更换重置用户已保存选择 |

每个控件具有default/hover/focus/pressed/disabled/loading/error状态，状态通过文字、结构或图形共同表达。只读disabled与不可用原因需可理解；焦点不可被固定启动区或弹层完全遮住。

## 7. 交互与可访问性评审

按Emil Design Engineering的Before/After/Why格式记录改进。After是本轮待实施规则，不代表应用已修改；已确认结构以fusion原型为准。

| Before | After | Why |
| --- | --- | --- |
| 当前应用沿用2026-11-08的侧导航和原有页面组织 | 沉浸式落实顶部主导航与折页启动/实例两块工作面；Modern落实窄侧导航与连续实例表/Inspector | 两套分别围绕日常启动与管理任务组织同一能力，结构变化应体现在真实工作面 |
| 页面/Inspector查看选择容易被读成当前启动选择 | 文字明确当前启动目标与正在查看的实例；查看只改展示选择，设为目标是单独动作 | 玩家需要知道“启动”将作用于哪个实例 |
| 主动作与长实例名可能争夺同一行空间 | 目标名独立区域，可换行/查看全文；640/320小窗保留启动并允许内容滚动 | 缩窗和英文文案不能把启动目标挤没 |
| 高频导航、搜索或键盘动作若沿用装饰入场 | 键盘操作即时；频繁列表动作只保留必要反馈；不做页面编舞 | 高频操作的等待会被反复放大 |
| 弹层若从中心缩放或被滚动父容器裁切 | 继续用Base UI Portal；Popover/Tooltip原点遵循触发点，居中Dialog用中心原点 | 保持空间连续性并避免弹层被裁切 |
| 相同或不可中断的长动画应用到所有控件 | 约120–160ms普通反馈，小弹层约125–200ms，偶发Dialog约180–250ms；CSS transition明确属性、可中断；退出更快 | 动效解释状态，不能阻塞操作或让快速反向动作重播 |
| 减少动效只停一部分装饰 | 同时服从应用设置与prefers-reduced-motion，移除位移/弹跳和编舞，保留必要状态可读性 | 系统偏好与应用偏好都必须有效 |

颜色检验目标为普通文字/placeholder至少4.5:1，需辨识的控件边界及焦点至少3:1；2px清楚焦点轮廓作为质量目标。指针目标最低按Web WCAG 2.2的24 CSS px或有效例外判断；不把iOS44pt/Android48dp直接当Windows WebView统一标准。AA“焦点不完全被遮住”与AAA“完全不遮挡/特定焦点面积”分清，不能错误声明级别。缩放后重新测量。

中文与英文使用现有 `useTranslation` / 翻译键，保持持久标签；图标按钮有可访问名称，装饰SVG有 `aria-hidden`。DOM顺序与视觉顺序一致，不用正tabindex修补布局。表格小窗转带标签的行，不裁掉必需值；chip换行或提供可操作的隐藏项展开。日志、代码、长路径允许选择文本并保留格式。Windows拖拽区域不盖住输入、按钮、复选框和选中文本。

### 本会话Web Interface Guidelines源文件发现

根流程于2026-11-15重新获取[最新Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)，并从实际来源核对下列两处。本记录保留它们为实施修复项，不宣称已完成全应用审计。

| 源位置 | Before | After | Why |
| --- | --- | --- | --- |
| `ui/src/ui-suite/builtins/modern/components/AppSidebar.tsx:47` | route装饰 `Icon` 未设置 `aria-hidden`；按钮已有aria-label/title及可见文字 | 为该装饰Icon补 `aria-hidden="true"`，保留site及原按钮行为 | 避免图标向辅助技术重复报读；不应误写为按钮缺少标签 |
| `ui/src/ui-suite/builtins/modern/pages/InstancesPage.tsx:24` | 搜索input已有aria-label，但缺name/autocomplete；装饰Search缺aria-hidden | 保留aria-label，添加稳定name和适合本地实例过滤的 `autoComplete="off"`；Search补aria-hidden | 输入语义完整，减少浏览器无关历史填充，装饰不干扰名称 |

只采用适用于本地React/Vite/Tauri工作面的规则，不把URL查询状态、SSR、Next/RSC或营销转化规则带入套件。不存在本轮为此引入Next或升级依赖的计划。

## 8. 研究采用与排除依据

UI UX Pro Max使用真实绝对脚本进行了完整 `--design-system` 查询，结果是 `Product Demo + Features` 营销结构，配色说明还命中 `Word green + letter amber`；按契约缩窄为 `Minecraft desktop launcher compact utility` 重试，仍返回 `Hero + Features + CTA` 与landing-page字体。两轮均不适配桌面Minecraft启动器，未持久化为MASTER，也不作为本轮token来源。

采用的是独立、适配任务的UX/React查询：dialog焦点圈定及关闭返回、语义HTML与持久标签、focus不遮挡、text resizing/reflow、chip可展开、目标尺寸、对比与键盘导航。React大列表查询支持稳定ID keys与按实际规模考虑windowing，不构成安装虚拟列表库的授权；其数据集标注React19.2.x，通用语义规则可用，现有项目版本不因此回退或升级。

Design System提供三层token架构；UI Styling采用组合、主题、焦点与响应式原则，舍去其shadcn/Tailwind安装流程。Emil用于频率、用途、可中断反馈和弹层空间原则。Impeccable在Operate模式下只承载类型、配色、密度与选定结构，不把来源的营销徽标、微小字体或装饰系统照搬进启动器。

## 9. 实现边界与协议保持

实际实现仍在现有React/Vite/Tauri项目和dev分支内，使用现有Base UI封装 **从 `@paradox/ui` 导入** Button/Input/Select/Toggle/Field/Panel/Progress/Dialog/Menu/Tabs/Tooltip/DragRegion及其实际已注册来源。套件来源不直接导入私有 `@base-ui/react` 实现；不安装shadcn、Tailwind、Next或新的UI基础层。

共享一个永久 `LauncherProvider` 和现有 `UiEditorProvider`。来源读取真实 `@paradox/launcher` snapshot/actions/capabilities；不新增Provider、私有hooks/controller、IPC订阅、直接Modrinth fetch或第二份下载队列。游戏选中、设置/实例草稿、账户登录、下载、错误与保存生命周期留在原owner；搜索/筛选、页签和Inspector等纯展示状态按现有公开接口或来源保存。

两份suite分别维护全部 `layout.shell/page.*/component.*/dialog.*/host.*/onboarding.style-choice`。共享纯数据解释及foundation行为，不共享强迫同布局的玩家页面。common继续保留纯helpers和普通编辑器；玩家样式不得污染 `launcher.editor` 根。

公开源码白名单维持 `react`、`react/jsx-runtime`、`lucide-react`、`@paradox/ui`、`@paradox/launcher`、`react-i18next` 的useTranslation与套件内静态相对模块。禁止动态import、任意require、远程模块、私有Provider/controller；编译不使用eval、Function或unsafe-eval。本轮只是重新安排公开可视来源，不改变schema_version/api_version=1。

保留UiView/UiIdentity及已存在site keys、业务identity和安全定位结构。结构重排时新调用位置明确稳定，不迁移旧位置链、不保存临时ownerId。Original沿当前位置进入下一来源，完整转发props/children/ref/disabled/回调与原业务身份，不借另一实例导出。position/business/type、Fragment/Portal多根、CSS/HTML/TS/TSX替换与主题Portal继续有效。

preview/save、revision CAS、draft、选择、素材导入/导出、父快照字节与库恢复协议不变。切套件或关重开编辑器不丢未完成草稿。首次选择的CAS/activation/session latch及晚到ACK守卫保持；F12后晚到编译或保存不能重新激活用户UI。Recovery继续在既有ShadowRoot中，以原字节token比较/备份/恢复同一库。

## 10. 分阶段实施计划与完成条件

下列保留 **用户确认后执行的实施阶段与顺序**，不作为当前待办状态。两套应用来源已完成；自动验收结果见实施记录，未实际完成的原生操作仍标待验。旧通过记录不填入新验收表。

| 阶段 | 工作与可审阅产物 | 进入下一阶段的条件 |
| --- | --- | --- |
| 0 设计确认 | 根流程实际渲染两份fusion，核对中文/英文、深浅、85/100/120、小窗与Inspector；补充原型证据；确认合成两页和本计划 | 用户对合成视觉及实施范围确认；原型问题先修正 |
| 1 token与独立Shell | 从fusion候选映射到两套实际tokens/layout/components；落实顶部/侧导航、上下文、标题栏和小窗启动；修复两处WIG源项 | 两套各自结构与确认原型一致；公开变量和行为守卫仍有效；普通编辑器外观不受影响 |
| 2 九条页面 | 按§4完成全部两套页面；详情profileKey、查看/启动选择、版本与下载职责、在线/本地内容边界逐项核对 | 全页面使用真实snapshot/actions，无占位业务、无新owner；中英文与小窗可达 |
| 3 九类弹窗及状态 | 按§5–6完成独立来源；首次选择、host、通知、pending/error/empty、关闭/焦点与恢复贯穿验证 | 真实Dialog/Select/Menu守卫、草稿和CAS不变；所有正常可见来源仍可定制 |
| 4 应用验证与审阅 | 运行静态/Node/构建、开发和编译后矩阵、CSP生产、定制旅程、原生/DPI；批量观察渲染并修复实际问题 | 每一新记录有命令/源码hash/构建/截图与实际结果；未验证原生项保持待验，不宣称完成 |
| 5 设计记录与交付 | 从验收后的实际源码生成DESIGN.md及.impeccable/design.json，记录两套真实token与行为；复核dev差异 | 来源实施与本轮可执行验收完成后按既有授权commit/push dev；原生待验范围随产物记录；用户.gitignore修改保留且不暂存 |

### 实施后应用验证清单

静态、类型、翻译、Node与构建必须实际重跑并保存输出，现有根入口为：

```powershell
npm run check:ui
npm run lint:ui
npm run check:i18n
npm run test:ui
npm --prefix ui run test:suite
npm run build:ui
```

浏览器使用既有工具及真实应用root、永久业务owner、公开actions。Foundation、定制/Inspector、Suite与完整redesign入口按现有TESTING文档运行；错误/延迟从原native invoke/event边界注入，不另造业务snapshot或demo Provider。

完整redesign先覆盖首页、实例、版本/下载、账户/发现、默认设置、弹窗、日志/响应式七项专项，再跑 **两套 × 两主题 × 三应用缩放 × 三窗口尺寸 = 36个独立上下文**。每个上下文覆盖14类状态、九类Dialog、真实导航和键盘。主矩阵1240×780、640×480、320×240；960×640、800×600等补充尺寸按专项，另核对用户实际预览尺寸。最终清除focused/matrix子集过滤，不以单一截图代替完整矩阵。

编译后分别构建现有foundation-test/suite-builtins-test产物，并注入 `apps/desktop/tauri.conf.json` 的实际Tauri CSP；不能用开发服务加CSP标志代替编译后验收。检查无 `/src/`、`/node_modules/` 请求、页面错误或违规。普通 `ui/dist` 生产入口另确认没有fixture安装器或test globals、没有背景/远程资源误请求。

两套复制、CSS/HTML/TSX修改、Original、目标拾取、普通编辑器、草稿预览/保存/重启、导出/重导入、CAS冲突、F12及safe Recovery构成实际定制旅程。只改CSS时保留真实输入DOM；HTML/TSX替换仍保留ref、回调与草稿。切套件确认Provider/IPC/队列没有增殖。

键盘全流程验证Tab/Shift+Tab、Enter、Escape、菜单/Select、初始及返回焦点、Ctrl+Enter与F11/F12。减少动效分别测试应用开关与操作系统偏好，并检查真实Portal backdrop/popup。中文/英文、长实例名/路径/错误、比例85/100/120、深浅与system切换分别记录，不只看默认中文深色。

Windows本轮新构建另记录exe路径、SHA、输入与构建日志；真实标题栏拖动/双击最大化、点击与文本选择不误拖、WebView2焦点、Windows100/125/150/200%DPI、实际Microsoft授权/刷新/过期/取消、真实安装/修复/启动/停止及运行中关闭行为分别验收。旧debug exe和浏览器fixture不能代表这些项目通过。未实际操作的项目保持待验并说明缺口。

## 11. 根流程补充：合成原型实际核验与截图

核验日期：2026-11-15。浏览器：Codex in-app Chromium。实际检查对象是两份fusion独立原型，使用六个示意实例与Alex账户；没有启动、安装或授权真实游戏。

交互预览保留于 `http://127.0.0.1:2299/`。为稳定导出补充截图，另运行同一预览服务器的2300端口，通过 `/sketches/fusion-{mode}.html?theme=…&language=…&scale=…` 生成相同CSS及叶文案的静态展示。此路径仅设置主题、缩放与英文叶文本，不运行父板交互脚本。所有八张最终图均通过浏览器实际渲染，最后检查本地JPEG完整性和像素尺寸。中途导出出现超时及缩放后的重复画面，已舍弃；同名证据只保留最后观察到的完整画面。

下面是**八组独立原型抽查**，不能标为§10的36上下文应用矩阵通过。`evidence/` 内的文件名均以 `fusion-static-` 开头。

| 布局 | 主题 / 语言 | 请求窗口 / 应用缩放 | 观察结果 | 截图文件 |
| --- | --- | --- | --- | --- |
| 沉浸式 | 深 / 中文 | 1240×780 / 100% | 两列折页、集中账户与启动、长名称显示；启动按钮约384×56px | `fusion-static-immersive-dark-zh-1240x780-100.jpg` |
| Modern | 深 / 中文 | 1240×780 / 100% | 窄侧导航、连续实例表、Inspector展开；独立设为启动目标按钮 | `fusion-static-modern-dark-zh-1240x780-100.jpg` |
| 沉浸式 | 浅 / 英文 | 1240×780 / 85% | 正文13px、元信息12px；主启动约396×48px，无根水平溢出 | `fusion-static-immersive-light-en-1240x780-85.jpg` |
| Modern | 浅 / 英文 | 1240×780 / 85% | 正文13px、元信息12px；长名称换行，Inspector文字与动作可见 | `fusion-static-modern-light-en-1240x780-85.jpg` |
| 沉浸式 | 浅 / 英文 | 640×480 / 120% | 单列内容滚动，底部启动持续可见，主动作约172×41px | `fusion-static-immersive-light-en-640x480-120.jpg` |
| Modern | 浅 / 英文 | 640×480 / 120% | 顶部窄导航转换为横向；Inspector默认收起，底部启动可见 | `fusion-static-modern-light-en-640x480-120.jpg` |
| 沉浸式 | 深 / 英文 | 320×240 / 120% | 主导航局部水平滚动，内容垂直滚动；启动按钮在窗口内 | `fusion-static-immersive-dark-en-320x240-120.jpg` |
| Modern | 深 / 英文 | 320×240 / 120% | 主内容滚动，固定底部启动；按钮底边约228px，位于240px窗口内 | `fusion-static-modern-dark-en-320x240-120.jpg` |

八组根文档均未出现横向溢出；320/640的Modern原型在浏览器垂直滚动条下实际可用根宽为310/630px。极窄窗口是操作可达性压力检查，导航文字可换行、目标名可以省略显示；交互父板对完整目标名提供title，并把完整名称写入启动/详情按钮的可访问标签。正式应用仍须验证键盘可获知完整名称，不把原型title等同于最终可访问性验收。

父板实际交互检查结果：

- 沉浸式由survival选择creative后，目标标题、版本、加载器及唯一“当前”标记一致更新；启动控件的示意实例身份同步。
- Modern查看island再显式设为启动目标，随后查看survival，仍保持current=island、viewed=survival；Inspector启动作用survival，底部启动作用island。查看不静默切换启动目标。
- 页内收起/展开Inspector均有效；关闭后表工作区扩展。
- 搜索Fabric实际匹配survival和lightweight；版本筛选1.20.1实际匹配workshop和island，清空恢复六行。
- 设置示意Dialog打开后初始焦点在Java选择器；取消及Escape均关闭并返回触发按钮。详情示意反馈与设置Dialog已分开。
- 英文正文、搜索/筛选、窗口控件、Inspector收起的辅助标签已补齐。外层评审工具栏和示意反馈保留中文，语言选择只表示原型语言。

本轮实际发现并修正：当前徽标未随选择移动；示意操作身份未随标题更新；页内展开动作错误；隐藏属性阻止Dialog显示；85%字号偏小；英文Java标签和辅助标签遗漏；搜索读取错误输入；Modern极小窗口启动条被标题区挤出。修正均局限于独立原型与父板，未修改应用来源。

Impeccable静态机械检查实际扫描两份fusion、父板index/CSS/JS，输出为 `[]`，记录在 `evidence/impeccable-detect.json`；它不代替以上实际渲染与交互观察。当前源码、token、脚本及截图SHA-256与观测尺寸记录在 `evidence/prototype-review.json`。

原型阶段尚未执行全部应用组合、system主题、减少动效、九页面/九Dialog真实来源、长路径/错误及生产CSP等验证；后续实际应用结果见实施记录。Windows原生DPI与真实业务旅程仍待验。本区只保留原型观察，不宣称原型证明应用或原生通过。

## 12. 本轮执行状态

用户选择“折页结构 + 石墨配色”后，两套完整默认来源、九条页面路线、九类业务弹窗与补充状态均已实施。final-v4 应用图像、设计系统、完整输入/产物指纹及验证证据已归档；本轮可执行的自动验收已完成，原生未实际操作范围随构建产物明确交付。原型观察仍属于设计阶段。

**提交与推送沿用本会话既有授权。保留用户现有 `.gitignore` 修改且不暂存；Windows 原生操作未验范围见 [implementation-review.md](implementation-review.md)，不由浏览器边界测试代替。**
