# Zaw 交付计划

> 本计划将原 M0–M6 的交付范围拆分为 M0–M26。范围没有缩减：新 M26
> 完成才等价于原 M6 全部完成。每个里程碑只承担一个主要技术目标，必须满足
> 完成条件后才能进入下一阶段。

## 状态约定

- `[ ]` 未开始。
- `[-]` 进行中。
- `[x]` 已完成并通过验收。
- 里程碑状态以本文件及对应测试证据为准，不能仅根据代码文件存在判断完成。

## 最终架构边界

```text
Workbench
├─ HTTP
│  ├─ Workspace、Build、Template 和 Credential 管理
│  └─ 跨 Workspace 的 Session Catalog 与状态查询
│
└─ WebSocket
   └─ 当前唯一 attached Workspace 的实时交互
           │
           ▼
       Zaw Server
       ├─ SessionSummary Read Model
       ├─ Workbench Gateway
       └─ 官方 ahp.Client
               │
          MuxTransport
               │
               ▼
          Agent Host
          ├─ Session / Chat
          ├─ Terminal
          ├─ Changeset / Files
	          └─ Agent SDK
	              └─ GitHub Copilot SDK（首个实现）
```

核心约束：

- 一个 Workbench 窗口可以展示多个 Workspace 的 Session，但同一时刻只
  attach 一个 Workspace。
- 左侧 Session Catalog 通过 HTTP 查询；聊天、终端、Changes 和 Files 使用
  当前 Workspace 的实时 WebSocket。
- Agent Host 是完整 Session 状态的唯一权威。
- Server 只持久化 SessionSummary Read Model，不保存完整 Chat reducer、
  Terminal 输出、Changeset 内容或完整 AHP snapshot/action 历史。
- Agent Host 到 Server 的一条物理连接可以承载多个独立的逻辑 AHP Peer。
- Go 侧 AHP Client 使用官方 SDK；Zaw 只实现官方 SDK 不包含的 Host Server、
  Mux transport 和业务适配。
- 模型由 Server 统一配置和调用。上游 API key 只进入 Secret Store；公开 LLM
  API 使用中立请求/事件模型，不透传任一厂商协议。
- Workbench 不使用 React；界面由 InversifyJS 管理的 class Widget、View、
  Service 和 Part 组合而成。

## 推进规则

1. 每个里程碑必须有独立、可观察的演示结果。
2. 每个里程碑必须包含对应自动化测试，不依赖后续阶段补测试。
3. 当前里程碑未通过，不进入下一里程碑。
4. 协议、数据库和公共接口的变化先更新文档与契约。
5. 不提前展示不可用的空标签、按钮或管理入口。
6. 不使用 Docker 编译项目；Go、Node、Terraform 和 Incus 直接使用本机环境。
7. 源码保持正常换行和可读格式，禁止将实现压缩成超长单行。
8. 每完成一个里程碑，同步记录验证命令、测试和截图证据。

## 里程碑总览

| 里程碑 | 单一目标 | 可演示结果 |
| --- | --- | --- |
| M0 | 架构与协议决策固化 | 文档与最终边界一致 |
| M1 | 本地工具链 | 一组 Task 命令完成开发检查 |
| M2 | Go 应用骨架 | Fx + Chi Server 可启动和关闭 |
| M3 | 数据库基线 | SQLite/MySQL 均可迁移和读写 |
| M4 | 控制平面 API | 可管理 Workspace、Template 和 Build |
| M5 | Terraform Runner | 本机 Terraform 可执行完整工作流 |
| M6 | Zaw Terraform Provider | Provider schema 和资源生命周期可测试 |
| M7 | Incus Ubuntu 24 Template | VM 可创建、停止、启动和删除 |
| M8 | Agent Host 生命周期 | Host 可用固定作用域凭证安全注册并重连 |
| M9 | Server LLM Gateway 与 Agent SDK | 三家模型经中立流式 API 驱动 Copilot Agent |
| M10 | 官方 AHP SDK 与协议升级 | SDK、类型和协议副本版本一致 |
| M11 | 单逻辑 AHP 连接 | 官方 Client 与 Host 完成完整会话流 |
| M12 | AHP 多路复用 | 多个逻辑 Peer 在一条 Host 连接上隔离运行 |
| M13 | Session Catalog | HTTP 可查询跨 Workspace Session 状态 |
| M14 | Workbench 工程骨架 | 无 React 的 Part/View/Widget 壳可运行 |
| M15 | 多 Workspace Catalog | 左栏分组展示且仅一个 Workspace attached |
| M16 | Chat 主流程 | 可选择 Session、发消息并处理审批 |
| M17 | Terminal | Bottom Panel 可管理远程终端 |
| M18 | Changes 与 Files | Secondary Sidebar 可查看 diff 和文件 |
| M19 | Widget 与主题系统 | 控件统一并支持颜色主题 |
| M20 | 浮动窗口基础设施 | Workbench 内可打开可调整的浮动窗口 |
| M21 | Management Surface | 设置搜索、分类和内部导航可用 |
| M22 | Template 管理窗口 | 可在浮动窗口管理 Git/Tar Template |
| M23 | Credential 管理窗口 | 可安全管理系统 Credential |
| M24 | 运行资源管理窗口 | 可管理 Workspace、Host 和 Provisioner |
| M25 | 响应式与视觉对齐 | Desktop/Mobile 接近 VS Code Agents |
| M26 | 总体集成验收 | 原 M0–M6 范围全部通过验证 |

## M0：架构与协议决策固化

### 目标

先修订旧设计，确保实现不会继续依赖已经废弃的透明 Gateway 和单体
Workbench 模型。

### 工作项

- [x] 更新 Workbench、Runtime、Domain、Implementation 等架构文档。
- [x] 删除“Server 永远不保存任何 Session 数据”的绝对描述，改为仅持久化
  SessionSummary Read Model。
- [x] 删除“Server AHP Gateway 完全透明转发”的旧约束。
- [x] 固化 HTTP Catalog、单 attached Workspace 和实时 WebSocket 的边界。
- [x] 固化 Agent Host 物理连接与 Logical Peer 的 Mux 模型。
- [x] 固化官方 AHP Go SDK 的使用边界。
- [x] 更新旧 M0–M6 与新 M0–M26 的映射说明。

### 完成条件

- [x] 架构文档之间不存在互相冲突的 Session 状态所有权描述。
- [x] 所有后续里程碑都有明确依赖和验收边界。

## M1：本地工具链

### 目标

建立不依赖 Docker 编译的统一开发入口。

### 工作项

- [x] 使用 Taskfile 作为唯一任务入口，不保留 Makefile 工作流。
- [x] 提供 `task fmt`、`task lint`、`task test`、`task build`。
- [x] 提供 `task check-protocols` 和后续 `task test-e2e`、
  `task screenshots` 入口。
- [x] 完善 `.gitignore`、`.env.example` 和本机依赖说明。
- [x] CI 使用与本机一致的 Task 命令。
- [x] 增加源码长行和格式检查。

### 完成条件

- [x] 新环境安装 Go、Node、pnpm 和 Terraform 后可执行基础任务。
- [x] Go 与前端的格式、类型检查和测试均可由 Task 启动。

## M2：Go 应用骨架

### 目标

完成清晰的 DDD 分层和应用装配。

### 工作项

- [x] 整理 `bootstrap`、`domain`、`usecase`、`infra`、`interfaces`。
- [x] `interfaces` 只存放 HTTP 等交付适配器。
- [x] Agent Host、Agent SDK 和 Provisioner 保持独立领域边界，不塞入
  `interfaces`。
- [x] Fx application 和 module 组装放在 `bootstrap`。
- [x] 使用 Chi 注册 HTTP 路由和 middleware。
- [x] 实现结构化启动、健康检查和优雅关闭。
- [x] 为 Fx graph 和 Server lifecycle 编写测试。

### 完成条件

- [x] Server 可由 Fx 启动并完成优雅关闭。
- [x] 目录依赖方向符合 Domain → Usecase → Adapter 的约束。

## M3：数据库基线

### 目标

建立 SQLite 和 MySQL 一致的 Gorm 持久化能力。

### 工作项

- [x] 通过环境变量和 `.env` 选择 SQLite 或 MySQL。
- [x] 使用 Gorm 定义模型与 Repository Adapter。
- [x] 模型不包含 `gorm.DeletedAt`，不启用软删除。
- [x] 建立显式 migration 和 migration test。
- [x] 验证时间、JSON、唯一索引和事务在两种数据库上的行为。
- [x] 增加 migrate-only 启动模式。

### 完成条件

- [x] SQLite 和 MySQL 的 migration 与 Repository 测试全部通过。
- [x] 数据库 schema 中不存在非预期的 `deleted_at`。

## M4：控制平面模型与 API

### 目标

实现尚不涉及真实资源创建的控制平面。

### 工作项

- [x] 实现 Workspace、Template、Template Source、Build 和 Provisioner Job。
- [x] 实现 Agent Host registration metadata 和 Credential metadata。
- [x] 定义 Workspace `desiredState`、`observedState`、`agentHostState`。
- [x] 使用 Chi 实现 CRUD、状态转换和错误响应。
- [x] 实现 Provisioner 注册、心跳、领取 Job 和日志上报。
- [x] 为管理操作写入审计记录。

### 完成条件

- [x] 可通过 HTTP 创建 Template、Workspace 和 Build。
- [x] Provisioner 可领取 Job。
- [x] 非法 Workspace 状态转换被拒绝。

## M5：Terraform Runner

### 目标

使用本机 Terraform CLI 完成可靠的执行能力。

### 工作项

- [x] 实现 `terraform init`、`plan`、`apply`、`destroy` Runner。
- [x] 支持 context cancellation、timeout 和进程组终止。
- [x] 流式上报 stdout/stderr，同时避免 secret 泄露。
- [x] 管理独立工作目录、插件缓存和失败保留策略。
- [x] 实现 State Backend 与锁配置。
- [x] 为成功、失败、取消和部分 apply 编写测试。

### 完成条件

- [x] 本机 Terraform 可通过 Runner 完成一个最小资源闭环。
- [x] Build 日志可查询且不包含敏感信息。

## M6：Zaw Terraform Provider

### 目标

实现可被 Template 使用的 Zaw Provider。

### 工作项

- [x] 定义 Provider 配置、Workspace 和 Agent 注入相关资源/数据源。
- [x] 参考 Coder Provider 的 Agent metadata 和启动状态设计。
- [x] 注入 Workspace ID、Server 地址、Agent Host 地址和启动配置。
- [x] 明确 create、start、stop、rebuild、delete 的状态映射。
- [x] 使用 Terraform Provider SDK 编写 schema 和 lifecycle tests。

### 完成条件

- [x] Provider 可由 Terraform CLI 本机加载。
- [x] Provider 资源的 plan/apply/read/delete 测试通过。

## M7：Incus Ubuntu 24 Template

### 目标

完成一个可实际调度 Ubuntu 24 VM 的 Workspace Template。

### 工作项

- [x] 使用本机 Incus Provider/CLI 创建 Ubuntu 24 VM。
- [x] 注入 Agent Host binary、配置和受保护注册凭证。
- [x] 实现 create、start、stop、rebuild 和 delete。
- [x] `stop` 只停止 VM，不从 Terraform State 移除资源。
- [x] 固定 Template Source Snapshot 和 Terraform State。
- [x] 记录本机实机验证步骤。

### 完成条件

- [x] VM 可创建、停止并再次启动。
- [x] stop plan 不包含 destroy。
- [x] delete 才销毁 VM。

## M8：Agent Host 生命周期

### 目标

让 Workspace 中的 Agent Host 安全、持续地连接 Server。

### 工作项

- [x] 实现单个 Workspace 作用域的固定注册凭证。
- [x] Agent Host 主动建立反向连接。
- [x] 实现心跳和 HTTP 遥测，不增加 session token 轮换协议。
- [x] Server 维护在线 Host registry。
- [x] 处理重复注册、Server 重启、Host 重连和 Workspace stop。
- [x] 不在日志中输出 token 或完整协议负载。

### 完成条件

- [x] Host 可注册并被控制平面标记为在线。
- [x] Server 重启后 Host 可复用受保护注册凭证自动重连。

## M9：Server LLM Gateway 与 Agent SDK

### 目标

由 Server 统一管理用户提供的模型连接，并让 Agent Host 通过首个 Agent SDK
适配器驱动真实 Agent。M9 分为 M9a、M9b 两个串行子门禁。

### 工作项

- [x] M9a：增加 OpenAI、Anthropic、DeepSeek Provider 与 Model 配置。
- [x] M9a：API base 与 API key 均由用户填写；key 只存 Secret Store。
- [x] M9a：定义厂商中立 `GenerateRequest`、`GenerateResponse` 与 SSE Event。
- [x] M9a：支持推理、多模态输入、工具调用、结构化输出和流式响应。
- [x] M9a：三家 Adapter 显式双向转换，不透传请求或响应。
- [x] M9b：定义 `agentsdk.Runtime`、Session、Event 和 Permission 边界。
- [x] M9b：使用官方 `github.com/github/copilot-sdk/go` 实现首个 Adapter。
- [x] M9b：Copilot 只持有 Workspace 注册凭证，经 Server Responses 边缘适配器
  调用中立 LLM 服务，不取得上游 API key。
- [x] M9b：映射文本、推理、工具调用、审批、取消和错误事件。
- [x] 编写三家 Provider、统一 SSE、Responses 边缘适配和 fake Agent SDK 测试。

### 完成条件

- [x] Provider 元数据与 Workspace 模型选择可持久化，API key 不进入数据库或响应。
- [x] 三家 Provider 的文本、推理、工具与流式事件转换测试通过；不支持的
  多模态能力被明确拒绝而不是静默丢弃。
- [x] Copilot SDK 使用 Server 模型网关创建 Agent Session 并收到流式响应。
- [x] 审批、工具、取消和错误均有结构化事件。

## M10：官方 AHP SDK 与协议升级

### 目标

停止手写 Go AHP Client，并使 SDK、协议副本和实现版本一致。

### 工作项

- [x] 固定 `github.com/microsoft/agent-host-protocol/clients/go v0.6.0`。
- [x] 将 vendored AHP 文档和 schema 更新到相同发布提交。
- [x] 更新 `sources.lock` 和 protocol check。
- [x] 使用 `ahptypes` 替换手写 Go wire struct、错误码和版本常量。
- [x] 使用 `ahp.Client` 处理 request、subscription、reconnect 和事件分发。
- [x] 明确官方 SDK 不包含 Host Server runtime，保留 Zaw Host handler。
- [x] Workbench TS 类型从同一份 pinned schema 生成或维护契约测试。

### 完成条件

- [x] SDK 支持版本与 Agent Host 协商版本一致。
- [x] Go Client 侧不存在重复的 JSON-RPC pending/subscription 实现。
- [x] `task check-protocols` 通过。

## M11：单逻辑 AHP 连接

### 目标

在加入 Mux 前先验证一个独立逻辑 Peer 的完整协议闭环。

### 工作项

- [x] Agent Host 使用官方类型处理 initialize 和 root subscription。
- [x] 实现 Session、Chat、Terminal、Changeset 的最小标准 snapshot/action。
- [x] 官方 `ahp.Client` 完成 initialize、listSessions 和 subscribe。
- [x] Agent SDK event 映射到标准 Chat/Session action。
- [x] 实现 reconnect 和 snapshot 恢复测试。

### 完成条件

- [x] 官方 Client 可以创建 Session、发送输入并收到流式 action。
- [x] 断线后可通过 reconnect 或新 snapshot 恢复。

## M12：AHP 多路复用

### 目标

让一条 Agent Host 物理连接承载多个彼此隔离的 Logical Peer。

### 工作项

- [x] 定义并固定 Mux frame schema：open、opened、data、close。
- [x] 实现满足 `ahp.Transport` 的 `MuxTransport`。
- [x] Agent Host 为每个 stream 保存独立 clientId、subscription 和 claim。
- [x] Server 只维护 stream routing、授权和有界发送队列。
- [x] 实现单 stream backpressure 和最大连接限制。
- [x] Agent Host 断开时关闭其全部 logical stream。

### 完成条件

- [x] 两个客户端使用相同 JSON-RPC ID 也不会串流。
- [x] 一个客户端 unsubscribe/close 不影响另一个。
- [x] 慢客户端不会阻塞其他 stream。

## M13：Session Catalog

### 目标

通过 HTTP 提供跨 Workspace 的轻量 Session 状态。

### 工作项

- [x] 为每个在线 Host 创建只读 `server-catalog` Logical Peer。
- [x] 使用官方 Client 调用 listSessions 并订阅 root summary 事件。
- [x] 使用 Gorm 持久化 SessionSummary Read Model。
- [x] 实现分页、cursor、`updated_after` 和 ETag。
- [x] 返回 observedAt、stale 和 Agent Host 在线状态。
- [x] Host 重连后重新 listSessions 并校正摘要。

### 完成条件

- [x] HTTP 可查询所有 Workspace 的 Session 摘要。
- [x] Host 离线时保留 last-known 状态并明确标记 stale。
- [x] 数据库不包含完整聊天、终端或 Changeset 状态。

## M14：Workbench 工程骨架

### 目标

建立无 React、可组合且可测试的 Workbench 框架。

### 工作项

- [x] 移除 React 入口和 React 依赖。
- [x] 使用 InversifyJS 注册接口、Service、View 和 Part。
- [x] 建立 `bootstrap`、`services`、`providers`、`parts`、`views`、
  `widgets` 和 `styles`。
- [x] 所有 UI 元素由 class Widget 实现。
- [x] 建立 TitlebarPart、LeftSidebarPart、PrimaryAreaPart、
  BottomPanelPart、SecondarySidebarPart。
- [x] View 只消费 Service，不直接访问 HTTP、WebSocket 或 AHP。

### 完成条件

- [x] Browser 可渲染固定 Workbench 壳。
- [x] Part 可独立测试和销毁。
- [x] 不存在单文件承载整个 Workbench 的实现。

## M15：多 Workspace Catalog 与单 Attachment

### 目标

实现 VS Code Agents 风格的左侧 Session Catalog。

### 工作项

- [x] 左栏通过 HTTP 展示多个 Workspace 及其 Session。
- [x] Session 使用 `{ workspaceId, resource }` 复合身份。
- [x] `IActiveSessionService` 管理唯一选中 Session。
- [x] `IWorkspaceAttachmentService` 最多持有一个实时 Workspace。
- [x] 同 Workspace 切 Session 复用连接；跨 Workspace 切换 attachment。
- [x] 后台状态更新不能改变当前选择。
- [x] 保存每个 Workspace 的 UI 恢复状态。

### 完成条件

- [x] 左栏可分组展示多个 Workspace。
- [x] 中央和辅助区域始终只绑定选中 Session 所属 Workspace。
- [x] 快速切换不会发生旧异步结果覆盖新状态。

## M16：Chat 主流程

### 目标

完成 Session Canvas 的实时 Agent 对话。

### 工作项

- [x] 实现 Session、Chat 和输入区 View/Widget。
- [x] 展示用户消息、Agent 流、工具调用、审批和明确错误。
- [x] 支持 Agent、模型、附件和审批模式选择。
- [x] 支持输入草稿、发送、取消和 reconnect。
- [x] Session Header 展示 Workspace 和必要运行摘要。
- [x] 离线 Workspace 禁用输入但允许浏览 Catalog 信息。

### 完成条件

- [x] 用户可选择 Session、发送消息并看到流式响应。
- [x] 审批和工具调用具有可操作的独立 Widget。

## M17：Terminal

### 目标

完成 Workspace 级远程终端和 Bottom Panel。

### 工作项

- [x] 实现标准 AHP Terminal create/subscribe/input/resize/dispose。
- [x] Terminal 属于 Workspace，可被多个 Session 复用。
- [x] BottomPanelPart 注册 TerminalView，不创建 TerminalPart。
- [x] 支持多个 Terminal 标签/列表、活动终端和重新附着。
- [x] 支持面板高度拖拽、折叠和关闭。
- [x] 关闭面板不销毁远程 Terminal。

### 完成条件

- [x] Browser 可创建、切换、输入和 resize 多个终端。
- [x] 切换 Workspace 后可重新附着仍存在的终端。

## M18：Changes 与 Files

### 目标

完成 Secondary Sidebar 的辅助信息能力。

### 工作项

- [x] SecondarySidebarPart 支持可复用多标签页。
- [x] ChangesView 使用 AHP Changeset，而不是自定义散乱 Git 方法。
- [x] 支持 diff、review、stage/revert 对应的明确 operation。
- [x] FilesView 使用标准 resourceList/resourceRead。
- [x] 文件预览作为可关闭标签打开。
- [x] 明确 Workspace Changes 与 Session Changeset 的边界。

### 完成条件

- [x] Changes 和 Files 可独立切换且不丢失状态。
- [x] 文件和 diff 始终路由到正确 Workspace。

## M19：Widget 与主题系统

### 目标

统一所有基础交互控件和颜色系统。

### 工作项

- [x] 实现 Button、PrimaryButton、Input、Select、Radio、Checkbox。
- [x] 实现 Tabs、Tree、Dialog、QuickPick、SplitView 等 Widget。
- [x] 每个 Widget/Part 使用独立 SCSS。
- [x] 使用 Codicon 并统一图标/文本基线。
- [x] 所有颜色 token 化，支持 Dark、Light、High Contrast、System。
- [x] 主题使用 SelectWidget 选择并持久化。

### 完成条件

- [x] Workbench 不再包含临时原生表单样式。
- [x] 任意主题下均无硬编码业务颜色。

## M20：浮动窗口基础设施

### 目标

为设置和管理功能提供 Workbench 内部浮动窗口。

### 工作项

- [x] 实现 OverlayLayer 和 IFloatingWindowService。
- [x] 实现 FloatingWindowWidget、标题栏和窗口 actions。
- [x] 支持居中打开、拖动、四边/四角 resize、最大化和恢复。
- [x] 限制窗口不离开 viewport，并可记忆 bounds。
- [x] 实现焦点捕获、背景 inert、Esc 关闭和焦点恢复。
- [x] 使用 `role=dialog` 和 `aria-modal=true`。
- [x] 小屏自动进入全 viewport 模式并禁用拖动/resize。

### 完成条件

- [x] 浮动窗口不会改变当前 Session 或 Workbench 布局状态。
- [x] 键盘、鼠标和移动端均可打开和关闭窗口。

## M21：Management Surface

### 目标

在浮动窗口内建立统一的设置和管理壳。

### 工作项

- [x] 实现 ManagementSurfaceWidget。
- [x] 实现搜索、Scope Tabs、左侧分类和内容区。
- [x] 建立 IManagementViewRegistry。
- [x] 支持窗口内部导航栈和返回。
- [x] 支持 dirty state、保存、放弃和关闭确认。
- [x] Esc 按 Dropdown → QuickPick → Dialog → Window 顺序关闭。

### 完成条件

- [x] Settings 快捷键可打开浮动管理窗口。
- [x] 注册的 Management View 可搜索、导航和销毁。

## M22：Template 管理窗口

### 目标

在 Management Surface 中管理可复现的 Git/Tar Template。

### 工作项

- [x] 实现 Template 列表、详情、创建、编辑和删除。
- [x] Git Source 支持 URL、ref、directory 和固定 commit。
- [x] Tar Source 支持 URL、可选 SHA256 和自动摘要固定。
- [x] 实现大小、压缩比、重定向、路径逃逸和 SSRF 防护。
- [x] Add Template 使用 QuickPick 选择来源类型。
- [x] 编辑器在同一个浮动窗口内容区打开，不叠加第二个大窗口。

### 完成条件

- [x] 管理员可在浮动窗口内添加 Git/Tar Template。
- [x] 已有 Workspace 不会因 Template 更新自动改变。

## M23：Credential 管理窗口

### 目标

安全管理系统级 Template Credential。

### 工作项

- [x] 支持 username/password、token 和 SSH key。
- [x] Secret 保存在 Secret Manager，Gorm 仅保存 metadata。
- [x] 实现 Credential Lease 和 Build 级授权。
- [x] 私有 Git/Tar 可使用短期凭证拉取。
- [x] HTTP、日志、Terraform 参数和 State 不得包含 Secret。
- [x] 在浮动窗口内完成创建、编辑、删除和使用范围展示。

### 完成条件

- [x] 私有 Template Source 可通过 Credential 拉取。
- [x] 自动化测试证明 Secret 未泄漏到禁止位置。

## M24：运行资源管理窗口

### 目标

在统一 Management Surface 中管理低频运行资源。

### 工作项

- [x] 实现 Workspace 管理 View。
- [x] 实现 Agent Host 状态和诊断 View。
- [x] 实现 Provisioner 与 Job 管理 View。
- [x] 实现 Build 日志和失败详情 View。
- [x] 危险操作使用明确的确认 Dialog。
- [x] 管理操作不改变当前 Session，除非目标 Workspace 被删除。

### 完成条件

- [x] 常用管理任务无需离开 Workbench 或发生页面跳转。
- [x] 管理 View 与实时 Session View 互不污染状态。

## M25：响应式与视觉对齐

### 目标

逐面板对齐 VS Code Agents Window，并完成移动端交互。

### 工作项

- [x] 去掉顶部搜索和前进/后退按钮。
- [x] 标题栏支持开关 Left/Secondary Sidebar。
- [x] 左右面板和 Bottom Panel 支持拖拽调整尺寸。
- [x] 修复所有图标与文本的对齐、间距和 hover/focus 状态。
- [x] Secondary Sidebar 支持多标签和关闭。
- [x] 移动端面板使用点击弹出的全宽抽屉，不堆叠。
- [x] 移动端浮动管理窗口使用全屏布局。
- [x] 对 Desktop、Tablet、Mobile 和所有主题执行截图回归。

### 完成条件

- [x] 关键面板完成逐项视觉对比记录。
- [x] 移动端无横向溢出、堆叠面板或不可达操作。
- [x] 交付最新 Workbench 截图。

## M26：总体集成验收

### 目标

验证从 Template 到 Workspace、Agent、Session、Terminal 和管理界面的完整闭环。

### 工作项

- [x] 从 Git/Tar Template 创建 Incus Ubuntu 24 Workspace。
- [x] Agent Host 注册并建立 Mux 连接。
- [x] HTTP Catalog 展示多个 Workspace Session。
- [x] Workbench attach 一个 Workspace 并完成 Chat、Terminal、Changes、Files。
- [x] 验证跨 Workspace 快速切换竞态。
- [x] 验证多个 Workbench Client 和多个 Logical Peer。
- [x] 验证 Server 重启、Host 重连和 Catalog 校正。
- [x] 验证 stop 不 destroy、start 恢复、delete 才销毁。
- [x] 验证 SQLite/MySQL、协议副本、Credential Lease 和 Secret 安全。
- [x] 完成 Desktop、Tablet、Mobile 截图和验证记录。

### 完成条件

- [x] `task check-protocols` 通过。
- [x] `task lint` 通过。
- [x] `task test` 通过。
- [x] `task build` 通过。
- [x] `task test-e2e` 通过。
- [x] `task screenshots` 产生并校验最新截图。
- [x] 原 M0–M6 的全部交付范围均有直接测试或演示证据。

## 原里程碑映射

| 原计划 | 新计划 |
| --- | --- |
| 原 M0：仓库与开发基线 | M0–M3 |
| 原 M1：控制平面 | M4 |
| 原 M2：Provisioner 与真实 Workspace | M5–M7 |
| 原 M3：Agent Host 与 AHP | M8–M13 |
| 原 M4：Workbench 主流程 | M14–M16 |
| 原 M5：终端与辅助信息 | M17–M19 |
| 原 M6：Template 与 Credential | M20–M24 |
| 新增视觉与总体验收 | M25–M26 |
