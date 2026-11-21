# SDK 与依赖源码

## QuintElement 子模块

`QuintElement/` 是 [3093FengMing/QuintElement](https://github.com/3093FengMing/QuintElement) 的 Git submodule，保留独立 Cargo workspace 和 AGPL-3.0-only 许可。启动器通过 `vendor/QuintElement/crates/elemental` path 依赖直接编译，只编译应用需要的 SDK crate。

初始化使用 `git submodule update --init --recursive`。核心开发在子模块的功能分支中进行，先向 fork 推送提交，再在启动器提交新 gitlink。启动器构建读取子模块中的源码，仓库记录的 gitlink 固定实际 SDK 提交。

### 2026-11-21 同步与 TLS 选择

当前 gitlink 固定 SDK [`5ead9ef`](https://github.com/3093FengMing/QuintElement/commit/5ead9ef5c28973c8802f4ef551e0b27347e8d170)，合入上游 [`2e13f21`](https://github.com/ElectronicWave/Elemental/commit/2e13f217ced9ac2890ebd1d6044cbe121f9aabdb) 的 26 个新提交。facade 仍为 `elemental-kit 0.3.0`，两个仓库继续使用 `dev`。

上游提供 `tls-aws-lc`（默认）、`tls-rustls-no-provider`、`tls-native`、`tls-native-vendored`。根 `Cargo.toml` 使用 `default-features = false` 和 `tls-native`，将 native TLS 选择传播到 SDK 各层；SDK 的 TLS manifest 与上游一致，不再修改 SDK reqwest 后端。应用 reqwest 保持 `native-tls`，Windows 使用 schannel。解析后的启动器依赖没有 AWS-LC 包；SDK 默认 AWS-LC 工作区和其他三种配置均编译通过。`tls-rustls-no-provider` 使用方需在宿主安装 rustls crypto provider。

显式启用 `driver-fabric`、`driver-quilt`、`driver-forge`、`driver-neoforge`，原版始终注册。此次上游存在破坏性 API 变化：`Driver` 不再携带布局泛型；准备请求与结果改用 `SharedRootLayout` / `SharedInstanceLayout`，`PrepareRequest` 新增 `on_stage`；Forge / NeoForge 使用 `InstallerFamilyDriver`、`InstallerMavenSource` 和 `MavenInstallerSpec`；Vanilla prepared alias 移到 driver 模块，`load` 不再接收 endpoints，下载 planner 显式传入 resolver。应用已迁移这些调用，完整说明见[上游迁移文档](QuintElement/docs/migration/0.3.md)。

仍有消费者的 `DownloadBatch::into_tasks`、`Distribution::from_validated_root` 保留。Forge installer 游戏版本冲突检查与 NeoForge release / FML marker 识别迁移为 spec 回调，原有回归测试继续有效；删除了已被上游移除的离线 variables builder 测试入口。网络上限、镜像、代理、下载取消、所选 Java / javaw、实际 natives 和完整进程树所有权继续由应用适配。应用 Microsoft 登录与 OS 凭据库仍由现有事务实现，因此不启用 SDK 的可选 `microsoft-auth`；不新增 Yggdrasil 或皮肤 / 披风产品界面。

本次 Rust 1.92.0 locked 全目标 check、严格 Clippy 和测试通过：SDK **73 项**，启动器 **284 项、2 项既有忽略**。两个工作区格式检查、SDK `format.bat`、launchpad `--help` 通过。当前 UI 的 lint、i18n、测试和构建通过，翻译为 1111 键 / 1962 静态调用；首页、设置、版本下载浏览器回归分别验证当前 UI 修改。这些 UI 修改单独提交。

以下 2026-11-16 和更早的游戏运行矩阵与原生构建是历史证据，不计作本次运行结果。本次详细日志位于本地忽略目录 `.test-data/2026-11-21-quintelement-tls-sync/`。

### 2026-11-16 历史同步
同步使用的 `upstream` remote 指向 [ElectronicWave/Elemental](https://github.com/ElectronicWave/Elemental)。2026-11-16 的固定 SDK 提交为 [`013abda`](https://github.com/3093FengMing/QuintElement/commit/013abda8585d58637cdd1f512b1eea820641f63f)，合入本轮实际 fetch 的最新上游 [`d4c3ab9`](https://github.com/ElectronicWave/Elemental/commit/d4c3ab920bd7ee25b38d37c058623f0e7336453c)。SDK 和启动器继续使用 `dev`；`.gitmodules` 的远程更新分支也是 `dev`，构建仍以启动器 gitlink 固定的提交为准。facade package 升级为 `elemental-kit 0.3.0`，本轮没有修改 `main`。

### 0.3 接口与兼容边界

2026-11-16 按[上游 0.3 迁移文档](QuintElement/docs/migration/0.3.md)适配：

- `Driver` / source 改为 `Send + Sync`，异步实现使用 `#[async_trait]`，不再使用 `?Send`。应用 `BoundedProfileFamily` 与 service 的扫描、下载准备和启动命令 future 均有 `Send` 回归。
- `Launcher::inspect_instances()` 返回 `InspectReport { instances, failures }`。`ElementalService::inspect()` 保持应用 / IPC 的健康实例列表，并按名称、路径与错误记录失败；根目录 IO 错误仍返回失败。损坏 JSON 不改写，健康实例扫描不创建 `.elemental`。
- 目录 `description` 删除、`stream` / `with_stream` 改为 `channel` / `with_channel`。应用有界目录读取 Mojang / loader 原始结构，不依赖这些旧字段；不恢复无消费者的兼容 API。
- `MicrosoftAuthorizer` 改为 boxed `Send + Sync` verification handler，构造器为 `MicrosoftAuthorizer::new(...)`。启动器实际认证仍由 `auth.rs` / `AccountsManager` 事务和 OS 凭据库完成，SDK 认证变化不引入新的账户存储、Yggdrasil 或服务器界面。
- 上游保留 native JAR artifact 在启动 classpath 的修复已合入。SDK 两套 classpath 入口和应用真实 prepare / load / build 流程均有回归，继续验证 rule、module-path 排除、classifier-only 和安全相对路径边界。实际 natives 搜索目录适配仍不可移除。
- Windows 加载器 worker 复用 `OwnedChild`：挂起创建、绑定 Job 后恢复执行；等待覆盖先退出包装程序的子进程，取消 / 停止 / 析构在返回前完成树回收。移除旧的启动后绑定 Job 重复实现；保留 Unix process group、下载队列、Java 探测与账户事务边界。
- 两个 workspace 使用现有 Rust 1.92.0 和锁文件。SDK 0.3.0、`jiff 0.2.45` 与 `zip 9.6.0` 已对齐；native-tls / Windows schannel 不变。

本轮继续保留 `DownloadBatch::into_tasks`、`Distribution::from_validated_root`、Forge / NeoForge 身份检查与必要 family 检测入口。上游尚未覆盖这些有消费者的补丁；新增 Rust overlay 仅为 classpath 回归及 Windows 并行测试目录的唯一后缀。当前 UI 的 Graphite、导航 / 密度、自定义公开 Provider、Original、来源套件、草稿 / CAS、编辑器和 Recovery 边界未改动。

### 2026-11-12 历史迁移

上次固定 SDK [`e32e378`](https://github.com/3093FengMing/QuintElement/commit/e32e3784ebcb00a2caa9e62343d98610f16bed60)，合入上游 [`62bb657`](https://github.com/ElectronicWave/Elemental/commit/62bb657aeba31d115331ef18a4cfd58ca4fba7ce)。

2026-11-12 按[上游 0.2 迁移文档](QuintElement/docs/migration/0.2.md)逐项核对 80 个条目，接入公共 `Launcher::builder`、实例加载、`Driver::prepare(&PrepareRequest)`、共同 prepared 类型及 `build_launch_command`。运行时和启动参数改为 `RuntimeOptions` / `LaunchOptions`；认证入口从 `UserCredential` 改为 `Credential`，直接使用旧 SDK API 的调用者需按该文档迁移。应用账户仍由 OS 凭据库和原有刷新事务管理，SDK 新增的账户持久化、Yggdrasil 和离线服务器能力不扩展产品界面。

2026-11-12 的 SDK 相对上游 Rust 差异由原来的 12 个文件缩减到 6 个文件（含回归测试）。保留 `DownloadBatch::into_tasks`、Forge / NeoForge 身份校验与必要 family 检测入口，以及 `Distribution::from_validated_root`。该新增构造器导入应用已受控探测的 Java 属性，避免无 `release` 文件时再次启动未受应用取消管理的 SDK 探测；它不读写运行时元数据，上游 provider 和默认 executable 语义保持原样。精确的 Java / javaw 路径与实际 natives 搜索目录由应用适配，Windows 游戏和 Java 探测在执行前绑定 Job，等待、停止与析构覆盖完整进程树；2026-11-16 加载器 worker 也复用同一所有权实现。

2026-11-08 的历史基线是在 fork `969227c` 上合入上游 [`540c3b3`](https://github.com/ElectronicWave/Elemental/commit/540c3b361e7d9796b1c04f5ec4992e19418a3bff)，合并提交为 [`92a4d18`](https://github.com/3093FengMing/QuintElement/commit/92a4d1848ab8840e29abd5d0c700b0089a58fb06)。该轮同步版本名称解析、凭据与启动命令 API、驱动目录、下载进度及 launchpad CLI；launchpad 替代旧 demo，CLI 依赖固定在 SDK 自己的 Cargo.lock 中。

游戏目录使用 `GameVersionCatalog`，Fabric、Quilt、Forge、NeoForge 目录使用 `LoaderVersionCatalog`。SDK 的旧 ResourceLimits 和目录归一化补丁已移除；产品目录映射与有界请求由应用的 catalog / profile 适配负责，显式 metadata 请求保留 8 MiB 上限、整体超时、代理 / 镜像、稳定性映射、排序去重和安全版本过滤。built-in Driver 的 Vanilla 远程修复继续采用上游 client 行为。NeoForge `21.0.x` 归入 Mojang `1.21`；SDK 保留 Forge 游戏版本冲突检查与 NeoForge 检测标记 / 版本载体区分，因为公共 Launcher 内部固定注册的 driver 仍依赖这些身份入口。

Vanilla 继续由 SDK 规划下载、应用 `DownloadEngine` 执行、SDK 完成准备；公开 `DownloadBatch::into_tasks` 保留应用下载引擎接入。加载器继续使用 SDK download session 和隔离 worker，以便取消 installer 与 Java processor 的整个进程树。

## 认证依赖与 TLS

SDK 的可选 `microsoft-auth` authorizer 通过 `oauth2-reqwest` 将 reqwest 0.13 client 接入 oauth2 5，与 `minecraft-msa-auth 0.5.0` 的 `HttpClient` 使用同一 reqwest 版本。启动器恢复使用 crates.io 的原始 helper，已移除 `vendor/minecraft-msa-auth/` 与根 `Cargo.toml` 的 `[patch.crates-io]` 覆盖。

启动器通过上游 `tls-native` feature 选择 native-tls，Windows 使用 schannel。SDK 不再维护后端硬编码补丁；未使用的 SDK Microsoft helper 依赖从启动器锁文件移除。

启动器已实现设备代码登录、账户刷新与凭据清理。认证与游戏的实际验收结果见 [验证记录](../docs/VERIFICATION.md)。

## 升级回归

### 2026-11-16 历史验收

SDK **40 项通过**，启动器 **284 项通过、2 项既有忽略**；两个工作区 locked 全目标 check、严格 Clippy（`-D warnings`）、格式检查通过，SDK `format.bat` 和 launchpad `--help` 通过。UI `lint:ui`、`check:i18n`、`test:ui`、`build:ui` 全部通过，翻译检查为两种语言 1108 个资源键 / 1952 处静态调用。前端源码未变；Vite 关于未来 native config loader 和 chunk 大小的既有提示为非阻断。

四种 loader 在独立中文 / 空格路径的缓存副本和完全空目录全新安装中，各完成两次纹理 / 声音就绪与受控进程树回收；全新矩阵使用 canonical Windows 路径：

| Loader | 游戏版本 | 缓存版本 | 全新版本 | 各场景就绪 / 回收 |
| --- | --- | --- | --- | --- |
| Fabric | 1.20.1 | 0.20.1 | 0.20.1 | 2 / 2 |
| Quilt | 1.20.1 | 0.30.1 | 0.30.2 | 2 / 2 |
| Forge | 1.20.1 | 47.4.28 | 47.4.29 | 2 / 2 |
| NeoForge | 1.21.1 | 21.1.265 | 21.1.266 | 2 / 2 |

Vanilla 缓存副本的 1.12.2 / Java 8、1.20.1 / Java 17、1.21.1 / Java 21、26.3 / Java 25 各完成两次就绪与受控停止；初次复用与修复均为 0 下载文件，实际 native / 纹理 / 声音加载通过。Java wrapper / javaw、下载取消、受控探测、提前退出包装程序和 loader worker 回收均由本轮单元回归覆盖。

另一个不运行游戏的独立副本只在 SDK 调用前显式迁移四个 native-state 绝对路径字段；两次扫描 / 加载均通过并保持 JSON / natives 状态不变。首个未迁移路径且与游戏共享副本的检查因预期的 native 状态更新未通过，已保留为诊断，不计入通过。历史 loader / Vanilla 源缓存共 **20,260 文件**的大小、时间和 SHA-256 均保持一致；本次未触碰用户游戏目录。

当前内嵌前端的 Windows x64 **debug** 构建为本地 `.test-data/2026-11-16-quintelement-sync/native-debug/paradox-launcher-20261116.exe`，**45,041,152 字节**，SHA-256 `BDEDC0BDF9FDCFC83E5A4B4DE817B493B8C3B190977B137C3F2EF49105783E1C`。debug 使用项目既有 console subsystem，release 的 GUI subsystem 约定未改变；CLI version / help 和隔离四-loader 扫描通过。本轮未做新的 GUI 视觉或在线正版 / 服务器身份验收，也不把受控停止计作自然退出。

详细日志和通过 / 失败证据分别位于 `.test-data/2026-11-16-quintelement-sync/`，保持本地忽略。Codacy MCP / token 当前不可用，不宣称远程复杂度 / 评分检查完成；本地严格 Clippy、测试与构建结果已记录。

### 历史验收

2026-11-12 历史验收：SDK **34 项通过**，启动器 **275 项通过、2 项既有忽略**；两个工作区全目标 check、严格 Clippy 与格式检查、四项 UI 检查及内嵌前端的 Windows debug 构建通过。源码和最终运行证据已独立复审；包装程序提前退出后的子进程所有权与无 release 文件的额外探测问题均有回归和独立复验。

四种 loader 的历史缓存副本和全新中文 / 空格目录分别完成各两次纹理 / 声音就绪与受控停止，进程树均已回收。缓存两次停机扫描与加载的 JSON / natives 状态不变；运行前后仅四个实例的 JNA 临时 DLL / 空 `.x` 文件及目录时间轮换，其他 native 和 JSON 不变。历史 loader 与 Vanilla 原目录共 20,260 个文件的大小、时间与 SHA-256 均保持一致。

| Loader | 游戏版本 | 保留的缓存版本 | 全新安装版本 | 各场景就绪 / 回收 |
| --- | --- | --- | --- | --- |
| Fabric | 1.20.1 | 0.20.1 | 0.20.1 | 2 / 2 |
| Quilt | 1.20.1 | 0.30.1 | 0.30.2 | 2 / 2 |
| Forge | 1.20.1 | 47.4.28 | 47.4.29 | 2 / 2 |
| NeoForge | 1.21.1 | 21.1.265 | 21.1.265 | 2 / 2 |

Vanilla 副本的 1.12.2 / Java 8、1.20.1 / Java 17、1.21.1 / Java 21、26.3 / Java 25 各完成两次就绪与受控停止，修复下载文件数均为 0；26.3 实际 native、纹理和声音加载通过。本轮运行使用离线身份及受控停止，正版在线身份与自然退出另行验收。当前 Windows debug 文件为本地 `.test-data/2026-11-11-quintelement-sync/native-debug/paradox-launcher-20261112.exe`，44,970,496 字节，SHA-256 `33132E194F4B27468BA5D1200767EDC1E79E69403930094F5C4D57E3AE4A6525`；详细交付记录位于同目录任务根下的 `completed-delivery-20261112.json`，这些本地验收记录保持忽略。

`verify_loaders --cached` 使用既有报告中的版本，不查询目录或安装；省略该参数可在空目录验证全新安装，`--canonical-root` 验证 Windows canonical 路径。工具的 `PARADOX_TEST_PROXY` 可设置进程内测试代理。`verify_mvp` 默认仍要求自然关闭与退出码 0；仅显式设置 `PARADOX_TEST_CONTROLLED_STOP=1` 才执行并记录本轮采用的受控停止。`PARADOX_SDK_UPGRADE_REPORT` 可将只读升级检查报告指向本轮独立目录。

SDK 工作区执行 `cargo test --workspace --all-targets --locked`。启动器执行全目标编译、Clippy、测试与前端检查，并保留加载器身份、路径和下载取消回归。 2026-11-08 同步验收为 SDK 38 项测试、启动器 257 项测试通过（2 项既有忽略），严格 Clippy、格式、四项前端检查与 launchpad `--help` 通过。Fabric、Quilt、Forge、NeoForge 的已有隔离缓存均完成扫描与加载，JSON / natives 加载状态未变；NeoForge 离线启动达到纹理与声音就绪后受控停止，仅允许该实例的 JNA 临时文件轮换。

已有隔离 loader 缓存可通过以下工具检查扫描与加载兼容性；工具读取之前的验收版本，不查询或下载新版本，并核对 JSON / natives 状态保持一致：

```powershell
cargo run -p paradox-core --example verify_sdk_upgrade --locked -- '<绝对 .test-data 缓存目录>'
```

追加 `--launch-neoforge` 可使用缓存 Java 21 和离线身份启动已有 NeoForge 实例，等待纹理 / 声音就绪后受控停止。报告写入 `.test-data/2026-11-07-quintelement-upstream/`，不覆盖原缓存报告；受控停止和缓存复用不代表自然退出、全新安装或正版在线身份验收。
