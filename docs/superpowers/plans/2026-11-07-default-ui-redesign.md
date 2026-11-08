# Paradox Launcher Default UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成两套独立、完整、默认无图片背景的玩家 UI，并使全部正常界面继续由同一个来源套件协议定制。

**Architecture:** 永久 LauncherProvider / UiEditorProvider 保持唯一业务所有者。modern 与 immersive 分别拥有玩家视图与样式，common 只保留纯辅助及现有普通编辑器；新页面使用已有 custom.* 路由。必要加载/错误/运行归属字段在现有 owner 与公共白名单增补，不增加业务服务或 IPC。

**Tech Stack:** 当前锁定的 React 19、TypeScript 6、Vite 8、Tauri 2、Base UI 1.9、现有 Rust/Cargo workspace；不为本次增加运行时依赖。

**Spec:** `docs/superpowers/specs/2026-11-07-default-ui-redesign-design.md`。执行者先读完整设计，再按本计划实施。草图在 `docs/ui-redesign-draft-2026-11-07/`，仅作布局示意。

## Global Constraints

- 工作区 `F:\rust-code\Paradox Launcher`，分支 dev，起点 `208198063f5bcb63da27cfa88bc995ab7cd82ead`；使用当前 checkout，不创建 worktree，不改 vendor/QuintElement。
- 用户2026-11-07已明确要求继续执行，并补充HMCL作为沉浸式参考、允许设计改进。下列任务按实际验收更新进度，草图不等同已实现界面。
- 两套默认设计不渲染任何图片背景；移除 world.svg、landscape.svg 及生产默认引用，不清空用户配置、上传文件或用户套件父快照。
- 全正常 UI、首次选择、控件、状态和普通编辑器可定制；唯一固定 Recovery 保留 F12 与 --ui-safe。
- 只用一个永久 Provider、内容 owner、catalog、下载队列与设置写队列；默认来源使用公开 @paradox/launcher / @paradox/ui，不直接 fetch/invoke，不导入私有业务 hooks。
- 保持 schema_version=1 / api_version=1；使用 custom.versions 和 custom.instance-details，资源发现沿用 content，不做旧 UI 或定位迁移。
- Node 环境满足 `^22.13.0 || >=24`；保持现有 lockfile 与依赖，不顺带升级工具链。
- 深浅/系统主题、ui_scale、减少动效、中英文、320×240 可达性、原生高 DPI 都属于验收；普通编辑器外观沿用现有。
- 全部任务和适当验收完成后在 dev 提交推送；未完成不能宣称提交交付。仅对本次差异暂存，保留他人改动。

## Review Focus

- activeKey=A 时从 B 发起游戏，界面只能把运行状态归 B；未知原生归属显示全局状态，不猜 A（Task 2）。
- 内容 A 慢响应、切 B、删除 B 或改变目录：加载/错误和修改动作必须核对同一个当前身份，不能触及 A（Task 2/5）。
- 首次选择排队、CAS 冲突、ACK 后编译/安装失败、F12 介入：正确保存/重读/解除 latch，不能提前离开选择页或重新激活（Task 3）。
- 用户已保存图片配置、用户套件图片和普通编辑器同屏：默认依旧无图，用户套件素材能力与 editor 根仍完整（Task 1/11）。
- 320×240、英文长字符串、200% DPI、层叠菜单/弹窗：主动作、取消、保存、Recovery 必须可达且焦点回到合理位置（Task 4–11）。

## File Structure and Dependencies

现有 private 业务实现继续位于 `ui/src/hooks/`、`ui/src/launcher/controllers/` 与 public snapshot。新增源码结构：

- `builtins/common/lib/launcher-display.ts`：纯账户/实例/任务显示派生，不订阅业务、不写配置。
- `builtins/modern/styles/` 与 `builtins/immersive/styles/`：分别为 tokens.css、layout.css、components.css、pages.css；style.css 是各自唯一玩家全局入口。
- 两套分别新增 `pages/{InstancesPage,InstanceDetailPage,VersionsPage,DownloadsPage,AccountsPage,DiscoverPage,SettingsPage,LogsPage}.tsx`。
- 两套分别新增 `components/{WindowBar,AppSidebar,ProfileCard,InstanceDetail,LocalContent,DownloadQueue,AccountAvatar,JavaSettings,ArgumentTemplates,AppearanceSettings,PersonalizationSettings,AppearancePresets,ActivityBar}.tsx`。
- 两套分别新增 `dialogs/{LauncherDialog,ProfileDialog,InstanceSettingsDialog,ImportInstancesDialog,RemoveProfileDialog,CloseRequestDialog,LaunchAccountDialog,AccountLoginDialog,AppearancePresetDialog,ArgumentTemplateDialog}.tsx`。
- 两套分别新增 `onboarding/{StyleChoice,StylePreview}.tsx` 及 `{Loading,Error,Notifications}.tsx`。
- common/editor 的现有源码与 CSS 保留；common/lib/view.tsx 改为无玩家样式副作用。
- 新浏览器验收脚本 `ui/scripts/check-ui-redesign-browser.mjs`，测试场景扩展已有 `ui/src/ui-tests/suite-builtins-fixture.tsx`，不新挂第二个应用 root。

依赖：Task 1 → Task 2 → Task 3 → Task 4；Task 4 → Task 5/6/7/8/10（可在两套视觉文件互不冲突时并行）；Task 8 → Task 9；Task 5/6/7/9/10 → Task 11。共享 public types、Provider、manifest 和共用测试由单一任务所有者编辑，避免并行覆盖。

## Task 1: 默认无图与来源样式边界

**Files:**
- Delete: `ui/src/ui-suite/builtins/common/assets/world.svg`、`landscape.svg`。
- Modify: 两套 suite.json、style.css；common/style.css、common/styles/common.css、common/lib/view.tsx；`ui/src/styles.css`、`ui/src/desktop.css` 的背景引用；`ui/src/api.ts`、`crates/launcher-core/src/model.rs` 的新配置默认。
- Create: 两套 styles/tokens.css、layout.css、components.css、pages.css。
- Test: `ui/scripts/check-ui-suite-browser.mjs`、`ui/src/ui-tests/suite-builtins-fixture.tsx`、`ui/scripts/check-personalization.mjs`、`ui/scripts/lib/hook-test-host.mjs`。

**Interfaces:**
- Consumes: 当前 appearanceVariables、suite styles 安装、manifest 文件描述归一化。
- Produces: default background_art=false；两套纯色样式 token；viewProps/sourceView 签名不变且不 import 玩家 CSS。保留 chooseBackground/clearBackground、appearance.background、素材导入与父快照格式。

- [x] Step 1: 先记录默认来源与编辑器的基线。为 `default_suite_ignores_saved_background` 加断言：无论已有 background_file/--background-image/--banner-image 是否存在，默认 Shell/Home/窗口栏都无 background-image；内置 asset 列表允许为空；复制来源后用户自己加入图片仍可导入/预览/保存。
- [x] Step 2: 清除上述 SVG 和所有生产引用/图片消费层；新 default 改 false，既有配置不写迁移。各 suite 样式入口明确安装顺序，保留尚未重做页面的必要公共规则直到迁移结束；不追加新的后段覆盖块。
- [x] Step 3: 更新 manifests 的 files/bytes/SHA 描述；继承测试改用实际源码文件证明固定父快照字节，不再依赖 world.svg。保留 PNG/SVG 格式校验夹具，它们属于通用素材测试。
- [x] Step 4: 运行 `npm run check:ui`、`npm --prefix ui run test:suite`、`npm --prefix ui run test:suite-compiler`、`npm run build:ui`；运行 check-personalization.mjs 验证已保存数据和通用图像能力。Rust 默认改动运行对应 model/default 测试，完整 Rust 检查在 Task 11。

## Task 2: 运行归属、读取状态与详情当前身份

**Files:**
- Modify: `ui/src/hooks/useLauncher.ts`、`ui/src/launcher/controllers/launch.ts`、`content.ts`、`ui/src/launcher/LauncherProvider.tsx`、`snapshot.ts`、`services.ts`、`public/types.ts`、`public/index.ts`（仅必要 type exports）。
- Create: `ui/src/ui-suite/builtins/common/lib/launcher-display.ts`。
- Test: `ui/scripts/check-launcher-public-api.mjs`、`ui/scripts/check-launch-cancellation.mjs`、`ui/scripts/check-account-experience.mjs`、`ui/src/ui-tests/launcher-view-fixture.tsx`。

**Interfaces:**
- Produces: `LaunchSnapshot.profileKey: string | null`；`LauncherSnapshot.profiles.scanning: boolean`、`scanError: string | null`；`ContentSnapshot.listRequest: {profileKey:string;directory:string;category:ContentCategory;loading:boolean;error:string|null}|null`、`searchError:string|null`。全部 detached/frozen，不暴露 token/owner。
- Existing actions unchanged: content.selectProfile/setCategory/refresh/search/toggleMod/beginRemove/confirmRemove；catalog.refresh；profiles.scan；launch.request/stop。
- Pure helper types: `type ActiveAccountDisplay = {account:DeepReadonly<LauncherSnapshot['accounts']['state']['accounts'][number]>|null;name:string;kind:'microsoft'|'offline'}`；`resolveActiveAccount(snapshot:DeepReadonly<LauncherSnapshot>):ActiveAccountDisplay`；`resolveProfileEntry(snapshot:DeepReadonly<LauncherSnapshot>,key:string|null):DeepReadonly<LauncherSnapshot['profiles']['items'][number]>|null`。不创建另一 state owner。

- [x] Step 1: 给现有业务回归增加命名场景：`launch_B_while_active_A` 断言 activeKey 不变、真实 runAction 的 profileKey=B，始终不把 phase 归 A；终态/乐观请求拒绝清 key；原生重连未知 key=null。
- [x] Step 2: 在 useLauncher 当前 actionSequence/busyRef 所有者记录运行 key，并以 getGuardState → launch snapshot 投影。只有真实启动提交进入 started 才登记；账户选择用原 selection.profileKey；旧 action 完成不得清新 action 身份。
- [x] Step 3: 将扫描 pending/error 绑定现有 scanSequence/lifecycle/root 身份；将本地读取状态/error 绑定现有 listToken/generation/directory；将搜索 error 绑定 searchToken。读取失败留下可重试状态，新请求清对应错误；变更 pending 语义不改。
- [x] Step 4: 扩展 content 当前 key 解析：content/custom.* 的显式 profileKey 同步采纳；custom.instance-details 缺失/删除 key 明确返回 null；其他 custom 无参数可继续用显式 selectProfile。`no_render_navigate_B_then_toggle_A`、`missing_detail_key_cannot_fallback`、`late_A_after_B`、`directory_changed_same_key` 分别断言不执行旧内容写操作、无目标无动作、旧响应不显示、只显示新目录结果。
- [x] Step 5: 扫描/内容/API类型增量同时修改 snapshot 白名单，实现上述无副作用纯helper，不传原服务对象。版本加载入口的迁移留到Task 6新版本库可用时，避免中间任务使现有目录不可达。
- [x] Step 6: 运行 `npm --prefix ui run test:launcher`、`npm run test:ui` 与相关 launcher browser fixture；确认多次读取公开 hooks 和切换套件不增加业务服务/IPC订阅，unknown key 对应无目标状态。

## Task 3: 首次样式选择与启动引导

**Files:**
- Modify: `ui/src/ui-editor/public.ts`、`controller.tsx`、`ui/src/App.tsx`、两套 suite.json、Shell.tsx；locale 两文件。
- Create: 两套 onboarding/StyleChoice.tsx、StylePreview.tsx。
- Test: `ui/src/ui-tests/suite-builtins-fixture.tsx`、`ui-tests/suite-final-fixture.tsx`、`ui/scripts/check-ui-suite-browser.mjs`、`check-ui-final-browser.mjs`、`check-ui-customization-lifecycle.mjs`。

**Interfaces:**
- Produces: `UiEditorSnapshot.initialSelectionRequired: boolean`，初始 false，库/config/trusted 都就绪且普通 pristine 会话才 true；新增 view IDs onboarding.style-choice、component.style-preview。
- Consumes: 原 selectSuite('builtin.modern'|'builtin.immersive'):Promise<boolean>、pending/diagnostics、storage CAS、原 activation/write/life generations。不新增持久字段/IPC。

- [x] Step 1: 首次冷启动场景 `pristine_library_first` / `pristine_source_first` 均断言没有自动 save、显示两张预览；确认一次后 revision=1、active 正确、普通重启不再首次。reset revision>=1 和损坏 DATA 不显示首次；safe 模式不写 pristine。
- [x] Step 2: 在现有 editor controller 实现会话 latch。首次选择先准备候选、serialize 执行前验证 generation，再保存 CAS；ACK 后仍保持选择页，install 同 generation 成功才解除。界面 pending 保留选中输入，失败使用既有诊断/错误状态和重试。
- [x] Step 3: 补 `cas_conflict_reload_authority`、`ack_then_install_failure_keeps_choice`、`F12_before_queued_write`、`F12_after_saved_ack`：冲突后重读当前 revision/active；排队未写的选择不能写；已写 ACK 只更新权威库不激活，下一次普通启动读取已保存来源。
- [x] Step 4: 两套分别实现静态预览卡、用途、键盘选择和确认；预览不挂业务组件、不订阅 IPC、不执行主启动按钮。默认推荐沉浸式但必须显式确认。Shell 保持窗口动作，选择内容由普通 UiView 渲染。
- [x] Step 5: 删除 App 可见硬编码 suite-loading 文本。极短准备阶段不另画固定普通界面；正常 loading/error 进入来源，可信 builtin 无法准备走同一个固定 Recovery。确保 F12 在来源准备失败时依旧可达。
- [x] Step 6: 跑 suite builtin 冷启动、final browser 与 lifecycle 回归；真实修改 onboarding 来源后 Preview/Save/reload 生效，320×240 两种选项与确认可点击。

## Task 4: 两套 Shell、首页与正常状态来源

**Files:**
- Modify: 两套 Shell.tsx、Home.tsx、style.css、styles/*、suite.json；locale 两文件。
- Create: 两套 components/WindowBar.tsx、AppSidebar.tsx、ActivityBar.tsx、AccountAvatar.tsx；Loading.tsx、Error.tsx、Notifications.tsx。
- Test: suite-builtins-fixture.tsx、check-ui-suite-browser.mjs、check-account-experience.mjs、check-ui-final-browser.mjs。

**Interfaces:**
- Consumes: Task 2 launch.profileKey、账户 helper、profile capabilities；Task 3 initialSelectionRequired；原 navigation/window/notifications actions。
- Produces: 两套独立 layout.shell / page.home / component.window-bar/app-sidebar/activity-bar/account-avatar / host.loading/error/notifications。全部通过来源目标登记。

- [x] Step 1: 沉浸式按设计第5节实现紫蓝 44px 标题栏、上下文侧栏、纯色留白首页和分体启动；Modern 按第6节实现 42px 标题栏、固定导航、当前实例/任务/实例概况。使用真实数据，不增加最近游玩/收藏字段。
- [x] Step 2: 每处账户摘要都通过实际 active 账户 helper；头像传 account 并登记 account identity。Modern 个性化动作先 setTab('appearance') 再 navigate('settings')，两套都核验。
- [x] Step 3: 主动作按 capabilities、launch.profileKey 与全局受限原因绘制；B 运行时 A 首页不能写成“A 正在运行”。未知归属用独立全局状态，停止仍调用同一个 launch.stop。
- [x] Step 4: Shell 从实际 navigation.routes 渲染入口，自定义隐藏/更换 routes 不复活固定菜单；沉浸式子页侧栏保留首页可达。所有 loading/error/notice 用本套件来源，错误重试回到原业务 action，通知TTL/暂停语义不变。
- [x] Step 5: 用键盘操作分体菜单、账户、窗口按钮；640px 以下启动区改流式并保留停止。新来源可单独覆盖，普通 editor 根不受玩家样式影响。运行 builtin/final、notice 与 foundation browser 回归。

## Task 5: 实例列表、完整详情与本地内容

**Files:**
- Create: 两套 pages/InstancesPage.tsx、InstanceDetailPage.tsx；components/ProfileCard.tsx、InstanceDetail.tsx、LocalContent.tsx。
- Modify: 两套 suite.json、components/AppSidebar.tsx、styles/*；locale 两文件。
- Test: launcher-view-fixture.tsx、suite-builtins-fixture.tsx、check-launcher-public-api-browser.mjs、check-ui-customization-browser.mjs。

**Interfaces:**
- Produces: page.instances；page.custom.instance-details，route navigation/startupSelectable=false；component.instance-detail/local-content 的规范 props.profileKey。
- Consumes: 现有 profile/instanceDraft/removal/importDraft、content 的所有本地动作；Task 2 listRequest/current身份。详情本地页签是展示 state，设置只读摘要 + 原 instanceDraft.open(key) 弹窗。

- [x] Step 1: 沉浸式紧凑行与Modern表格/Inspector分别实现。行选择详情不写 activeKey；“设为当前”显式调用 profiles.select。搜索/状态/MC/loader过滤由真实实例派生，actualInstance 与配置不匹配标需修复。
- [x] Step 2: 注册 custom.instance-details 并传已有 profileKey 参数；缺失/删除 key 显示实例不存在与返回按钮，不渲染任何可写入旧实例的内容。详情概览显示真实目录、Java/内存/分辨率/参数继承摘要，编辑只使用原草稿弹窗。
- [x] Step 3: 本地 mods/resourcepacks/shaderpacks/saves 四页使用同一个 content owner；listRequest 的身份/loading/error驱动状态，绘制列表再核对 key/category/directory。模组开关、前三类移除确认、文件夹、刷新均调用已有动作；存档不显示移除。
- [x] Step 4: 导出保留 mrpack/zip 与 includeSaves；导入已有实例与整合包保留当前格式/扫描校验；删除残留文件重试绑定原 token。运行根目录只读，打开目录动作明确为当前内容分类子目录。
- [x] Step 5: 相关任务按 DownloadTask.profile_key 匹配；无归属的Java/pack任务不得假称属于该实例。日志入口明确为全局当前日志，不制造实例日志归属。
- [x] Step 6: 核验 A/B 同名内容、切分类、慢列表、空/错误、实例删除、需修复、import/export/includeSaves、残留token以及320×240列表操作。运行公开API及custom-source覆盖，证明 props.profileKey/Identity/Original 不串实例。

## Task 6: 独立版本库、创建实例与下载工作流

**Files:**
- Create: 两套 pages/VersionsPage.tsx、DownloadsPage.tsx；components/DownloadQueue.tsx；dialogs/ProfileDialog.tsx。
- Modify: 两套 suite.json、styles/*；locale 两文件；`ui/src/launcher/LauncherProvider.tsx`的版本加载页面耦合。
- Test: suite-builtins-fixture.tsx、launcher-view-fixture.tsx、check-loader-compatibility.mjs、check-installed-loaders.mjs、check-launcher-public-api.mjs、check-ui-suite-browser.mjs。

**Interfaces:**
- Produces: page.custom.versions，route navigation/startupSelectable=true；page.downloads；dialog.profile。
- Consumes: LauncherSnapshot['catalog']['versions'][number] 的 id/kind；catalog.refresh(force?)/setSnapshots(value)/requestLoaders(loader,game)；profileDraft.openCreate(version?)/patch/submit；downloads.install/cancel/retry。

- [x] Step 1: 两套各自实现版本搜索/类型组/缓存状态与刷新，版本库source mount调用已有catalog.refresh并依赖原owner去重；新入口可用后移除Provider的“进入downloads自动加载目录”耦合。show_snapshots=false只读正式版；true可本地按release/snapshot/其他筛选。初始显示100项后“加载更多”继续呈现其余，不伪造发布时间/最新/全库loader兼容矩阵。
- [x] Step 2: 选择版本打开现有创建草稿；loader选择只查询当前MC/loader pair，保留300ms去重和晚到隔离。提交成功沿用controller返回实例页；创建后通过该实例明确安装动作，不能用列表新增项差集猜 key 自动安装。
- [x] Step 3: DownloadsPage 删除版本目录职责，两套展示任务状态筛选和详情；kind 四类/全部六种status（queued/running/cancelling/cancelled/completed/failed）、未知总量、字节/速度/文件数量/failed_files/current_file/message都来自真实字段。
- [x] Step 4: 取消/重试传当前原task.id；原失败记录保留，重试新增后端id。不存在暂停/恢复/任务排序控件。取消中禁用重复提交，重试失败显示现有业务错误。
- [x] Step 5: 核验缓存过期与刷新失败、超过100版本、loader切换、创建失败保留草稿、已安装修复、多个队列任务、未知总量、重试新id及小窗任务详情；运行loader/API和两套来源浏览器检查。

## Task 7: 账户与独立资源发现

**Files:**
- Create: 两套 pages/AccountsPage.tsx、DiscoverPage.tsx；dialogs/AccountLoginDialog.tsx。
- Modify: 两套 suite.json、styles/*；locale 两文件。
- Test: check-account-experience.mjs、check-launcher-public-api.mjs、launcher-view-fixture.tsx、suite-builtins-fixture.tsx。

**Interfaces:**
- Produces: page.accounts / page.content / dialog.login；确认布局使用原 accounts.removingId、content.removing 等状态，不另建确认 owner。
- Consumes: accounts全部公开动作、账户ready/loadError/recovery/prompt状态；content.patchSearch/search/installProject/importPack和searchError。

- [x] Step 1: 账户页重排为沉浸式操作侧栏+账户行、Modern离线摘要+Microsoft卡片/配置。离线名保存、Microsoft select/refresh/logout、client ID配置、reload/clearRecovery全部有可达入口；不用外置认证/皮肤编辑/会员状态等缺失数据。
- [x] Step 2: 设备登录弹窗覆盖打开网页/复制代码、处理中、prompt过期、取消ACK等待、失败及重试；聚焦/恢复不得漏开登录或重放动作。
- [x] Step 3: content 路由只呈现Modrinth资源发现，类别四种，20项分页，顶部非pack安装目标明确。无实例引导创建，vanilla模组限制按原guard，搜索结果不声称已做MC/loader兼容过滤。
- [x] Step 4: 对搜索空/失败保留request与searchError，重试原query/kind/offset；结果换query和晚到回调不覆盖新搜索。安装调用原installProject，pack导入创建实例沿用原流程，不添加指定内容版本/在线图库/CurseForge能力。
- [x] Step 5: 核验切套件期间登录/搜索草稿不丢、当前账户一致、loadError/recovery、copy/open pending、无目标/无兼容资源/远程pack失败、结果20项分页；两套320×240账户与搜索可操作。

## Task 8: 设置、Java与普通编辑器外观隔离

**Files:**
- Create: 两套 pages/SettingsPage.tsx；components/JavaSettings.tsx、ArgumentTemplates.tsx、AppearanceSettings.tsx、PersonalizationSettings.tsx、AppearancePresets.tsx。
- Modify: 两套 suite.json、styles/*；必要的 common/editor/style.css 独立基线；locale 两文件。
- Test: check-personalization.mjs、check-argument-templates.mjs、check-log-preferences.mjs、check-launcher-java-current-draft-browser.mjs、check-launcher-appearance-drafts-browser.mjs、check-ui-inspector-overrides-browser.mjs。

**Interfaces:**
- Consumes: settings draft/dirty/tab/saving 与原settings/Java/presets/argumentTemplates动作；ui editor公开open/selectSuite。SettingsTab仍appearance/game/advanced，内部section只为展示 state。
- Produces: 两套完整表单排列与控件外观；普通 tool.editor/files/source/assets仍绑定原common源码。

- [x] Step 1: 按设计重排外观/游戏/高级与内部分组。默认移除图片背景设置和实际消费；主题、字体、缩放、色彩、圆角、侧栏透明度、紧凑导航、减少动效、外观预设、语言、启动页和UI编辑器保留。
- [x] Step 2: 游戏组完整保留Java发现/校验/选择/8、17、21或输入8–99下载、游戏目录、内存/最小内存、窗口分辨率；高级完整保留参数、模板/环境变量、网络下载、关闭行为、快捷键、通知与日志保留、关于。
- [x] Step 3: 字段读写既有Settings草稿；固定保存条遵从dirty/saving/选择目录/运行下载限制，显示原因；reset语义沿用原动作。Java晚到选取不能覆盖后来的手动草稿修改。
- [x] Step 4: 统一deep link明确setTab，使用实际route registry选择启动页。打开普通editor仍使用原外观且无玩家CSS；同屏控件/Portal分别走各自root。
- [x] Step 5: 运行参数/个性化/日志偏好与Java/appearance草稿回归；实际切主题、语言、规模，320×240滚动到Save；复制套件编辑玩家控件后editor自身不变，仍可单独自我定制。

## Task 9: 剩余业务弹窗与确认状态

**Files:**
- Create: 两套 dialogs/LauncherDialog.tsx、InstanceSettingsDialog.tsx、ImportInstancesDialog.tsx、RemoveProfileDialog.tsx、CloseRequestDialog.tsx、LaunchAccountDialog.tsx、AppearancePresetDialog.tsx、ArgumentTemplateDialog.tsx。
- Modify: Task 6/7 已建 ProfileDialog/AccountLoginDialog 的统一外壳接线；两套 Shell/suite.json/styles/*。
- Test: check-ui-foundation-browser.mjs、check-ui-foundation-review-browser.mjs、check-ui-customization-browser.mjs、suite-final-fixture.tsx。

**Interfaces:**
- Consumes: 已有九类draft/selection/request状态和对应actions，Dialog/Menu/Select compound API；不新增page-local业务草稿。
- Produces: 所有九类dialog.*在两套各自来源绑定，错误/确认也可选取替换；原 pending/关闭/验证规则保留。

- [x] Step 1: 沉浸式宽而紧凑分组与Modern居中常规标签分别实现所有剩余弹窗。实例设置支持目录chooseDirectory/Java chooseJava而非普通文本绕过校验，继承/覆盖和环境变量模板完整可编辑。
- [x] Step 2: 导入、删除及残留token、外观预设save/import/rename/remove/export、参数模板new/edit/remove、启动账户选择与运行关闭stop/background/stay全部使用原controller动作。inline账户/content确认同样纳入视觉验收。
- [x] Step 3: 所有弹窗保留可访问标题/说明、初始焦点、关闭后返回焦点、提交中保护；多个Dialog/Select/Menu的Escape只关闭顶层。长字段错误文本换行，不挤出操作区。
- [x] Step 4: 实际开启每类弹窗并测试pending/验证失败/取消/成功，在两套主题与320×240确认保存和关闭可达；自定义CSS/HTML/TSX覆盖dialog/control时ref/event/Original/Portal根保持有效。

## Task 10: 日志、跨页面键盘与响应式收口

**Files:**
- Create: 两套 pages/LogsPage.tsx。
- Modify: 两套suite.json/styles/*及必要的已建页面/组件；locale两文件；删除或解除已经迁移的common玩家页面/CSS绑定和未使用图片层。
- Test: check-log-preferences.mjs、suite-builtins-fixture.tsx、check-ui-foundation-review-browser.mjs。

**Interfaces:**
- Consumes: snapshot.logs.lines 的time/level/message、原logs.clear与现有纯exportLogs helper；日志搜索/级别/跟随都是来源展示 state。
- Produces: page.logs；1240×780、960×640、800×600、640×480、320×240布局。Modern <960px取消侧Inspector；两套 <720px折叠导航与一栏；基于有效宽度，缩放不重复叠乘。

- [x] Step 1: 日志工具栏、等宽内容、级别与文本过滤、跟随末尾、导出/清除完整实现；不称日志属于某个实例/历史会话。选择日志文字不拖动窗口。
- [x] Step 2: 为所有已建页面补窄窗行为：表格转标签行、设置label→value→control、首页启动流式、内部滚动弹窗与可达操作区；长中文/英文路径和实例名不遮挡。
- [x] Step 3: 检查每个可见控件键盘路径、可见focus、Tooltip标签、原快捷键守卫与Dialog返回焦点。缩放/主题/减少动效各用现有公开解析，不创建第二主题owner；prefers-reduced-motion也禁用非必要动效。
- [x] Step 4: 逐页检查深浅对比度（正文>=4.5:1，边界/焦点>=3:1），所有正常状态来源可在目录定位覆盖。确认所有默认manifest已指向本套件玩家来源；common仅余需要的纯helper/editor，不保留重复玩家CSS。
- [x] Step 5: 运行log/foundation/locale回归，实际键盘巡航两套全部页与320×240主动作，记录视觉差异与修复结果。

## Task 11: 完整回归、视觉与原生验收、dev交付

**Files:**
- Create: `ui/scripts/check-ui-redesign-browser.mjs`、`docs/TESTING-UI-REDESIGN.md`。
- Modify: `ui/src/ui-tests/suite-builtins-fixture.tsx`、`ui/src/ui-tests/suite-final-fixture.tsx`、旧浏览器脚本的当前来源路径/选择器；`ui/package.json`加入test:redesign-browser；README、docs/UI-CUSTOMIZATION.md、docs/TESTING-UI-CUSTOMIZATION.md。
- Evidence: `.test-data/ui-redesign/` 分开保存dev/compiled/production/native报告与截图；不得用历史v0.1.0或定制fixture截图代替默认结果。

**Interfaces:**
- 新redesign浏览器脚本复用 createBrowserFixture 与实际suite-builtins-fixture的同一个root/controller，命名场景装入代表性业务边界数据；不向普通production发布测试globals。旧customization测试按manifest.views查当前源路径，不再写死common/Notifications.tsx等已移走路径。
- 场景名：home-empty、home-idle、home-other-running、instances-installed-repair、detail-settings、detail-local-loading-empty-error、versions-cache-error、downloads-all-states、accounts-login-expired-error、discover-empty-error、settings-dirty-saving、logs、style-choice-success-failure。九类dialog另逐一打开。

- [x] Step 1: 增加上述实际浏览器场景，两套×dark/light覆盖全页面，关键空/加载/失败/运行状态都留截图；主屏1240×780、窄窗640×480/320×240做真实按钮/键盘操作。另验长英文和现有合法ui_scale=85/100/120下可滚动到操作；200%属于原生DPI验收，不写入非法ui_scale；截图无默认图片、pageerror或CSP violation。
- [x] Step 2: 根目录运行 `npm run check:ui`、`npm run lint:ui`、`npm run check:i18n`、`npm run test:ui`、`npm --prefix ui run test:suite`、`npm run build:ui`，全部退出0。检查新public白名单与单owner，已保存图片/套件/游戏数据不被重置。
- [x] Step 3: ui目录启动独立foundation-test服务：`npm exec vite -- --host 127.0.0.1 --port 1433 --strictPort --mode foundation-test`。根目录设置PARADOX_UI_URL后运行launcher public API/routes/Java-current-draft/appearance-drafts浏览器脚本，以及test:foundation-browser、test:final-browser、test:suite-storage-browser、test:inspector-browser、test:customization-browser。使用工具定位已有Playwright/Chromium；必要时设置PARADOX_PLAYWRIGHT_MODULE和PARADOX_BROWSER_EXECUTABLE，不增加生产依赖。
- [x] Step 4: ui目录另启suite-builtins-test服务（1434），设置PARADOX_UI_URL与PARADOX_SUITE_BUILTINS=1，运行`node scripts/check-ui-suite-browser.mjs`和`npm run test:redesign-browser`。首次冷启动断言按新显式选择行为更新；不能仍要求自动revision1。
- [x] Step 5: ui目录执行`npm exec vite -- build --mode foundation-test --outDir ../.test-data/ui-redesign/compiled-foundation`，用preview在1435服务该outDir；设置PARADOX_TEST_NATIVE_CSP=1重跑对应foundation回归。suite-builtins-test另建compiled-builtins目录并在1436服务，重跑suite/redesign组。要求实际tauri.conf CSP、生效入口无/src/或/node_modules/请求。普通build:ui产物另外启动检查，无测试globals。
- [x] Step 6: 因Task 1修改Rust默认，运行`cargo fmt -p paradox-core -p paradox-launcher -- --check`、`cargo test --workspace --all-targets --locked`、`cargo clippy --workspace --all-targets --locked -- -D warnings`；只检查本次涉及workspace包，不改vendor。
- [x] Step 7: 构建对应当前源码的原生debug应用，记录构建来源/hash，已完成构建退出0与389输入无漂移核验。按既有本人原生验收约定，将当前exe及Windows WebView2标题栏/焦点、100/125/150/200%DPI、中文/英文、小窗、Microsoft授权及游戏安装/启动/停止/关闭步骤交给用户记录。真人项目在验收表继续标为待验，不把浏览器mock宣称为原生通过。
- [x] Step 8: 完整套件旅程：复制两套、CSS-only保留输入、HTML/TSX与Original、修改新页/导航/控件/弹窗/onboarding/普通editor、预览/保存/重启/导出重导入、切套件保留业务草稿、隐藏CSS/抛错→F12→可信editor修复、--ui-safe。记录所有检查的真实结果与尚待真人项目。
- [x] Step 9: 文档更新当前入口/页面数、首次选择、默认无背景、自定义边界与验收命令；执行最终需求覆盖和差异检查。自动验收已完整通过，真人原生项目按已接受移交边界继续在验收表单独保留。
- [ ] Step 10: 所有任务与验收完成后，确认仍在dev、git diff无 unrelated修改、检查remote目标；只暂存本次源码/资产/测试/文档（docs默认ignore需对审核通过的两份设计/计划等明确路径使用git add -f），形成可审查提交，再`git push <已配置dev上游>`。如果dev没有上游，检查现有remote/分支后用对应remote设置上游，不猜仓库。记录实际commit和推送结果。

## Plan Review and Execution Handoff

2026-11-08 自动验收完成记录：最终空白清理后两套仍各85 files/43 views/9 routes/0 assets，170描述符和9个普通editor来源一致；UI六命令、新compiled两构建、新native构建全部0。Foundation每lane三脚本7/4/15重新运行0，其余九份按源码输出等价性和精确执行依赖复用；新compiled套件8上下文0，普通production3上下文0；最终DEV `dev/browser-batch/redesign-2026-11-08T04-51-28-954Z/batch.json` 与COMPILED `compiled/browser-batch/redesign-2026-11-08T04-56-42-584Z/batch.json` 各7focused/128groups/36matrix/872checks/1636PNG/2016可达性全通过，425运行输入无漂移且全部contexts关闭。三个自动位置每lane共8次真实拾取、DOM/CSS和真实TSX Original保存重载/取消/重试两lane均通过。原生debug43,617,280 bytes/SHA 46ECC856E8696C1A63626DF20A12D33EC8A70342E12E30E0E5EF1EE2A79CCBD3，389产品输入无漂移；Rust复用253pass/2既有ignored及Clippy/fmt0，已核对46Rust+6输入。旧完整通过、失败、停止与通知补充3PASS/1late-ID FAILED保留；补充probe原单来源、临时挂载编号、详情展开态及V4 JSON属性插入顺序假设失败全部保留；V5使用生产canonical selector比较，保留全部值和数组顺序；DEV首次PID复用关闭审计失败与身份修正也保留，不降低业务断言。本人原生表仍待验；Step10等待实际dev提交和推送后填写。

设计各节的覆盖：默认无图/显示修复→Task1/4；公开协议/身份→Task2；首次选择/恢复时序→Task3；两套首页/导航→Task4；实例/详情/本地内容→Task5；版本与任务→Task6；账户/发现→Task7；设置/Java/editor→Task8；九类弹窗→Task9；日志/主题/键盘/小窗→Task10；全部定制旅程/生产CSP/原生/提交→Task11。

本计划按子代理任务实施并独立复核：Task2/3的状态和保存边界先串行确认，随后两套视觉文件并行；共享manifest/public接口由单一所有者整合。用户已授权实施、自动验收后提交并推送dev；本轮子代理均使用Sol xhigh，已接受任务不因最终回归而重复开启。
