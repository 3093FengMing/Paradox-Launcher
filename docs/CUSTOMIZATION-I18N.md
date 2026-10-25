# 界面预设与多语言

更新日期：2026-10-26。自定义界面预设与 i18n 已提前纳入 v0.2。

## 玩家使用

打开「设置与个性化 → 外观与体验」。顶部可以选择简体中文、English 或跟随系统，页面和弹窗即时切换。点击「保存设置」后，下次启动继续使用该语言；「还原修改」恢复已经保存的语言与外观。

先调整界面风格、主题、强调色等参数，再点击「保存当前外观」命名预设。预设最多保存 32 个，名称允许 1–48 个 Unicode 字符，可使用中文和 emoji。每个预设可以应用、重命名、导出和移除。

预设保存完整外观参数：沉浸主页 / 现代工作台、深色 / 浅色 / 系统主题、强调色、界面缩放、圆角、紧凑侧栏、减少动效、占位背景开关、背景模糊与遮罩、侧栏不透明度。两种现有界面样式继续保留。

「保存当前外观」、重命名、移除和导入会立即保存预设库；「应用」先更新外观预览，再点击「保存设置」保存当前外观。预设库操作不会顺带提交尚未保存的游戏设置或语言选择。移除预设不改变当前外观。

导出弹窗显示可移植的 JSON，点击「复制 JSON」，或选中并手动复制，保存为 `.json` 文件后即可分享。导入时将导出的 JSON 粘贴到「导入预设」弹窗。每次导入创建新的本地 ID，不会覆盖已有同名预设。当前导入导出使用文本弹窗。

预设只包含外观，不包含账户、实例、游戏目录、Java 路径或网络设置。导入限制为 32 KiB UTF-8 文本，拒绝未知格式版本、缺失 / 未知外观字段、不合法颜色、数值越界与控制字符，失败时保留已有配置。

桌面预设和语言保存于 `%LOCALAPPDATA%/ParadoxLauncher/config.json`；网页预览独立保存在浏览器本地存储。旧配置缺少语言或预设字段时，默认使用简体中文和空预设库；损坏配置保留原数据并显示错误。

## 预设格式

导出的 JSON 格式为：

```json
{
  "kind": "paradox-appearance-preset",
  "schema_version": 1,
  "name": "夜色工作台",
  "appearance": {
    "interface_style": "modern",
    "theme": "dark",
    "accent_color": "#a78bfa",
    "ui_scale": 100,
    "border_radius": 14,
    "compact_sidebar": false,
    "reduce_motion": false,
    "background_art": true,
    "background_blur": 0,
    "background_dim": 8,
    "sidebar_opacity": 62
  }
}
```

整体配置中的 `appearance_presets` 另外保存本地 UUID。预设导出省略该 ID，导入会生成新 ID。全局配置仍使用 schema version 1，因为新字段对旧文件保持兼容；预设文件单独版本化。

## 翻译实现与扩展

使用 `i18next` 和 `react-i18next`，资源位于 `ui/src/locales/zh-CN.json` 与 `en-US.json`。资源随 exe 打包，切换语言不需要联网。React 页面与复用弹窗使用 `useTranslation()`，表单校验、API 和状态 Hook 使用共享 i18n 实例。

语言偏好独立于外观预设。跟随系统按 `navigator.languages` 的顺序匹配支持的中文或英文语言；未匹配时回退到简体中文。系统语言变化时只更新跟随系统模式，显式语言选择不受影响。`document.documentElement.lang` 随界面语言同步，日期和新增日志时间使用当前 locale。

常用启动器任务状态在展示时本地化；游戏 stdout / stderr、路径、Minecraft 版本、玩家命名与无法识别的 SDK 诊断保留原始值，便于排查问题。未来后端可提供消息代码与参数，以逐步替换兼容现有状态文本的映射。

添加翻译时两份资源需要保持键和 `{{variable}}` 参数一致，英文按 i18next 规则使用 `_one` / `_other` 复数键。新增支持语言还需更新 `ui/src/i18n.ts`、`LanguagePreference` 前后端类型、设置选项与语言校验，再更新检查脚本中的语言列表。

```powershell
npm run check:i18n
npm run check:ui
npm run lint:ui
```

`check:i18n` 只读检查资源键集合、非空值、插值参数，以及静态 `t(...)` 调用中的键，已加入 CI。动态消息键与交互仍需要运行时和界面验收。
