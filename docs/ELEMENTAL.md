# Elemental 接入说明

## 来源与固定版本

- 上游：[ElectronicWave/Elemental](https://github.com/ElectronicWave/Elemental)。
- 固定提交：`26673f4878882eeb94d4341bdc3dae910d3e57b7`。
- facade package：`elemental-kit 0.2.0`，本项目将依赖重命名为 `elemental`。
- [DeepWiki](https://deepwiki.com/ElectronicWave/Elemental) 此前请求返回 HTTP 429；接口以固定提交源码为准。
- 上游 README 最小示例仍写 `version = "0.1"`，本项目使用 Cargo manifest 中的实际提交与特性。

## 当前接口与职责

| 产品操作     | SDK 接口 / 应用实现                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| 游戏根目录   | `Launcher::builder().storage_root(path).build()`；安装使用 `Storage::new(root, BaseRootLayout)`       |
| 版本目录     | `VanillaSource::with_client(endpoints, client)` → `VanillaCatalog::new(source)` → `Launcher::catalog` |
| 目录缓存     | 应用 `CatalogCache`；桌面命令控制 TTL、手动刷新、网络错误分类与缓存回退                               |
| 本地扫描     | `inspect_instances()` / `inspect_instance(key)`，映射为应用 `InstalledInstance`                       |
| 安装元数据   | 优先 `ResolvedVanillaVersion::load`；缺失或无效时 `resolve_vanilla_metadata` 并 `persist`             |
| 资源计划     | `ResolvedVanillaVersion::planner().plan()`，SDK 的任务映射为应用 `Artifact`                           |
| 资源下载     | 应用 `DownloadEngine` 负责并发、重试、取消、字节进度、校验与完整文件复用                              |
| 安装收尾     | 资源下载校验后 `ResolvedVanillaVersion::prepare(launcher.downloader())` 解压 natives 并验证实例       |
| 读取已有安装 | `Launcher::load_instance(instance)`；启动不隐式执行下载                                               |
| Java 选择    | 应用 `java::required_java_major_version`、`inspect`、`discover`、`select_runtime`                     |
| 构建启动命令 | `build_launch_command(prepared, OfflineAuthorizer, LaunchOptions)`                                    |
| 原生库兼容   | 应用 `include_extracted_natives` 调整命令的 `-Djava.library.path` 搜索列表                            |
| 日志进程     | `core::launcher::process::spawn_command_logged(command)`，宿主监督运行和停止                          |
| 参数解析     | `try_set_extra_jvm_argument_string` / `try_set_extra_game_argument_string`                            |

`LaunchOptions` 是 `VersionJsonLaunchConfig` 的别名，设置已选 Java 的 `runtime_executable_path`、分辨率、launcher 信息与附加参数。内存由应用设置产生 `-Xms` / `-Xmx`，额外 JVM 参数中的同类选项被拒绝，避免冲突。

`BaseRootLayout` 将实例放在 `versions/<instance_key>/`，assets 与 libraries 位于完整游戏根目录下并共享。显示名称不作为目录名称。导入实例引用原完整根目录，由应用合并全局与每实例设置后创建服务，不将单个 version 目录当成完整 `.minecraft`。

## 网络与下载边界

版本目录和安装元数据通过 `VanillaSource::with_client` 注入应用的网络客户端与 `VanillaEndpoints`。客户端采用用户设置的 HTTP / HTTPS 代理、连接 / 读取超时；元数据请求另加整体超时。Mojang 兼容镜像映射版本清单、游戏元数据、assets 和 maven 路径。

安装使用 SDK planner 计算资源清单，应用下载引擎执行传输。对 SDK 元数据中的相对资源路径和目标的已有父目录进行验证，拒绝目录跳转、非法路径及通过链接跳出游戏根目录的目标。下载先写临时文件，完成后检查预期大小与 SHA-1 / SHA-256 并提交；失败和取消时等待工作线程释放文件。已完成文件通过校验后复用，重复安装完整实例不重新传输资源。

下载任务队列位于桌面宿主，任务串行、任务内文件并发；当前会话记录取消 / 完成 / 失败状态。重启后通过安装 / 修复复用完整文件，队列历史不跨会话保存。SDK 解析、资源计划和解压阶段与资源传输阶段分别报告，不将阶段提示当作字节百分比。

## Java 管理

应用负责实际 Java 探测和选择，复用 SDK 的运行时位置 provider 作为候选来源，并补充已配置路径、管理目录、JAVA_HOME / JDK_HOME、PATH 与常见目录。候选可执行文件通过实际 Java 进程检查版本、主版本、vendor 与架构；扫描限时并将部分失败返回为警告。

启动从已安装实例 JSON 读取 `javaVersion.majorVersion`，旧元数据缺失时默认 Java 8。显式路径必须匹配该主版本与当前平台架构；自动选择也遵守相同条件，不因为版本更高就视为兼容。

可选运行时下载由应用查询 Adoptium API 的最新 HotSpot JRE，当前支持 Windows x64 / ARM64。下载通过共用 `DownloadEngine` 校验 SHA-256，解压时验证归档路径，再执行实际版本检查；确认主版本后提交到配置目录旁的 `runtimes/`，架构在启动选择时严格校验。此流程未使用 SDK 的 Java 自动下载功能。

## 固定 SDK 的兼容处理

1. **认证 reqwest 类型冲突**：SDK 认证模块使用 oauth2 的 reqwest 0.12 client，helper 使用 reqwest 0.13 的 HttpClient。通过 [vendor/README.md](../vendor/README.md) 所述的最小 helper 依赖补丁解决，helper 源码保持原样；不代表 Microsoft 登录已验证。
2. **non-Send future**：部分 inspect / launch future 持有无 Sync 约束的 driver 引用。宿主在后台工作线程内部创建并驱动 future，通过 Tokio 多线程 runtime 运行，避免将非 Send future 直接交给 Tauri executor。
3. **26.3 原生库目录差异**：新 Mojang 元数据将 Java 库搜索路径指向 `natives/java`，固定 SDK 将 JNI 库解压到 `natives/`。应用保留 SDK 生成的原搜索路径，并使用平台路径分隔符追加实际解压目录；重复调用不重复追加，不改写已保存元数据或用户全局 Cargo 缓存。补丁后的实际运行验收见 [验证记录](VERIFICATION.md)。

SDK 升级时审阅这三处边界；上游修复后先移除相应覆盖或应用兼容处理，再执行编译和原版运行矩阵。固定提交的上游 checkout 保持不变。

## 后续接口

Fabric / Quilt LoaderSpec、Forge / NeoForge installer 家族、MicrosoftAuthorizer 与令牌生命周期仍需独立接入和端到端验证。上游支持矩阵是 SDK 的能力声明，不自动等同于本启动器已开放功能或实际兼容范围。
