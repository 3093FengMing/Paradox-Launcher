# SDK 与依赖源码

## QuintElement 子模块

`QuintElement/` 是 [3093FengMing/QuintElement](https://github.com/3093FengMing/QuintElement) 的 Git submodule，保留独立 Cargo workspace 和 AGPL-3.0-only 许可。启动器通过 `vendor/QuintElement/crates/elemental` path 依赖直接编译，根 workspace 显式排除该目录。

初始化使用 `git submodule update --init --recursive`。核心开发在子模块的功能分支中进行，先向 fork 推送提交，再在启动器提交新 gitlink。启动器构建读取子模块中的源码，仓库记录的 gitlink 固定实际 SDK 提交。

## minecraft-msa-auth 兼容补丁

`minecraft-msa-auth/` 来自 crates.io 的 `minecraft-msa-auth 0.5.0`，保留 MIT / Apache-2.0 原始许可与作者信息。

QuintElement fork 的
`core/src/auth/authorizers/microsoft.rs` 使用 `oauth2::reqwest::Client`（reqwest 0.12），
但 `minecraft-msa-auth 0.5.0` 为 reqwest 0.13 的 Client 实现 `HttpClient`。
这会产生 E0599 / E0282，阻止认证适配器编译。

当前补丁仅将 helper 的 reqwest 依赖与示例依赖改为 0.12.28，并将示例 TLS feature
改为 `rustls-tls`。`src/lib.rs` 保持原样。原始 manifest 保存在 `Cargo.toml.orig`。
QuintElement 自己的 reqwest 0.13 依赖保持原样。2026-10-31 接入时已检查 fork，认证模块仍传入 oauth2 的 reqwest 0.12 client，因此此补丁继续生效。

在 fork 中修复认证客户端类型或升级 SDK 后，先移除根 Cargo.toml 中 `[patch.crates-io]` 的覆盖并重新执行
`cargo check --workspace --all-targets`。上游修复认证客户端类型后应删除此补丁目录。
启动器已实现设备代码登录、账户刷新与凭据清理。成功编译本身不证明真实账户、正版游戏身份或完整原生交互已经验收，这些项目需要独立验证。
