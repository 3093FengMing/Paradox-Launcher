# 2026-11-15 默认 UI 实现验收计划

本文件记录“折页结构 + 石墨配色”实现后的执行方法与证据要求，具体本轮结果以 [implementation-review.md](implementation-review.md) 和所引原始记录为准。`docs/TESTING-UI-REDESIGN.md` 中 2026-11-08 的结果、截图、文件数量和 exe SHA 继续属于历史源码。

## 执行前提

- 构建由一个执行者顺序运行，避免普通 `ui/dist`、编译清单和原生内嵌前端互相覆盖。不要在其他代理正在改源码时宣称输入已冻结。
- 浏览器仍使用实际应用 root、既有永久业务 owner、公开 actions 和原生 invoke/event 边界夹具。两套来源均不增加 Provider、订阅、业务队列或第二份 snapshot。
- 保存各项完整 stdout/stderr、命令、cwd、相关环境变量、开始/结束时间、自然退出码及失败结果。中止、筛选运行和旧证据不能标为完整通过。
- 每次尝试使用新的目录，例如 `.test-data/ui-redesign/2026-11-15/<UTC-run-id>/dev`、`compiled`、`production`、`native`。失败后重跑也另建目录。

下面 PowerShell 的浏览器命令统一在 `ui/` 执行；静态检查与原生构建明确在仓库根目录执行。服务放在独立终端，检查命令放在另一个终端。

下面保留本轮已定位并用于实际运行的 Playwright 路径：

```powershell
$taskRoot = 'F:\rust-code\Paradox Launcher'
$taskRunId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$taskEvidence = Join-Path $taskRoot ('.test-data/ui-redesign/2026-11-15/' + $taskRunId)
$env:PARADOX_PLAYWRIGHT_MODULE = 'C:\Users\FengMing\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
# 该模块当前为 1.62.1；它报告的 Chromium 路径如下。通常让 Playwright 自行选择即可。
# $env:PARADOX_BROWSER_EXECUTABLE = 'C:\Users\FengMing\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe'
```

这些是此机器当前路径；环境变化后通过 `mcp__codex_app__load_workspace_dependencies` 重新定位。无需安装生产依赖。`PARADOX_BROWSER_HEADFUL=1` 可用于调试，最终报告应记录实际浏览器及 headless/headful 状态。

最终完整运行前清除子集与故障探针：

```powershell
$taskFilters = @(
  'PARADOX_REDESIGN_MATRIX_ONLY', 'PARADOX_FINAL_CASE', 'PARADOX_REVIEW_CASE',
  'PARADOX_FOUNDATION_DRAG_ONLY', 'PARADOX_FOUNDATION_LAYOUT_ONLY',
  'PARADOX_NOTICE_FIX_ONLY', 'PARADOX_INSPECTOR_CASES', 'PARADOX_OVERRIDE_CASES',
  'PARADOX_ACTIVATION_CASES', 'PARADOX_SUITE_COLD_RED', 'PARADOX_SUITE_LIGHT_ONLY',
  'PARADOX_SUITE_VIEWS', 'PARADOX_SUITE_VIEWS_FOCUS', 'PARADOX_SUITE_SUBJECT_RED',
  'PARADOX_SUITE_LAYER_RED', 'PARADOX_SUITE_CSS_FIX1', 'PARADOX_SUITE_CSS_FIX2',
  'PARADOX_SUITE_CSS_FIX3', 'PARADOX_CAPTURE_TASK4'
)
foreach ($taskFilter in $taskFilters) {
  [Environment]::SetEnvironmentVariable($taskFilter, $null, 'Process')
}
```

Foundation 主组的 Inspector 默认运行不带 `--preview-only`、`--picker-only`、`--source-only`、`--source-reorder-probe`；overrides 不带 `--page-error-probe`。`--preview-only` 和 `--picker-only` 实际进入两个独立功能分支，不被默认分支自动执行，须另建目录补充运行，不能代替默认组。`PARADOX_NOTICE_REPORT`、`PARADOX_REVIEW_REPORT` 等只改变输出名的变量仍须记录，避免误找报告。

## 静态、Node 与普通前端构建

仓库根目录顺序执行并分别保存结果：

```powershell
Set-Location -LiteralPath $taskRoot
npm run check:ui
npm run lint:ui
npm run check:i18n
npm run test:ui
npm --prefix ui run test:suite
npm run build:ui
```

核对两份当前 `suite.json` 中每个来源的实际 bytes/SHA、完整 views/routes 和依赖白名单，不沿用旧的“85 files /43 views”作为本轮固定数量。普通 editor 来源、Recovery 和公共业务层应保持既有合同。

## 开发浏览器服务

两个服务终端都先进入 `ui/`：

```powershell
Set-Location -LiteralPath (Join-Path $taskRoot 'ui')
npm exec vite -- --host 127.0.0.1 --port 1433 --strictPort --mode foundation-test
```

```powershell
Set-Location -LiteralPath (Join-Path $taskRoot 'ui')
npm exec vite -- --host 127.0.0.1 --port 1434 --strictPort --mode suite-builtins-test
```

Foundation 完整组是下表 12 个脚本。选择 `http://127.0.0.1:1433`，移除 `PARADOX_TEST_NATIVE_CSP`、`PARADOX_SUITE_BUILTINS`，逐脚本运行 `node scripts/<文件名>`。不要只跑以前重验的三项。

| 文件名 | 输出变量或固定目录 |
| --- | --- |
| `check-ui-foundation-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-ui-foundation-review-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-ui-notices-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-launcher-public-api-browser.mjs` | `PARADOX_LAUNCHER_EVIDENCE` |
| `check-launcher-routes-browser.mjs` | 根目录 `.test-data/launcher-routes-browser/task-5` |
| `check-launcher-java-current-draft-browser.mjs` | 根目录 `.test-data/launcher-java-current-draft-browser/task-3-fix-1` |
| `check-launcher-appearance-drafts-browser.mjs` | 根目录 `.test-data/launcher-appearance-drafts-browser/task-4-fix-1` |
| `check-ui-final-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-ui-suite-storage-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-ui-inspector-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-ui-inspector-overrides-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |
| `check-ui-customization-browser.mjs` | `PARADOX_FINAL_EVIDENCE` |

可使用以下逐脚本记录方式。每次调用都给脚本独立的绝对输出目录：

```powershell
Set-Location -LiteralPath (Join-Path $taskRoot 'ui')
$env:PARADOX_UI_URL = 'http://127.0.0.1:1433'
[Environment]::SetEnvironmentVariable('PARADOX_TEST_NATIVE_CSP', $null, 'Process')
[Environment]::SetEnvironmentVariable('PARADOX_SUITE_BUILTINS', $null, 'Process')

function Invoke-UiEvidenceCheck {
  param([string]$Script, [string]$Variable, [string]$Lane)
  $taskCheckName = [IO.Path]::GetFileNameWithoutExtension($Script)
  $taskCheckOut = Join-Path $taskEvidence ($Lane + '/' + $taskCheckName)
  New-Item -ItemType Directory -Path $taskCheckOut -Force | Out-Null
  [Environment]::SetEnvironmentVariable($Variable, $taskCheckOut, 'Process')
  $taskStartedAt = (Get-Date).ToUniversalTime().ToString('o')
  node ('scripts/' + $Script) 2>&1 | Tee-Object -FilePath (Join-Path $taskCheckOut 'runner.log')
  $taskExitCode = $LASTEXITCODE
  [ordered]@{
    script = $Script; cwd = (Get-Location).Path; url = $env:PARADOX_UI_URL
    nativeCsp = $env:PARADOX_TEST_NATIVE_CSP; startedAt = $taskStartedAt
    finishedAt = (Get-Date).ToUniversalTime().ToString('o'); exitCode = $taskExitCode
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskCheckOut 'execution.json') -Encoding utf8
  [Environment]::SetEnvironmentVariable($Variable, $null, 'Process')
  if ($taskExitCode -ne 0) { throw ($Script + ' exited ' + $taskExitCode) }
}

Invoke-UiEvidenceCheck 'check-ui-foundation-browser.mjs' 'PARADOX_FINAL_EVIDENCE' 'dev/foundation'
# 按表重复其余有输出变量的脚本。
```

三个固定目录的脚本不能用这个输出变量重定向。执行前把其现有目录复制到该次脚本记录目录的 `historical-before-run/`；执行后立即复制报告和截图到 `current/`，并记录原目录运行前/后的文件 SHA 与时间。复制整个目录可能含旧 PNG，只有本次实际生成的文件可以算新截图。若需清空工作输出，先归档并验证绝对路径位于上述明确的 `.test-data` 子目录内，再使用原生 PowerShell 的 `Move-Item -LiteralPath`；不删除历史证据。

`PARADOX_FINAL_EVIDENCE` 被多个脚本使用，但默认 base 目录不同。**同一个绝对值会覆盖这些 base**；直接把同一绝对目录交给 `test:foundation-browser` 或 `test:inspector-browser` 的复合命令会发生 `report.json` 覆盖。应逐脚本赋唯一目录。相对值可作为各默认 base 下的运行标签，但要立即归档并记录 cwd。

同一 Foundation 服务另外执行 Inspector 的预览与拾取功能分支，各自记录日志、退出码和报告。下面是开发 lane，编译后按相同方法改用 1435、实际 CSP 与 `compiled/` 目录：

```powershell
$env:PARADOX_FINAL_EVIDENCE = Join-Path $taskEvidence 'dev/foundation/inspector-preview'
node scripts/check-ui-inspector-browser.mjs --preview-only
$env:PARADOX_FINAL_EVIDENCE = Join-Path $taskEvidence 'dev/foundation/inspector-picker'
node scripts/check-ui-inspector-browser.mjs --picker-only
[Environment]::SetEnvironmentVariable('PARADOX_FINAL_EVIDENCE', $null, 'Process')
```

默认输出的三个 base 分别是 `inspector-task-1`、`inspector-task-2`、`inspector-task-3`；明确的绝对输出值覆盖它们。默认分支核验目录与源码，preview 分支核验当前真实像素、表单值和 Portal 镜像，picker 分支核验真实 DOM 命中、范围、缩放和键盘退出。`--source-only` 与名称正则仍会省略默认检查，应在最终默认组清除。

Builtins 套件和完整重设计在 1434 执行：

```powershell
$env:PARADOX_UI_URL = 'http://127.0.0.1:1434'
$env:PARADOX_SUITE_BUILTINS = '1'
Invoke-UiEvidenceCheck 'check-ui-suite-browser.mjs' 'PARADOX_SUITE_EVIDENCE' 'dev/builtins'
Invoke-UiEvidenceCheck 'check-ui-redesign-browser.mjs' 'PARADOX_UI_REDESIGN_EVIDENCE' 'dev/builtins'
```

套件 builtin 分支为两套 × 深浅主题 × 1240×780/320×240，共八个上下文。若同时检查通用 suite compiler/views 分支，另用 Foundation 服务、清除 `PARADOX_SUITE_BUILTINS`，另建证据目录；不要将该分支当作 builtin 八个上下文。

完整 redesign runner 自行给七个专项分配绝对输出路径，依次运行 Home、Instances、Versions/Downloads、Accounts/Discovery、Settings、Dialogs、Logs/Responsive，再运行两套 × 深浅主题 × 85/100/120% × 1240×780、640×480、320×240 的 36 个独立上下文。每个上下文含 14 类状态与九类业务弹窗；1240 宽、100% 的四个上下文另覆盖完整定制和独立的应用/系统减少动效。不能设置 `PARADOX_REDESIGN_MATRIX_ONLY=1` 作为最终全量。

## 实际编译后与 CSP

先在 `ui/` **顺序**构建两个测试模式，用独立的新 outDir；以下路径使用当前 run ID：

```powershell
$taskFoundationDist = Join-Path $taskEvidence 'compiled-foundation-dist'
$taskBuiltinsDist = Join-Path $taskEvidence 'compiled-builtins-dist'
npm exec vite -- build --mode foundation-test --outDir $taskFoundationDist
npm exec vite -- build --mode suite-builtins-test --outDir $taskBuiltinsDist
```

分别在服务终端从 `ui/` preview 对应产物：

```powershell
npm exec vite -- preview --outDir $taskFoundationDist --host 127.0.0.1 --port 1435 --strictPort
```

```powershell
npm exec vite -- preview --outDir $taskBuiltinsDist --host 127.0.0.1 --port 1436 --strictPort
```

检查终端设置 `$env:PARADOX_TEST_NATIVE_CSP='1'`。1435 重新运行上表完整 Foundation 12 项，lane 改为 `compiled/foundation`；1436 设置 `PARADOX_SUITE_BUILTINS=1` 后重新运行 suite builtin 和完整 redesign，lane 改为 `compiled/builtins`。Foundation 运行时清除 builtin 标志。

CSP 必须来自本轮 `apps/desktop/tauri.conf.json` 实际值。核对报告无页面错误、CSP 违规、`/src/` 或 `/node_modules/` 请求。开发服务加 CSP 标志不能替代这两个实际编译产物。

## 普通生产入口

使用前述 `npm run build:ui` 的普通 `ui/dist`，在 `ui/` 执行：

```powershell
$env:PARADOX_UI_DIST = Join-Path $taskRoot 'ui/dist'
$env:PARADOX_UI_REDESIGN_EVIDENCE = $taskEvidence
$env:PARADOX_PERFORMANCE_LABEL = 'final'
$env:PARADOX_PERFORMANCE_RUNS = '3'
node scripts/check-ui-performance-browser.mjs
```

该脚本自行开随机可用端口的 HTTP 服务，使用实际 CSP，并创建至少三个全新普通生产上下文。输出为 `$taskEvidence/production/final/report.json`。核对真实发行 chunk 与 globals 不含测试 fixture、无页面错误/CSP/source/external 请求问题。它报告 startup、交互、长任务和 compiler resources 等度量，但**不执行数值性能预算断言**；不能仅凭退出 0 宣称性能预算通过。

## 需要更新的旧布局测试期望

现有脚本不是截图像素 golden 对比，但包含旧结构与 CSS 的硬断言。更新只匹配已确认方案和实际公开控件，保持业务断言、覆盖和输入边界：

| 当前脚本/位置 | 已知旧假设 | 本轮需要保留的验证 |
| --- | --- | --- |
| Home 54 行 | 四个旧 canvas RGB | 两套当前批准 token 的深浅主题，以及用户主题保存/恢复 |
| Home 58–64 行 | `.sidebar` 必须存在、宽度小于窗口一半；窄窗 immersive launch area 必须 static | 顶部导航/窄竖导航和启动操作在小窗实际可达、无水平溢出 |
| Home 104 行及后续 | immersive 实例切换只通过旧 `.immersive-launch-select` 菜单 | 查看与设为启动目标分开；切换真实 `activeKey`、关闭/回焦及当前状态正确 |
| Instances 239 行 | immersive 所有行高 60–68px | 新批准紧凑行高、修复状态可读、关键操作完整可达 |
| Redesign 131 行 | 全局导航从 `.sidebar`/`.sidebar-account` 查找 | 九条真实路由的当前导航控件，真实键盘进入与 focus 返回 |
| Foundation-review、production observer 等 | 侧栏导航、旧 page classes/账户位置 | 当前 UI 的公开 actions、真实 DOM 拾取位置、普通编辑器及正确性能观察目标 |

行号属于调查时源码，修改后应按当前文件定位。其他 Home account/personalize、实例表列对齐、详情 tabs/context sidebar 等 locators 也要逐项审查。不要删掉断言来制造通过，不把不同布局共有的旧 class 名作为布局验收的唯一证据。

## 输入与产物归档

每条完整 lane 开始和结束保存输入清单：当前 `ui/src`、`ui/scripts`、Vite/TS 配置、两级 package/lock、Tauri 配置及会影响该次运行的实际本地依赖/夹具。每文件记录相对路径、bytes、SHA-256；对源码清单做 before/after 比较。运行中出现漂移则重新冻结并重新运行受影响层。原生构建另外记录 Rust、资源和 build script 等全部实际输入。

同时保留以下输出：

- 两个测试模式 outDir 的文件 manifest、bytes/SHA 和构建日志；普通 `ui/dist` 的独立文件 manifest。
- 浏览器 `report.json`/mode-specific report、所有实际截图的 SHA、定制导出 ZIP 与失败截图；报告中的绝对输出路径必须能找到实际文件。
- runner 的自然退出码、环境/筛选变量清单、源码 hash 与浏览器版本。当前 suite manifest 的 source hashes 必须匹配本轮实际来源 bytes。
- 失败/中止记录原样保留并标明范围；新的通过不改写旧失败。只有本轮生成的记录可标记“2026-11-15 当前源码通过”。

## 原生构建与本人验收

根目录运行当前源码的原生 debug 构建：

```powershell
Set-Location -LiteralPath $taskRoot
npm run build -- --debug --no-bundle
Get-Item -LiteralPath 'target/debug/paradox-launcher.exe' | Select-Object FullName, Length, LastWriteTimeUtc
Get-FileHash -LiteralPath 'target/debug/paradox-launcher.exe' -Algorithm SHA256
```

归档完整构建日志、输入 before/after、内嵌前端 manifest、exe 的实际 bytes/SHA，必要时将该 exe 复制到此 run 的 `native/`。旧 2026-11-08 exe SHA 不证明本轮构建。Rust 检查若复用历史记录，必须独立证明其全部执行输入未变并明确记为复用，不能记为本轮新运行。

尚未找到覆盖以下全部交互的现有原生自动 runner，因此这些项目保留“待本人验收”，不能用浏览器边界模拟代替：

| 项目 | 当前构建实际操作 |
| --- | --- |
| 标题栏 | 拖动、双击最大化/还原；窗口按钮、输入、复选框和文字选择不误触拖动 |
| 键盘/焦点 | Tab、Escape、嵌套菜单、弹窗初始/返回焦点、Ctrl+Enter、Ctrl+Shift+F11/F12 |
| 显示与语言 | Windows DPI 100/125/150/200%；中文/英文；小窗滚动到关键操作 |
| Microsoft | 实际设备代码授权、刷新、切换、游戏身份、取消与过期恢复 |
| 游戏/关闭 | 实际安装、修复、启动、停止；运行中停止退出、后台继续、留在窗口 |
| 来源恢复 | 普通 editor 定制、损坏/隐藏来源后 F12、原字节导出、修复同一草稿、`--ui-safe` |

每项记录所用 exe SHA、Windows/WebView2 环境、实际结果和发现。应用 `ui_scale` 的 85/100/120% 与 Windows DPI 分开；200% 不是合法应用缩放值。
