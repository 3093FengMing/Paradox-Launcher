# UI 来源套件

开发版本：`0.4.0-dev`。默认应用由完整的 modern 或 immersive 来源套件渲染。账户、实例、下载、内容、Java、设置和窗口动作来自同一个永久业务 Provider；切换套件保留这些动作与未完成的业务草稿。

两套默认来源分别拥有全部玩家页面、导航、控件、业务弹窗、首次样式选择、加载/错误和通知。沉浸式参考 HMCL 的分组导航与紧凑列表，Modern 使用实例工作台；两套均采用纯色底面，不消费已保存的图片背景。第一次普通启动需明确确认套件选择。版本库为 `custom.versions`，实例详情为带 `profileKey` 的 `custom.instance-details`；详情缺失身份时不会回退到当前实例。

每套内置清单包含 85 个文件描述、43 个视图和 9 个路由，内置素材列表为空。玩家来源分别位于 `modern/` 与 `immersive/`；两套都可完整复制后修改，包含首次选择、通知和普通编辑器的来源绑定。

`common` 保留纯展示 helpers、来源解析辅助和普通编辑器及其独立 CSS。默认玩家 JSX/CSS 分别归属于 `modern/` 与 `immersive/`。要定位当前页面或弹窗源码，应读取草稿清单的 `manifest.views`；不要依赖旧的 `common/pages`、`common/dialogs` 路径。图片字段与素材导入/导出协议仍可供用户套件使用，用户已有数据和固定父快照不被重写。本轮验收范围见 [默认 UI 重设计验收](TESTING-UI-REDESIGN.md)。

## 打开、编辑与保存

在设置中选择「编辑 UI 套件」，或按 `Ctrl+Shift+F11`。先复制 modern/immersive，再编辑文件、素材和清单。内置来源只读；复制产生具有固定父快照的用户套件。导入使用 `.paradox-ui` ZIP，导出草稿也使用该格式。源编辑区可以单独导入或导出 TS/TSX/CSS/HTML 文件，保留实际 UTF-8 文本。

「预览套件」只激活当前草稿；「保存套件」通过 revision CAS 持久化并激活。关闭、重新打开编辑器保留草稿、文件和目标选择。恢复已保存内容撤销草稿；重置库需要确认并保留原始库备份。保存、导入和预览的短暂通知与持续诊断分别显示；通知过期后，诊断历史仍可展开查看或明确清除。

普通编辑器自身是 `tool.editor` 来源。文件树、源编辑和素材管理分别是 `tool.editor.files`、`tool.editor.source`、`tool.editor.assets`，也走同一个视图解析器。其源码只能调用公开编辑器 hooks，与当前控制器共用同一草稿、CAS、选择和生命周期。保留 Dialog、DragRegion 和可达的底部按钮，可使替换后的编辑器继续支持焦点、窗口拖动与小窗编辑。

## 选择目标与文件覆盖

目录合并套件定义、显式覆盖和当前实际所有者。鼠标拾取默认选择精确位置；父组件也是精确位置。同一业务项与所有同类是明确扩大的范围，切回位置恢复选中的临时锚点。位置保存完整 renderRoot、callsite/key 链和业务身份，不保存临时 ownerId；重复键或不安全来源会显示歧义或不支持，不任取第一个目标。未挂载目标仍可编辑；前往页面是单独动作，检查器不自动打开业务弹窗。

目标详情中的 CSS / HTML / TSX 只打开该选择器已有的绑定。点击“创建或打开覆盖文件”才创建 `overrides/<完整选择器 SHA-256>/style.css`、`View.html` 或 `View.tsx`，同一次草稿操作更新文件和 `manifest.overrides`。CSS 独立于 HTML / TSX 共用的 entry。切换 HTML 与 TSX 保留原普通文件；重置只移除当前完整选择器的绑定，共享与孤立文件保留在文件树中，由用户管理。创建完成不会改选后来选择的目标，也不会覆盖等待期间修改的其它来源。

预览镜像是当前生效界面的只读 DOM，不再挂载业务组件，不运行原按钮回调或另订阅业务。编辑草稿和失败编译不会改变镜像；成功预览后镜像与范围读取新实际根。仅 CSS 修改保留原业务 DOM 和组件状态。多位置定位需要明确选择，隐藏、离屏、未挂载、歧义与不支持分别显示状态。镜像、范围绘制和取消由固定宿主保障；目录、详情、预览外框与工具栏来自可修改的正常编辑器源码。

普通编辑器源码通过同一公开 hooks 完成选择、编辑、预览、保存、导出和导入，例如：

```tsx
import { useUiEditorActions, useUiEditorSnapshot } from '@paradox/launcher';
import { Button } from '@paradox/ui';
export default function OverrideButton() {
  const actions = useUiEditorActions(), snapshot = useUiEditorSnapshot();
  return <Button disabled={!snapshot.selection || !!snapshot.pending}
    onClick={() => void actions.createSelectionOverride('css')}>CSS</Button>;
}
```

## 文件和清单

清单的 `kind` 为 `paradox-ui-suite`，`schema_version=1`，`api_version=1`。JSON 库的 `kind` 为 `paradox-ui-suite-library`，`schema_version=1`。UUID、版本、名称、完整 views/routes/styles/files/overrides 都属于当前清单；继承合并文件覆盖与删除记录，保留父快照字节，父层回退使用自己的模块、样式与素材。修改 routes 不会隐式合并父 routes。

每个 `route.entry` 对应 `views['page.' + route.id]`；显式同名 view 必须指向相同规范路径。路由描述只含数据。通过公开 `UiRouteViewport` 进入同一回退链。

| 限制 | 字节或数量 |
| --- | ---: |
| 单个源码 | 1,048,576 B |
| 单个素材 | 8,388,608 B |
| 物化文件 | 512 |
| manifest | 65,536 B |
| 物化套件和 ZIP 输入 | 各 33,554,432 B |
| 用户套件 | 16 |
| 规范库 JSON | 134,217,728 B |

路径采用规范大小写、NFC 与静态相对解析；不接受逃逸路径、重复规范路径或查询字符串模块。素材可以在套件内静态导入；编译器按实际来源租借 Blob URL，并在引用释放后回收。

桌面库使用独立 UI 文件与原子 CAS；网页库使用独立 IndexedDB 事务。旧 `paradox-ui-customization` 格式及其磁盘、localStorage、sessionStorage 命名空间不读取、不写入、不迁移、不删除。旧文件不是新格式的导入来源。

## 公开源码与 Original

可导入的模块只有 `react`、`react/jsx-runtime`、`lucide-react`、`@paradox/ui`、`@paradox/launcher`、`react-i18next` 的 `useTranslation`，以及套件内静态相对模块。动态 import、任意 require、远程模块、私有 Provider/controller 不可导入。编译不使用 eval、Function 或 unsafe-eval。

组件收到 `{ snapshot, actions, props, children, Original }`。业务数据从公开 hooks 或 snapshot 取得；原属性在 `props` 内。实例卡片的规范属性是 `props.profileKey`：

```tsx
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';

export default function Card({ Original, props }) {
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions();
  const profile = snapshot.profiles.items.find(
    (item) => item.profile.instance_key === props.profileKey,
  )?.profile;
  return (
    <section>
      <Original {...props} />
      <button onClick={() => actions.profileDraft.openRename(props.profileKey)}>
        Rename {profile?.name}
      </button>
    </section>
  );
}
```

原生控件替换应转发 `props`、children、ref、禁用状态与事件。Original 沿当前位置进入下一候选来源，保留原调用祖先、业务身份和样式归属；不能从另一实例借用执行导出。

类型目标如 `component.profile-card`、`element.button`；精确目标使用 `UiSelector` 的 position/business/type 结构。position 包含 renderRoot、调用 site/key 链和业务祖先；重复实例应提供稳定 key。选择器的完整 SHA 索引用于查找，并再次核对原结构。旧 `node.*` 字符串不能替代新的持久定位结构。选取点击由永久交互发布者消费，避免执行原按钮动作。Inspector 提供目标名称、来源目录、当前只读预览及 hover 范围；完整 Fragment 或 Portal 的多个真实根共享同一逻辑目标。

## CSS 与 HTML

全局样式只安装在当前可见来源使用的主界面或编辑器根；目标样式按其入口与 selector 限定范围。`:scope` 和顶层 `&` 指向实际目标根。嵌套规则、媒体条件、keyframes、font-face、注册变量和命名 layer 经静态 AST 编译获得隔离名称。纯 CSS 更新复用同一作用域中未改变的代码图和组件，保留本地 React 输入；改变可执行源码或被导入素材字节会更新代码图。

普通自定义属性的文本保持原值；animation/font 等 descriptor 使用点消费隔离引用。静态无法判定跨字段 shorthand 的 var 模板在来源、行、列给出诊断，例如同一变量可能同时改变 animation 名字和 timing 时。改用独立变量与 longhand：

```css
@keyframes pulse { to { opacity: .6; } }
.card {
  --motion-name: pulse;
  --motion-duration: 1s;
  animation-name: var(--motion-name);
  animation-duration: var(--motion-duration);
}
```

确定的模板、带显式 fallback 的单 var 完整 shorthand、longhand，以及没有相关 descriptor 的普通变量保留支持。注册变量的 validation、initial-value、inheritance、computed 语义必须能静态保持；实际 descriptor 消费不满足时会诊断。复杂语法或 `+`/`#` 本身不构成拒绝理由。可使用未注册变量、分离 descriptor 与其他字段变量，或直接 `animation-name`/`font-family`。这是已接受的 R4f/R4g 静态边界，不提供任意 computed-value 运行时重写，也不减少上述源码容量。

HTML 的 `<ui-slot>` 保留 Original；具名 slot 读取已有 React 内容。属性插值按文本处理。公开动作可以这样绑定：

```html
<section>
  <button data-ui-action="actions.profileDraft.openCreate">Create instance</button>
  <ui-slot></ui-slot>
</section>
```

`data-ui-props` 转发原生属性。`data-ui-args` 只支持字面量、`$prop` 与事件时刻从 currentTarget 投影的 `event.value`、`event.checked`、有限 `event.valueAsNumber`；不允许 Event/DOM 遍历或表达式。缺失值和非有限数字诊断，不传 undefined/NaN。无 args 的 props 回调接收原事件，公开 actions 接收零参数；显式 [] 两者都接收零参数。

HTML 拒绝 script、字符串事件、危险 URL 与文档注入元素。栅格图片通过素材管理器加入套件，再用相对套件路径引用，仍受实际桌面 CSP 限制。用户 TSX 在应用线程执行；错误边界能局部回退渲染，不能回滚任意副作用或中断无限循环。

## 固定恢复与窗口验收

按 `Ctrl+Shift+F12` 紧急停用用户 UI。唯一固定不可替换界面是 SuiteProvider 同级、同一 UiEditorProvider 内的独立 ShadowRoot Recovery。它可以导出持久化库的原始字节、打开可信默认编辑器继续修复同一草稿，或确认重置并备份原库。损坏库使用原字节 SHA token/missing token，在同一锁或 IDB 事务中比较、备份和替换；冲突拒绝覆盖。

关闭进程后以 `--ui-safe` 启动，首个窗口 URL 加入 `ui-safe=1`，在用户工厂执行前进入可信来源。网页可用 `?ui-safe=1`。紧急停用会阻止晚到编译或保存重新激活用户界面。

自动化浏览器验证与真人原生验收分别记录。真实窗口位移、双击最大化、Close/Select/输入/源文本选择、隐藏界面恢复、DPI 与 WebView2 平台行为由用户本人验收。当前检查命令、构建来源和手动步骤见 [验证说明](TESTING-UI-CUSTOMIZATION.md)。
