# Elemental 接入说明

## 本次核对的来源

- 上游仓库：https://github.com/ElectronicWave/Elemental
- 固定提交：`26673f4878882eeb94d4341bdc3dae910d3e57b7`
- facade package：`elemental-kit 0.2.0`，本项目重命名依赖为 `elemental`。
- DeepWiki：https://deepwiki.com/ElectronicWave/Elemental，本次请求返回 HTTP 429。
- README 最小示例仍写 `version = "0.1"`，本项目以当前 Cargo.toml 与源码为准。

## 已使用的接口

| 产品操作     | SDK 接口                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| 游戏根目录   | `Launcher::builder().storage_root(path).build()`                                |
| 原版目录     | `catalog(VanillaCatalog::with_defaults())`                                      |
| 本地扫描     | `inspect_instances()` / `inspect_instance(key)`                                 |
| 安装 / 修复  | `prepare_instance(PrepareInstanceRequest { DriverSpec::Vanilla(VanillaSpec) })` |
| 读取已有安装 | `load_instance(instance)`                                                       |
| 构建启动命令 | `build_launch_command(prepared, OfflineAuthorizer, LaunchOptions)`              |
| 日志进程     | `core::launcher::process::spawn_command_logged(command)`                        |
| 参数解析     | `try_set_extra_jvm_argument_string` / `try_set_extra_game_argument_string`      |

`LaunchOptions` 是 `VersionJsonLaunchConfig` 的别名，可设置 Java、分辨率、launcher 信息与参数。
兼容的本地 Java 由 SDK 查找；当前不会自动下载安装 Java。

`BaseRootLayout` 将实例放在 `versions/` 下，assets 与 libraries 为共享资源。
不要直接假设每个实例是一个完整独立 `.minecraft`；显示名称不作为文件夹名称。

## 编译适配

1. **reqwest 类型冲突**：SDK 认证模块混用了 oauth2 的 reqwest 0.12 client 与 helper 的
   reqwest 0.13 HttpClient。通过 vendor 中的 helper 依赖版本兼容补丁解决，源码未修改。
2. **non-Send future**：部分 inspect / launch future 持有无 Sync 约束的 driver 引用。
   在宿主工作线程内部创建与 poll，避免直接跨 Tauri executor 移动 future。

后续 SDK 升级优先解决这两点；不修改用户全局 Cargo 缓存，也不修改上游 checkout。

## 后续接口验证

Fabric / Quilt 的 LoaderSpec、installer 家族的 Forge / NeoForge、下载报告 / 取消 API、
MicrosoftAuthorizer / token 生命周期需要各自独立评估和端到端验证。
上游支持矩阵属于 SDK 能力声明，不自动等同于本启动器 UI 的已支持功能或稳定性范围。
