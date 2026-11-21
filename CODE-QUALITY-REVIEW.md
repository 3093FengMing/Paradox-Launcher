# Code Quality Review

## Summary

持久化写入缺少对应读取上限，异步流程遗漏失败重试与生命周期边界，多个领域集中在大型文件中增加了维护成本；本轮修复九类实际缺陷，并按职责拆分实现和测试，完整源码评分达到 **91.54/100**。

审查时间：2026-11-21（Asia/Shanghai）。采用 [Done-0/fuck-u-code 的 fuck-u-code-analysis skill](https://github.com/Done-0/fuck-u-code/blob/27ae48f50816a40afc4c6f4923e9444883683093/skills/fuck-u-code-analysis/SKILL.md) 及其 Rust / TypeScript 阈值，运行 `eff-u-code 2.2.2`。指标用于选择热点，缺陷结论由源码与受控故障回归确认。

## Overall Assessment

| Metric | 原始 HEAD | 故障修复后 | 最终优化后 |
|--------|----------|-----------|------------|
| Overall | 86.65/100 | 86.40/100 | **91.54/100** |
| Files Analyzed | 321 | 321 | 414 |
| Skipped Files | 0 | 0 | 0 |
| Code Lines | 51,444 | 51,830 | 52,090 |
| Files Scoring Below 60 | 0 | 0 | 0 |
| Critical Metrics（工具标记数） | 100 | 102 | 136 |
| Files with Critical Metrics | 78 | 78 | 124 |
| 本轮确认并修复的问题类别 | — | 9 | 9 |

扫描范围和默认权重保持一致：`crates/launcher-core/src`、`apps/desktop/src`、桌面 `build.rs`、`ui/src`、`ui/vite.config.ts` 中的 Rust / JavaScript / TypeScript / TSX。复杂度 32%、重复 20%、规模 18%、结构 12%、错误处理 8%、文档 5%、命名 5%。SDK 子模块、依赖、构建输出、源码范围之外的独立测试脚本和示例没有进入评分。

最终文件数增加来自模块拆分。所有新源文件、Rust 内联测试和前端源码测试夹具均参与扫描，没有移出评分范围、删除回归、改变权重或添加无用注释。公共入口通过重导出或原类型固有方法保持调用路径。

整仓 CLI 在文件发现阶段报 `Maximum call stack size exceeded`。[scripts/check-code-quality.mjs](scripts/check-code-quality.mjs) 每次生成全新完整源码快照，避免遍历依赖与构建树，并校验解析文件数等于源码清单；低于 90 分时退出码为 1。复现命令：

```powershell
npm install -g eff-u-code@2.2.2
node scripts/check-code-quality.mjs
```

脚本不修改依赖锁或权重。JSON CLI 输出不包含 `locations`，另通过同版本 Analyzer API 获取定位证据；未使用外部 AI 审查服务。原始数据保存在本地忽略目录 `.test-data/fuck-u-code-review-2026-11-21/` 的 `before.json`、`after.json`、`optimized.json` 和对应 `*-details.json`，仓库保留本报告及扫描脚本。

工具 critical 标记不等于业务缺陷或漏洞。最终 136 项中，120 项来自错误处理启发式：逐行正则不能可靠识别 Rust 的 `?`、测试中的 `unwrap()` 和跨行 `Result`。拆分会增加含此类标记的文件数；重复指标也会把相近故障测试的控制流签名判为重复。真实行为以 Clippy、回归和复核为准。91.54 分是项目平均，仍有局部维护热点。

领域结果按代码行加权，包含入口、实现及全部源码测试：

| 领域 | 原始单文件评分 | 最终完整领域评分 | 最终文件数 |
|------|----------------|------------------|------------|
| Accounts | 65.06 | 92.03 | 18 |
| Auth | 85.64 | 95.94 | 7 |
| Content | 63.66 | 89.64 | 13 |
| Download | 74.07 | 91.12 | 10 |
| Java | 76.78 | 92.04 | 9 |
| Process | 77.13 | 95.44 | 10 |
| SDK | 61.68 | 93.04 | 14 |

## Key Issues (sorted by severity)

以下九类实际问题均已修复。位置指最终源码；指标用于选择审查位置，工具没有直接识别这些业务错误。

| 优先级 / 位置 | 根因与最终行为 | 回归证据 |
|---|---|---|
| P1：`process/probe.rs` L37 / L99，`probe_output` / `read_output` | Java wrapper 输出无上限，读取任务可能残留。stdout / stderr 各限 1 MiB，最多额外读取一字节；错误、超限、超时和取消均终止并回收进程树。 | 上限内完整读取、超限停止读取、真实 Windows 超限进程提前回收，原有取消与后代回收覆盖保留。 |
| P1：`content/transaction.rs` L42，`rollback` | 路径校验失败可提前返回，使 TempDir 清除未恢复原文件。现在累计路径和 I/O 失败，继续恢复其余文件，失败时保留备份并报告恢复目录。 | 无效路径和重命名冲突不阻止其他文件恢复，未恢复原文件仍在备份目录。 |
| P1：`accounts/metadata.rs` L41，`prepare_state` | 读取限 128 KiB，写入无相同限制。现在修改凭据前检查序列化大小，避免登录后生成不可读登记。 | 超限登录保留旧凭据、登记和缓存会话，凭据写入次数为零。 |
| P2：`catalog.rs` L105，`CatalogCache::save` | 合法条目与字段长度不保证总 JSON 小于 8 MiB。现在原子替换前检查实际字节数。 | 50,000 个合法但超限条目不能替换旧缓存，临时文件清理且旧缓存可读。 |
| P2：`content/local.rs` L61，`registry_bytes` | 登记读取限 4 MiB，写入无相同限制。现在超限发生在文件事务提交前。 | 超限更新保留旧登记、禁用模组、复用文件及原字节。 |
| P2：`ui/src/hooks/useDownloadQueue.ts` L38 / L93，`refresh` / `perform` | 同一事件 revision 下旧 IPC 快照覆盖新结果，旧生命周期命令完成还能触发读取。现在校验读取序号、revision 和生命周期，实际命令结束后释放预约。 | 五项受控 IPC 回归覆盖乱序、旧错误、卸载后完成、重连预约释放和卸载后调用。 |
| P2：`ui/src/ui-editor/controller.tsx` L390 / L402，`scope` / `prepareTrusted` | 失败 Promise 留在缓存，使重试持续失败。现在只清除对应失败 Promise，保留成功实例和重连后的新缓存身份。 | 两项新增回归覆盖可信编译及 scope 失败重试、草稿保留，原生命周期套件全部通过。 |
| P2：`model.rs` L54，`Settings::validate` | 全局 Java 路径、JVM 和游戏参数遗漏 NUL 校验，直到创建进程才失败。现在保存前拒绝 NUL。 | 三个字段的无效候选不能替换旧配置，原配置可读。 |
| P2：`apps/desktop/src/launch/supervision.rs` L93，`supervise_process` | 退出后只读已排队日志，稍晚发送的尾部输出丢失。现在发布终态前等待 EOF，最多一秒，超时给出诊断。 | 延迟尾日志仍记录并脱敏，继承管道不关闭时有界结束。 |

本轮维护优化：

- 账户拆分元数据、恢复日志、登录、提交与会话；认证拆分 OAuth、Minecraft、profile、response 与类型。复用登录夹具、预约和凭据回退辅助逻辑，保留轮换先持久化及取消锁顺序。
- 下载拆分进度、传输和校验；Java 拆分归档、发现和安装；进程拆分所有权、日志和探测。桌面启动拆分 controller / supervision，下载拆分 request / execution；`GameLaunch` 消除原八参数函数的 Clippy 豁免。
- SDK 拆分命令、安装、启动、元数据和路径；内容拆分模型、远端查询、本地登记、安装和事务。测试按同一领域分组，保留公开 API 与子进程测试过滤路径。
- SVG 拆分白名单、几何语法和属性引用；raster / font 分离格式头及目录；DEFLATE 分离位读取、Huffman 和块校验；customization 分离词法来源与所有者快照。保留预算、白名单、环检测和碰撞保护。
- 原 SVG 几何 / 属性校验认知复杂度最大 33、嵌套最大 9；最终 `svg-geometry.ts` 为 14 / 3，`svg-attributes.ts` 为 14 / 2，降低来自游标、明确语法函数与属性分派。

仍有维护热点，未确认其构成功能错误：

- `sdk/metadata.rs::validate_metadata_paths` L47：圈复杂度 16、认知复杂度 28、嵌套 6；artifact / classifier 路径校验保持完整。
- `content/install.rs::install` L4 / `install_files` L76：认知复杂度 20，安装协调嵌套 5，文件评分 68.38。
- `ui/src/ui-editor/controller.tsx::load` L310：圈复杂度 26、认知复杂度 32；文件 862 代码行、64 函数、24 导入，评分 70.30。

## Refactoring Plan

本轮已完成：

1. 对齐账户、目录和内容登记读写上限，补齐旧数据保留回归。
2. 限制 Java 探测输出，统一取消、超时及失败的进程回收。
3. 累计内容事务回退失败，保留恢复目录。
4. 保护下载响应次序、命令生命周期及编辑器失败缓存重试。
5. 保存前校验启动字段，等待并脱敏进程尾日志。
6. 按领域拆分 Rust 实现及测试，保持公开入口和子进程过滤路径。
7. 分离前端资产语法、目录、压缩结构及所有者来源逻辑。
8. 新增完整源码检查脚本，复扫并通过全量验证和独立复核。

后续建议（本轮无已确认缺陷依赖这些改动）：

1. 提取 `sdk/metadata.rs` L47 的库下载字段校验，保留路径和链接测试。
2. 拆分 `content/install.rs` L4 的依赖选择及文件计划，保留取消和事务故障覆盖。
3. 分离 `controller.tsx` L310 的初始化与激活协调，维持永久 owner、草稿及 CAS 回归。

最终验证：

- `npm run lint:ui`、`npm run check:i18n`、`npm run test:ui`、`npm run build:ui` 全部通过；双语覆盖 1111 键、1962 处静态调用。
- 完整前端测试包含下载配置 37 项、永久编辑器生命周期 35 项、公开业务 API 65 项和 ownership 16 项；资产模型 29 项、交互性能专项 7 项另行通过。
- Rust 格式、`cargo check --workspace --all-targets --locked`、严格全目标 Clippy 全部通过。
- `cargo test --workspace --all-targets --locked`：**294 passed、0 failed、2 个既有 ignored**。core 231 passed / 1 ignored，desktop 54 passed / 1 ignored，示例 9 passed。
- 原始源码 277 个 Rust 测试函数均保留，最终 287 个；十项新增回归未移出评分范围。
- 三组独立只读复核覆盖 SDK / 内容、下载 / Java / 进程 / 桌面、账户 / 认证及前端资产边界，未发现拆分导致的行为回归。
- Rust 使用既有 `with-sdk.cmd` 配置缓存 Windows SDK；未安装工具链或改变依赖。日志位于本地忽略目录的 `final-*.log`。

本轮覆盖 Windows 编译、离线受控故障和真实受控子进程，不代表重新验收真实 Minecraft、真实账户登录、完整原生 GUI 或其他平台。浏览器资产解码入口保留，本轮未重跑完整浏览器验收。Vite 仍有既有 native config loader 未来兼容及大分包提示，生产构建成功。

提交范围包含修复、模块优化、报告、检查脚本，以及用户原有 `.gitattributes` 删除和 `.gitignore` 修改。SDK 子模块及依赖锁未改变。

## Security Concerns

已修复两项具体资源或数据保护问题：

- `process/probe.rs` L37 / L99：不可信 Java wrapper 输出可耗尽内存；每条流现限 1 MiB，失败时回收进程树。
- `content/transaction.rs` L42：路径校验失败可能使未恢复备份被析构清除；回退失败现保留原文件并报告恢复目录。

账户、路径、链接、ZIP / 资产预算及 token 边界结合源码和既有回归检查。凭据秘密类型保持既有序列化限制，日志继续脱敏，文件写入保留原子替换及校验。未确认其他需本轮修复的安全缺陷；质量评分不等于完整安全审计。
