# Zaw 逐步推进计划

> 状态约定：所有事项初始为 [ ]。完成一个里程碑前，必须满足其“完成条件”；不将未决设计擅自固化到实现中。

## 推进原则

- 先完成能创建 Workspace、连接 Agent Host、发起 Session 的最小纵向闭环，再扩展来源、凭证和桌面能力。
- 每个里程碑只引入完成该闭环所需的最小能力。
- Server 永远不保存 Agent Session 状态、事件、快照或历史。
- Session 能力必须经 AHP 到 Agent Host；控制平面能力必须经普通 HTTP API 或业务 WebSocket。
- 每一阶段都要保持 Browser Workbench 可运行；Electron 在后期作为同一 Workbench 的薄壳接入。
- 所有持久化结构先写迁移和测试，再写业务逻辑。

## 里程碑总览

| 里程碑 | 可演示结果 | 前置条件 |
| --- | --- | --- |
| M0 | Monorepo、MySQL、开发环境和 CI 可启动 | 无 |
| M1 | Server 能管理 Workspace 元数据和 Build | M0 |
| M2 | Provisioner 能用 Git 模板创建本地开发 Workspace | M1 |
| M3 | Agent Host、AHP Gateway 和最小 Agent Session 可工作 | M2 |
| M4 | Browser Workbench 完成 Workspace → Session 主工作流 | M3 |
| M5 | 远程终端和右侧辅助栏可用 | M4 |
| M6 | Template 管理、Tar URL、系统凭证完成 | M2、M4 |
| M7 | Electron 壳与内置浏览器完成 | M4、M5 |
| M8 | 安全、可观测性、恢复和发布准备 | M0–M7 |

## M0：仓库与本地开发基线

### 目标

建立 pnpm + Go Monorepo，并让本地开发者可以一条命令启动最小依赖。

### 工作项

- [ ] 创建根 package.json、pnpm-workspace.yaml、Go module 和统一脚本。
- [ ] 创建 apps/browser、apps/electron、packages/workbench、packages/ui、packages/protocol。
- [ ] 创建 cmd/zaw 和 internal 下的 server、provisioner、agenthost、storage/mysql、template、credential 包骨架。
- [ ] 增加 MySQL 8.0 本地开发容器与连接配置。
- [ ] 建立数据库迁移机制；确定 ID 使用 ULID 或 BINARY(16) UUID。
- [ ] 建立 Go 格式化、静态检查、单元测试与前端 typecheck/lint 脚本。
- [ ] 建立最小 CI：安装依赖、前端检查、Go 测试、迁移校验。
- [ ] 将设计文档入口加入仓库 README。

### 完成条件

- [ ] 新环境执行安装命令后可启动 MySQL。
- [ ] zaw server 可以连接 MySQL 并执行空迁移。
- [ ] Browser 应用可以启动并渲染占位 Workbench。
- [ ] Go 与 pnpm 的检查脚本均在 CI 通过。

## M1：Server 控制平面最小闭环

### 目标

完成不涉及实际资源创建的控制平面：组织、Template、Workspace、Build 与 Provisioner 注册。

### 工作项

- [ ] 定义 MySQL 迁移：organizations、users、memberships、templates、template_sources、template_parameters、workspaces、workspace_builds、provisioners、provisioner_jobs、agent_hosts、credentials、audit_logs。
- [ ] 不创建 agent_sessions、session_events、session_snapshots 或 session_indexes 表。
- [ ] 定义 HTTP 契约并放入 packages/protocol 与 contracts。
- [ ] 实现 Template、Workspace、Workspace Build 的最小 CRUD API。
- [ ] 实现 Workspace desiredState 与 observedState 的状态机校验。
- [ ] 实现 Provisioner 注册、心跳和能力上报。
- [ ] 实现 Provisioner Job 创建与领取的持久化语义。
- [ ] 将认证、授权设计成接口；开发环境可使用明确的开发身份，不将其固化为生产认证。
- [ ] 写入 Build 和管理操作的审计记录。

### 完成条件

- [ ] 可通过 HTTP 创建一个 Template、一个 Workspace 和一个 create Build。
- [ ] Provisioner 能注册，并领取指定 Build。
- [ ] 非法 Workspace 状态转换会被拒绝。
- [ ] Server 重启后可恢复控制平面数据，但不存在任何 Session 数据。

## M2：Provisioner 与 Git Template 的第一个真实 Workspace

### 目标

以最小 Terraform Provider（建议本地 Docker）跑通创建、停止、删除 Workspace 的真实资源闭环。

### 工作项

- [ ] 定义 Provisioner Job 的执行协议和日志上报格式。
- [ ] 实现 Provisioner 工作目录创建、清理与失败保留策略。
- [ ] 支持 Git Template Source：url、ref、directory、可选 credentialId。
- [ ] 创建 Workspace 时解析 ref 为完整 commit SHA，并写入 Workspace Source Snapshot。
- [ ] Provisioner 使用 detached HEAD checkout 固定 commit。
- [ ] 实现 Terraform init、plan、apply、destroy 的执行器与流式日志上报。
- [ ] 配置开发用远程 Terraform State Backend 与锁。
- [ ] 将 Workspace Resource 摘要回传并写入 MySQL。
- [ ] 编写一个公开 Git 的最小 Docker Workspace 模板。
- [ ] 实现 create、stop、delete Build 的端到端测试。

### 完成条件

- [ ] 创建 Workspace 会由 Provisioner 拉取固定 Git commit 并创建真实容器或等价资源。
- [ ] stop 与 delete 均能通过相同 Source Snapshot 安全执行。
- [ ] 模板当前分支发生变化后，已有 Workspace 仍使用原 commit。
- [ ] Terraform 日志能由 Server 查询或订阅。

## M3：Agent Host、AHP Gateway 与最小 Session

### 目标

让已创建 Workspace 内的 Agent Host 主动连接 Server，并让一个客户端经 Server 使用 AHP 与 Agent 通讯。

### 工作项

- [ ] 在模板中声明并部署 zaw agent-host。
- [ ] 设计 Agent Host 首次注册的工作负载身份与短期凭据流程。
- [ ] 实现 Agent Host 反向连接、Workspace 绑定、心跳和 HTTP 遥测。
- [ ] 实现 Server 进程内的 Agent Host 在线注册表。
- [ ] 实现 Server AHP Gateway：认证、Workspace 授权、路由和透明转发。
- [ ] 确保 Gateway 不修改 AHP sequence、origin 或 envelope 内容。
- [ ] 确保 Gateway 不将任何 Session 内容写入 MySQL、缓存或日志。
- [ ] 接入一个最小 ACP Agent Adapter，支持创建 Session、发送消息、接收流式输出。
- [ ] 实现 Host 离线、重连、客户端重新附着的明确错误和行为。
- [ ] 写入跨进程端到端测试。

### 完成条件

- [ ] Agent Host 在 Workspace 内可反向注册到 Server。
- [ ] 客户端可通过 Server 创建/附着 Session 并收取 Agent 流式响应。
- [ ] Server 重启后，Session 仍由 Agent Host 保有；客户端重连后可重新附着。
- [ ] MySQL 中不存在 Session 数据。

## M4：Browser Workbench 主工作流

### 目标

完成用户每天使用的 Browser Workbench 主界面，先覆盖 Workspace → Session → Agent 对话。

### 工作项

- [ ] 实现固定应用壳；不引入传统页面路由或页面跳转。
- [ ] 实现左侧 Workspace → Session 树；移除 Chats 概念。
- [ ] 实现 Workspace 在线绿点与离线红点。
- [ ] 实现 New Session：当前 Workspace 直接创建；无选中 Workspace 时弹出 Quick Pick。
- [ ] 实现 Session Canvas 与 AHP Session Client。
- [ ] 实现流式消息、工具调用卡片、审批卡片和明确错误呈现。
- [ ] 实现 Header：Workspace、Git 变更摘要、CPU、内存。
- [ ] 实现右侧栏壳与 Changes、Files 标签。
- [ ] 实现 Settings Surface、Quick Pick、Sheet、Dialog 以及 Esc 层级关闭。
- [ ] 加入组件、状态管理和 AHP 连接恢复的前端测试。

### 完成条件

- [ ] 用户可在 Browser 中选择在线 Workspace、创建 Session、发消息并看到流式响应。
- [ ] 同一 Workspace 下可以看到并切换多个 Session。
- [ ] Workspace 离线时能浏览 Session，但输入和终端创建被明确禁用。
- [ ] 全程不发生传统页面跳转。

## M5：终端与辅助信息

### 目标

完成 Workspace 远程终端和当前 Session 的文件辅助视图。

### 工作项

- [ ] 在 Agent Host 实现经 AHP 创建、输入、输出、resize、关闭终端的能力。
- [ ] 在 Workbench 集成终端渲染组件。
- [ ] 实现底部 Panel Host，第一期只注册 Terminal。
- [ ] 实现底部面板可拖拽、折叠、关闭；关闭不销毁终端。
- [ ] 在底部右侧实现固定宽度、垂直排列的 Agent Host 终端列表。
- [ ] 让 Terminal 归属 Workspace，并能被该 Workspace 的多个 Session 复用。
- [ ] 实现 Changes：当前 Session 修改文件和 diff 摘要。
- [ ] 实现 Files：Workspace 文件树与预览入口。
- [ ] 为未来 output、tasks、ports、logs、debug 设计 Panel Contribution 接口，但不展示空标签。

### 完成条件

- [ ] Browser 中可创建多个远程终端，并从右侧垂直列表切换。
- [ ] 终端与 Session 无关但受 Workspace 在线状态约束。
- [ ] 右侧 Changes 和 Files 能展示 Agent/Workspace 相关信息。
- [ ] Electron 与 Browser 都使用同一远程终端协议。

## M6：Template 来源、系统 Credential 与设置管理

### 目标

完成管理员可自助配置 Template 的能力，同时保持 Workspace 可复现。

### 工作项

- [ ] 在 Settings Surface 实现 Templates 列表和 Add Template。
- [ ] Add Template 使用 Quick Pick 选择 Git 或 Tar URL，再用 Sheet 编辑。
- [ ] 实现 Git Template 校验：URL、ref、directory、固定 commit 解析。
- [ ] 实现 Tar URL：下载、可选 sha256、自动计算摘要、格式识别和安全解包。
- [ ] 为 Tar URL 实施大小、压缩比、重定向、路径逃逸和 SSRF 防护。
- [ ] 实现系统 Credential 管理界面和 API。
- [ ] 支持 username_password、token、ssh_key 三种 Credential 形态。
- [ ] 将敏感内容保存到 Secret Manager；业务模型只保存 metadata。
- [ ] 实现 Credential Lease；Provisioner 仅在授权 Build 中得到短期凭据。
- [ ] 支持使用系统 Credential 拉取私有 Git 和私有 Tar URL。
- [ ] 实现“按当前模板重建/更新”，但不增加 Template Version UI。

### 完成条件

- [ ] 管理员无需页面跳转即可添加 Git 或 Tar Template。
- [ ] 未填写 Tar SHA 时，系统计算并固定摘要；后续内容变化会失败。
- [ ] 私有 Git 模板可通过系统 Credential 拉取，Token 不出现在 URL、日志或 State 中。
- [ ] 已有 Workspace 不会因 Template 更新而自动改变。

## M7：Electron 壳与内置浏览器

### 目标

将同一 Workbench 打包为桌面应用，并添加 Electron 专属内置浏览器。

### 工作项

- [ ] 建立 Electron main、preload 和 renderer 入口。
- [ ] Renderer 直接复用 packages/workbench 并连接同一 Server。
- [ ] 定义最小、安全的 preload API；禁止向 Renderer 暴露任意本地文件系统和 Shell。
- [ ] 实现 Electron 标题栏、窗口生命周期与应用更新基础设施。
- [ ] 在右侧辅助栏增加 Electron 专属 Browser 标签。
- [ ] 内置 Browser 仅用于预览 Workspace 暴露的服务或页面。
- [ ] 处理导航白名单、弹窗、下载、权限和外部链接安全策略。
- [ ] 增加 Browser 与 Electron 的共享 UI 回归测试。

### 完成条件

- [ ] Electron 与 Browser 显示同一 Workspace → Session → Terminal 工作流。
- [ ] Electron 不运行本机 Workspace Shell。
- [ ] 只有 Electron 显示 Browser 辅助栏标签。
- [ ] 内置 Browser 不可绕过导航和权限策略。

## M8：生产准备

### 目标

补齐安全、可观测性、恢复、容量和发布能力。

### 工作项

- [ ] 确定正式认证、组织权限和 Workspace 共享模型。
- [ ] 确定 MySQL 备份、恢复、迁移和高可用策略。
- [ ] 确定 Terraform State Backend、锁和加密策略。
- [ ] 确定 Secret Manager 实现和凭证轮换流程。
- [ ] 完善 Server、Provisioner、Agent Host 的结构化日志、指标和链路关联。
- [ ] 增加 Build、Credential Lease、AHP Gateway、终端的审计策略。
- [ ] 压测多 Provisioner、多在线 Host 和 AHP 长连接。
- [ ] 验证 Server 横向扩展时的 Agent Host 路由策略。
- [ ] 演练 Server 重启、Host 断连、Provisioner 失败、Terraform 部分失败与模板来源不可用。
- [ ] 建立发布、回滚、数据库迁移和兼容性检查流程。

### 完成条件

- [ ] 每种关键故障都有可验证的恢复或明确失败行为。
- [ ] 不存在 Session 数据被 Server 写入 MySQL、日志或缓存的路径。
- [ ] 凭证和 Secret 不会出现在 API、前端状态、日志、命令行或 Terraform State。
- [ ] 发布流程可以在不破坏已有 Workspace Source Snapshot 的情况下升级系统。
