# SDK 与依赖源码

## QuintElement 子模块

`QuintElement/` 是 [3093FengMing/QuintElement](https://github.com/3093FengMing/QuintElement) 的 Git submodule，保留独立 Cargo workspace 和 AGPL-3.0-only 许可。启动器通过 `vendor/QuintElement/crates/elemental` path 依赖直接编译，只编译应用需要的 SDK crate。

初始化使用 `git submodule update --init --recursive`。核心开发在子模块的功能分支中进行，先向 fork 推送提交，再在启动器提交新 gitlink。启动器构建读取子模块中的源码，仓库记录的 gitlink 固定实际 SDK 提交。

同步使用的 `upstream` remote 指向 [ElectronicWave/Elemental](https://github.com/ElectronicWave/Elemental)。2026-11-08 在 fork 的 `969227c` 基础上合入上游主线 [`540c3b3`](https://github.com/ElectronicWave/Elemental/commit/540c3b361e7d9796b1c04f5ec4992e19418a3bff)，实际合并提交为 [`92a4d18`](https://github.com/3093FengMing/QuintElement/commit/92a4d1848ab8840e29abd5d0c700b0089a58fb06)。本次同步 Minecraft 版本名称解析、凭据与启动命令 API、驱动目录、下载进度及 launchpad CLI；launchpad 替代旧 demo，新增 CLI 依赖固定在 SDK 自己的 Cargo.lock 中。SDK 继续使用 `dev` 分支，`.gitmodules` 的远程更新分支也是 `dev`；启动器通过 gitlink 固定实际提交，正常递归检出仍使用该固定版本。facade package 保持 `elemental-kit 0.2.0`。

游戏目录使用 `GameVersionCatalog`，Fabric、Quilt、Forge、NeoForge 目录使用 `LoaderVersionCatalog`。加载器目录保留 8 MiB 响应大小上限、配置中的整体请求超时、稳定性映射、排序去重和安全版本过滤；NeoForge `21.0.x` 归入 Mojang 的 `1.21`。Forge 的 installer 游戏版本冲突检查与 NeoForge 的检测标记 / 版本载体区分迁入新 family 扩展点。

Vanilla 继续由 SDK 规划下载、应用 `DownloadEngine` 执行、SDK 完成准备；公开 `DownloadBatch::into_tasks` 保留应用下载引擎接入。加载器继续使用 SDK download session 和隔离 worker，以便取消 installer 与 Java processor 的整个进程树。

## 认证依赖与 TLS

SDK 的 Microsoft authorizer 通过 `oauth2-reqwest` 将 reqwest 0.13 client 接入 oauth2 5，与 `minecraft-msa-auth 0.5.0` 的 `HttpClient` 使用同一 reqwest 版本。启动器恢复使用 crates.io 的原始 helper，已移除 `vendor/minecraft-msa-auth/` 与根 `Cargo.toml` 的 `[patch.crates-io]` 覆盖。

启动器和 SDK 保留 `native-tls`，Windows 使用 schannel。上游同步保留了这一 TLS 选择。

启动器已实现设备代码登录、账户刷新与凭据清理。认证与游戏的实际验收结果见 [验证记录](../docs/VERIFICATION.md)。

## 升级回归

SDK 工作区执行 `cargo test --workspace --all-targets --locked`。启动器执行全目标编译、Clippy、测试与前端检查，并保留加载器身份、路径和下载取消回归。 2026-11-08 同步验收为 SDK 38 项测试、启动器 257 项测试通过（2 项既有忽略），严格 Clippy、格式、四项前端检查与 launchpad `--help` 通过。Fabric、Quilt、Forge、NeoForge 的已有隔离缓存均完成扫描与加载，JSON / natives 加载状态未变；NeoForge 离线启动达到纹理与声音就绪后受控停止，仅允许该实例的 JNA 临时文件轮换。

已有隔离 loader 缓存可通过以下工具检查扫描与加载兼容性；工具读取之前的验收版本，不查询或下载新版本，并核对 JSON / natives 状态保持一致：

```powershell
cargo run -p paradox-core --example verify_sdk_upgrade --locked -- '<绝对 .test-data 缓存目录>'
```

追加 `--launch-neoforge` 可使用缓存 Java 21 和离线身份启动已有 NeoForge 实例，等待纹理 / 声音就绪后受控停止。报告写入 `.test-data/2026-11-07-quintelement-upstream/`，不覆盖原缓存报告；受控停止和缓存复用不代表自然退出、全新安装或正版在线身份验收。
