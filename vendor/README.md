# 依赖兼容补丁

`minecraft-msa-auth/` 来自 crates.io 的 `minecraft-msa-auth 0.5.0`，保留 MIT / Apache-2.0 原始许可与作者信息。

Elemental 提交 `26673f4878882eeb94d4341bdc3dae910d3e57b7` 的
`core/src/auth/authorizers/microsoft.rs` 使用 `oauth2::reqwest::Client`（reqwest 0.12），
但 `minecraft-msa-auth 0.5.0` 为 reqwest 0.13 的 Client 实现 `HttpClient`。
这会产生 E0599 / E0282，即使启动器尚未开放 Microsoft 登录也无法编译。

当前补丁仅将 helper 的 reqwest 依赖与示例依赖改为 0.12.28，并将示例 TLS feature
改为 `rustls-tls`。`src/lib.rs` 保持原样。原始 manifest 保存在 `Cargo.toml.orig`。
Elemental 自己的 reqwest 0.13 依赖保持原样。

升级 SDK 时先移除根 Cargo.toml 中 `[patch.crates-io]` 的覆盖并重新执行
`cargo check --workspace --all-targets`。上游修复认证客户端类型后应删除此补丁目录。
通过编译不代表已验证完整 Microsoft 登录流程；账户认证仍是 v0.3 的工作。
