# 开发约定

先阅读 README、docs/ARCHITECTURE.md 与 ROADMAP.md。以可验收的功能为单位提交，说明最终行为、验证结果和未覆盖的边界。

## 模块职责

- 页面组件组合界面与交互，复用组件负责展示与可访问性，不直接调用 Minecraft SDK。
- Hook 管理状态、异步操作与生命周期；配置更新使用当前状态，避免过期闭包覆盖其他修改。副作用订阅必须清理，异步失败必须有明确处理。
- `ui/src/api.ts` 统一桌面 IPC 与浏览器预览适配，领域类型集中定义；页面不依赖 Tauri 实现细节。
- Rust core 负责领域校验、存储、SDK 适配与可复用服务；Tauri 命令负责边界参数、任务调度与事件。
- 网络、安装和长时间文件操作在后台执行，不阻塞 UI 线程。任务完成、失败和取消使用明确状态，不提供伪进度与伪成功。

## 命名与格式

- React 组件使用 `PascalCase`；Hook 使用 `use` 前缀；函数和变量使用 `camelCase`，Rust 使用 `snake_case`。
- Props 与跨模块数据使用具名类型；类型导入使用 `import type`。避免 `any`、宽泛类型断言和重复的领域模型。
- Prettier 统一 TypeScript、TSX、CSS、JSON、YAML 与 Markdown；Rust 使用 rustfmt。采用 UTF-8、LF 和文件末尾一个换行。
- 将较长的 TSX、分支和异步流程展开成可读代码。抽取组件或函数时保持明确职责，避免仅为缩短文件添加抽象。
- 上游 `vendor/`、锁文件与生成资产不参与格式化，不在格式提交中修改其内容。

## 数据与错误处理

- 文件路径与配置以 Rust 校验为准；前端校验用于快速反馈。保存必须先校验再原子替换，不覆盖损坏或未知版本的数据。
- Config schema 的不兼容修改必须提升版本并提供迁移；新增字段应明确默认值与兼容行为。
- 所有 Promise 都要等待或明确处理拒绝。UI 统一展示用户可读错误，日志保留诊断上下文，不能吞掉安装或配置失败。
- 取消必须终止实际工作，并保留可恢复的数据；不能只改变按钮或通知状态。
- SDK 更新须固定提交，检查补丁是否可以移除，并执行对应游戏兼容验证。
- 登录 token 不进入 JSON 配置、日志或 Git；未来使用 OS 凭据库。

## 提交前检查

```powershell
npm run format
cargo fmt --all
npm run format:check
npm run lint:ui
npm run build:ui
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
```

CI 执行格式、类型相关 ESLint 规则、React Hooks 规则、前端构建及 Rust 检查。对配置替换、路径边界、任务状态和故障恢复编写必要测试，网络游戏集成测试独立于离线 CI。
