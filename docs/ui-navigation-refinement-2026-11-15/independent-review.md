# 独立 UI 审查：导航与密度收尾

Method: independent design review agent `/root/independent_ui_review`; implementation and automated regression are owned by separate agents.

审查时间：2026-11-15 09:29 UTC。审查者未承担本轮应用实施，未修改应用源码。本报告使用现有真实截图、当前源码和两个小型实时浏览器探针；未运行大矩阵、Impeccable context 或 detector。完整自动回归结果由主代理另行合并。

## 结论

本轮独立审查找到 2 项 P2 布局问题、2 项 P3 工艺问题，并已交给实施代理。实施代理随后完成修复；重新创建的浏览器 fixture 读取当前源后，四项都通过复验。受检场景没有剩余可复现的 P0、P1 或 P2 问题。这个结论只覆盖下面注明的范围，不能替代中英文、深浅主题、85–120% 和全部业务状态的最终回归。

两套界面保留了可识别的不同操作结构：沉浸式首页在左侧组织账户、实例与启动，Modern 使用独立顶栏与窄侧栏。统一下载页面的两个内容标签加任务记录入口可以清楚表达三个已有业务路由。实例连续行、单一版本搜索及紧凑的日志行，使日常操作容易扫描。

## 具体发现与修复复验

| 优先级 | 发现 | 用户影响 | 定位与建议 | 当前复验 |
| --- | --- | --- | --- | --- |
| P2 | Modern 首页满宽主卡片内，名称、版本、账户与启动动作全部垂直堆在左侧，右侧大面积空白。 | 两个实例时，上方卡片占据约 288px 高度却只使用左侧信息区；降低空间利用率，并把后续实例列表推低。 | `modern/styles/home.css:58`，`modern/Home.tsx:57`。宽容器内把实例概要与账户/CTA 分成左右两组，小容器改回单列。 | 当前工作面宽 1085.0px，内部两列为 753.8px / 266px，卡片高 141.5px；640px 窗口下回到单列。 |
| P2 | Modern“我的实例”默认打开的查看栏仍直接展示游戏基础目录与完整运行目录。 | 主工作面被长路径占据，违背本轮“主界面不直接目录”的明确要求；设置概要也被推到下方。 | `modern/components/InstanceDetail.tsx:46`。仅在完整详情渲染目录，compact 查看栏保留概要与“打开完整详情”。 | compact Inspector 的 `InstanceDetail-directories` 节点数为 0；完整实例详情中为 1。 |
| P3 | 已启用 squircle 渐进增强，但首页工作面、实例概览和账户入口不在规则范围内。 | 支持连续曲率的浏览器中，核心首页表面仍为普通 round，和已增强控件的曲率语言不一致。 | `common/player-interaction.css:34`。把首页实际使用的表面与账户选择器加入限定在两套玩家界面的增强规则。 | `home-workspace-grid`、`home-overview`、`home-account` 的 computed `cornerShape` 均为 `squircle`。 |
| P3 | Modern 版本类型 Select 的内容继承按钮居中布局，值与箭头集中在控件中部。 | 与相邻表单选择器以及沉浸式同类控件的左值右箭头布局不一致；宽输入的可扫描性较差。 | `modern/styles/versions.css:13`。设置 `justify-content: space-between`，保留公开 Select 和原有键盘协议。 | computed `justifyContent` 为 `space-between`，`cornerShape` 为 `squircle`；Enter 打开、Escape 关闭后真实焦点回到 trigger。 |

归因说明：首页工作面在审查开始时已由 responsive.css 覆盖为单列。旧 home.css 中的双列声明不是此次空白的实际 computed 布局，实际问题在卡片内部信息与动作的分布。本报告已按实时 computed 结果纠正归因。

## 额外确认

- Modern 设置弹窗的名称、完整目录、已启用最大内存输入与模板 Select，在 1240×780 场景中均完整且中心可命中；在 320×240 场景中，内部滚动后可见输入也都完整且可命中。公开 Select 产生的 1px 隐藏表单输入未作为可见控件缺陷。
- Modern 1240×360 低高度窗口中，侧栏 `scrollHeight == clientHeight == 312`，overflow 为 hidden，五个导航按钮完整处于窗口内；完整导航菜单触发器可见。没有发现被 overflow:hidden 掩盖的导航裁切。
- 日志实际为 12px、16.8px 行高，即 1.4，垂直 padding 为 2px。INFO 实际颜色为 `rgb(176,188,255)`，WARN 为 `rgb(240,206,134)`，并保留书面级别标签。受检深色场景下两者明确可区分。
- 系统 `prefers-reduced-motion: reduce` 后切回首页，route-stage 的运行动画数为 0，启动按钮 transitionDuration 为 0s。当前路由动画只改变 opacity，不改变固定启动控件的包含块；源码没有过渡期间输入锁定。
- 最终小探针记录 pageerrors 为 `[]`，CSP violations 为 `[]`。

## 证据与范围

最终视觉证据保存在 `docs/ui-navigation-refinement-2026-11-15/evidence/`：两套深浅色 home、instances、versions、logs、instance-settings，以及 640px / 320px 首页，共22张。`report.json` 记录最终采集于 2026-11-15 09:30:17.655–09:30:31.756 UTC，两套均无 pageerror / CSP 且支持 squircle；`provenance.json` 记录156个 common / modern / immersive TS/TSX/CSS 来源，聚合 SHA-256 为 `b9c0dd1c29c61bd6231369c579bbd37af4723bc86ccff61e0a7cc6999edc99e4`。

初审曾参考 `.test-data/ui-navigation-refinement/2026-11-15/20261115T091244Z/render/` 的中途截图；该临时目录后来由主代理重新采集。报告中的四项“已修复”结论以独立审查者于09:28–09:29 UTC新建 fixture 加载当前源的 DOM 数量、computed 样式及命中/焦点检查为准，最终统一截图由主代理另行保存。

实时探针使用 `http://127.0.0.1:1434/?shellHome=modern` 和独立桌面边界 fixture，不改变用户业务资料。审查没有建立持久浏览器配置，没有保存测试脚本或临时截图。一次探索完整详情侧栏的探针假设存在 `.detail-sections`，该节点实际不存在而使测量脚本报错；这不是应用 pageerror，也未列为 UI 缺陷。后续有效探针独立复验了完整详情入口和目录保留。

主代理已另行合并最终统一截图及DEV／编译＋CSP回归，覆盖英文、浅色、85–120%缩放、下载进行中／失败／完成的焦点生命周期等，记录见[evidence/verification-summary.json](evidence/verification-summary.json)。本独立报告的结论仍限于审查者亲自执行的截图与小型探针范围，不将主代理的完整回归算作本审查者执行。

Questions skipped: 本审查是已授权实施流程中的独立检查；具体缺陷已交给实施代理修正，没有需要用户新增决策的阻塞项。
