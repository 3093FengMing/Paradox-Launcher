# SDK 与依赖源码

## QuintElement 子模块

`QuintElement/` 是 [3093FengMing/QuintElement](https://github.com/3093FengMing/QuintElement) 的 Git submodule，保留独立 Cargo workspace 和 AGPL-3.0-only 许可。启动器通过 `vendor/QuintElement/crates/elemental` path 依赖直接编译，只编译应用需要的 SDK crate。

初始化使用 `git submodule update --init --recursive`。核心开发在子模块的功能分支中进行，先向 fork 推送提交，再在启动器提交新 gitlink。启动器构建读取子模块中的源码，仓库记录的 gitlink 固定实际 SDK 提交。

同步使用的 `upstream` remote 指向 [ElectronicWave/Elemental](https://github.com/ElectronicWave/Elemental)。2026-11-07 合入 `upstream/main` 的 [`77027a8`](https://github.com/ElectronicWave/Elemental/commit/77027a8)，fork 合并提交为 [`29ea041`](https://github.com/3093FengMing/QuintElement/commit/29ea04124d79cb69d34817931207a080e6b8f607)，已同步到 `paradox-launcher-v0.5-dependency` 分支。启动器通过 gitlink 固定该提交；facade package 仍为 `elemental-kit 0.2.0`。

## 认证依赖与 TLS

SDK 的 Microsoft authorizer 通过 `oauth2-reqwest` 将 reqwest 0.13 client 接入 oauth2 5，与 `minecraft-msa-auth 0.5.0` 的 `HttpClient` 使用同一 reqwest 版本。启动器恢复使用 crates.io 的原始 helper，已移除 `vendor/minecraft-msa-auth/` 与根 `Cargo.toml` 的 `[patch.crates-io]` 覆盖。

启动器和 SDK 保留 `native-tls`，Windows 使用 schannel。上游同步保留了这一 TLS 选择。

启动器已实现设备代码登录、账户刷新与凭据清理。认证与游戏的实际验收结果见 [验证记录](../docs/VERIFICATION.md)。

## 升级回归

SDK 工作区执行 `cargo test --workspace --all-targets --locked`。启动器执行全目标编译、Clippy、测试与前端检查，并保留加载器身份、路径和下载取消回归。

已有隔离 loader 缓存可通过以下工具检查扫描与加载兼容性；工具读取之前的验收版本，不查询或下载新版本，并核对 JSON / natives 状态保持一致：

```powershell
cargo run -p paradox-core --example verify_sdk_upgrade --locked -- '<绝对 .test-data 缓存目录>'
```

追加 `--launch-neoforge` 可使用缓存 Java 21 和离线身份启动已有 NeoForge 实例，等待纹理 / 声音就绪后受控停止。报告写入 `.test-data/2026-11-07-quintelement-upstream/`，不覆盖原缓存报告；受控停止和缓存复用不代表自然退出、全新安装或正版在线身份验收。
