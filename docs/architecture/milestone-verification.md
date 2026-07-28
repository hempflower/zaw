# M0–M26 里程碑验收记录

本文件记录 [交付计划](delivery-plan.md) 的串行门禁状态。只有当前里程碑的
工作项和完成条件均有直接证据时，才能将其标记为通过并开始下一里程碑。

## 状态

| 里程碑 | 状态 | 验收证据 |
| --- | --- | --- |
| M0 | 已通过 | 2026-07-27，见下方验收记录 |
| M1 | 已通过 | 2026-07-27，见下方验收记录 |
| M2 | 已通过 | 2026-07-27，见下方验收记录 |
| M3 | 已通过 | 2026-07-27，见下方验收记录 |
| M4 | 已通过 | 2026-07-27，见下方验收记录 |
| M5 | 已通过 | 2026-07-27，见下方验收记录 |
| M6 | 已通过 | 2026-07-27，见下方验收记录 |
| M7 | 已通过 | 2026-07-27，见下方验收记录 |
| M8 | 已通过 | 2026-07-27，见下方验收记录 |
| M9 | 已通过 | 2026-07-27，见下方验收记录 |
| M10 | 已通过 | 2026-07-27，见下方验收记录 |
| M11 | 已通过 | 2026-07-27，见下方验收记录 |
| M12 | 已通过 | 2026-07-27，见下方验收记录 |
| M13 | 已通过 | 2026-07-27，见下方验收记录 |
| M14 | 已通过 | 2026-07-27，见下方验收记录 |
| M15 | 已通过 | 2026-07-27，见下方验收记录 |
| M16 | 已通过 | 2026-07-27，见下方验收记录 |
| M17 | 已通过 | 2026-07-27，见下方验收记录 |
| M18 | 已通过 | 2026-07-27，见下方验收记录 |
| M19 | 已通过 | 2026-07-27，见下方验收记录 |
| M20 | 已通过 | 2026-07-27，见下方验收记录 |
| M21 | 已通过 | 2026-07-27，见下方验收记录 |
| M22 | 已通过 | 2026-07-27，见下方验收记录 |
| M23 | 已通过 | 2026-07-27，见下方验收记录 |
| M24 | 已通过 | 2026-07-27，见下方验收记录 |
| M25 | 已通过 | 2026-07-27，见下方验收记录 |
| M26 | 已通过 | 2026-07-27，见下方验收记录 |

## M0：架构与协议决策固化

### 验收清单

- [x] delivery plan 已拆分为 M0–M26，并包含原里程碑映射。
- [x] Runtime 文档定义 HTTP Catalog、单 attached Workspace 和实时 WebSocket。
- [x] 文档明确 Agent Host 是完整 Agent 状态权威。
- [x] 文档明确 Server 只持久化 SessionSummary Read Model。
- [x] 文档移除透明 AHP physical-socket 转发设计。
- [x] 文档定义 Agent Host physical connection 与 logical peer Mux。
- [x] 文档定义官方 Go AHP SDK 与 Zaw Host/Mux 的边界。
- [x] Workbench 文档定义无 React、InversifyJS、Parts、Views 和 Widgets。
- [x] Workbench 文档定义浮动设置与管理窗口。
- [x] Terraform 文档定义 stop 保留 VM、delete 才 destroy。
- [x] 新旧里程碑映射已记录。

### 验收记录

```text
2026-07-27  git diff --check -- README.md docs
            通过，无空白错误。

2026-07-27  rg 架构冲突词审计
            通过；命中内容均为新约束、明确否定旧设计或历史范围映射。

2026-07-27  项目 Markdown 本地链接目标检查
            通过，共检查 13 个项目文档。

2026-07-27  task check-protocols
	            通过；当时固定的协议副本一致。M9 决策取消 ACP 后，协议门禁只保留 AHP。
```

协议上游 README 中指向未纳入固定副本的其他语言客户端和贡献文件的链接，
属于有意的副本裁剪边界；项目自有文档不存在断链。

结论：M0 工作项和完成条件全部满足，可以开始 M1。

## M1：本地工具链

### 验收清单

- [x] 仓库不存在 Makefile，Taskfile 是统一任务入口。
- [x] `fmt`、`lint`、`test` 和 `build` 同时覆盖 Go 与前端。
- [x] `check-protocols`、`test-e2e` 和 `screenshots` 入口存在。
- [x] `.gitignore`、`.env.example` 和本地开发文档已补齐。
- [x] CI 通过 Task 执行依赖安装、检查、测试和构建。
- [x] Go、Terraform、Prettier 和 100 字符源码行宽均有检查。

### 验收环境

```text
Go         1.24.0
Node.js    24.18.0
pnpm       10.13.1
Terraform  1.11.4
Task       3.45.5
Incus      6.0.0
```

### 验收记录

```text
2026-07-27  task deps -- --frozen-lockfile   通过
2026-07-27  task fmt                         通过
2026-07-27  task lint                        通过
2026-07-27  task test                        通过
2026-07-27  task build                       通过
2026-07-27  task test-e2e                    通过
2026-07-27  task screenshots                 通过（M25 自动化入口占位）
2026-07-27  task check-protocols             通过
```

结论：M1 工作项和完成条件全部满足，可以开始 M2。

## M2：Go 应用骨架

### 验收清单

- [x] DDD 目录边界包含 bootstrap、domain、usecase、infra 和 interfaces。
- [x] Agent Host、Agent SDK 与 Provisioner 位于独立边界。
- [x] Fx module 与 application root 位于 bootstrap。
- [x] HTTP delivery adapter 使用 Chi router 和 middleware。
- [x] `/healthz` 健康检查可用。
- [x] Server 同步绑定端口，后台错误触发 Fx 关停，停止时优雅关闭 HTTP。
- [x] Provisioner 与 Agent Host 停止时取消并 join 后台任务。
- [x] CLI 同时响应系统信号和 Fx 内部关停信号。
- [x] 架构测试禁止 Domain/Usecase 反向依赖 adapter。

### 验收记录

```text
2026-07-27  Fx graph validation                 通过（3 个 application root）
2026-07-27  Server Fx start/stop                通过
2026-07-27  managed process cancel/join         通过
2026-07-27  GET /healthz                        通过
2026-07-27  Domain/Usecase import boundary      通过
2026-07-27  task lint                           通过
2026-07-27  task test                           通过
2026-07-27  task build                          通过
```

结论：M2 工作项和完成条件全部满足，可以开始 M3。

## M3：数据库基线

### 验收清单

- [x] `ZAW_DATABASE_DRIVER` 和 `ZAW_DATABASE_DSN` 选择 SQLite/MySQL。
- [x] `.env` 由 Server bootstrap 自动加载。
- [x] 中立的 `gormstore` 同时承载双库模型和 Repository Adapter。
- [x] migration ledger 记录 `0001_initial`，重复执行保持幂等。
- [x] Repository 统一传播 context、事务和物理删除语义。
- [x] SQLite 与 MySQL 使用同一套行为测试。
- [x] CI 提供 MySQL 8.4 服务执行双库测试，不使用容器编译项目。
- [x] `server --migrate-only` 创建 schema 后直接退出。

### 双库行为矩阵

| 行为 | SQLite | MySQL |
| --- | --- | --- |
| 显式 migration 与重复执行 | 通过 | 通过 |
| JSON 语义往返 | 通过 | 通过 |
| 自动时间字段 | 通过 | 通过 |
| 复合唯一索引 | 通过 | 通过 |
| 事务回滚 | 通过 | 通过 |
| 硬删除后释放唯一键 | 通过 | 通过 |
| schema 无 `deleted_at` | 通过 | 通过 |

### 验收记录

```text
2026-07-27  SQLite migration/repository matrix   通过
2026-07-27  MySQL migration/repository matrix    通过（MySQL 8）
2026-07-27  task lint                            通过
2026-07-27  task test（含双库环境）              通过
2026-07-27  zaw server --migrate-only（SQLite）  通过
```

结论：M3 工作项和完成条件全部满足，可以开始 M4。

## M4：控制平面模型与 API

### 验收清单

- [x] Template 与不可变 Template Source snapshot 可通过 HTTP 管理。
- [x] Workspace 创建会原子创建初始 Build 和 Provisioner Job。
- [x] Workspace 三组状态统一为 desiredState、observedState、agentHostState。
- [x] Workspace 和 Build 状态规则由 Domain/Usecase 执行，不在 HTTP 中复制。
- [x] Provisioner 注册、心跳、原子领取 Job 和事件/日志上报可用。
- [x] Job 完成原子更新 Job、Build、Workspace 和 WorkspaceResource。
- [x] Agent Host telemetry metadata 和 Credential metadata 可持久化。
- [x] 管理操作写入 AuditLog。

### API 行为验收

| 行为 | 结果 |
| --- | --- |
| 创建 Template、Workspace、Build | 通过 |
| mutable source 固定为 commit/SHA snapshot | 通过 |
| Provisioner 心跳与领取 Job | 通过 |
| Build 日志、状态和资源上报 | 通过 |
| 未知 operation/status | 400 |
| 非法 Workspace/Build 状态转换 | 409 |
| Agent Host telemetry metadata | 通过 |
| 管理审计动作 | 通过 |

### 验收记录

```text
2026-07-27  control-plane HTTP lifecycle tests   通过
2026-07-27  Workspace Usecase state tests        通过
2026-07-27  Build Usecase state tests            通过
2026-07-27  task lint                            通过
2026-07-27  task test（含 SQLite/MySQL）          通过
2026-07-27  task build                           通过
```

结论：M4 工作项和完成条件全部满足，可以开始 M5。

## M5：Terraform Runner

### 验收清单

- [x] Runner 直接调用本机 Terraform CLI，不通过 Docker 编译或执行。
- [x] init → saved plan → apply → output 和 delete → destroy 可用。
- [x] 单次 Build 总超时与调用方 cancellation 可用。
- [x] Unix Terraform 进程组在取消时整体终止，子进程不残留。
- [x] stdout/stderr 按行流式写入，并对 State/环境 Secret 跨 chunk 脱敏。
- [x] sensitive Terraform output 不进入 WorkspaceResource summary。
- [x] 独立临时工作目录、持久插件缓存和失败目录策略可配置。
- [x] 本地 State backend 使用 Workspace 独立持久路径。

### Runner 行为验收

| 场景 | 结果 |
| --- | --- |
| 真实 `terraform_data` create → destroy | 通过 |
| saved plan 被原样 apply | 通过 |
| plan 失败与 stderr 流式日志 | 通过 |
| partial apply 错误与 plan 清理 | 通过 |
| caller cancellation | 通过 |
| timeout 与子进程组清理 | 通过 |
| 日志 Secret 脱敏 | 通过 |
| sensitive output 排除 | 通过 |
| 成功/失败工作目录策略 | 通过 |

### 验收记录

```text
2026-07-27  Terraform CLI 1.11.4 本机资源闭环   通过
2026-07-27  Runner success/failure/cancel tests  通过
2026-07-27  Runner timeout/process-group tests   通过
2026-07-27  Runner redaction/output tests        通过
2026-07-27  task lint                            通过
2026-07-27  task test（含真实 Terraform）         通过
2026-07-27  task build                           通过
```

结论：M5 工作项和完成条件全部满足，可以开始 M6。

## M6：Zaw Terraform Provider

### 验收清单

- [x] Provider 配置支持 Server URL 和独立 Agent Host base URL。
- [x] `zaw_workspace` data source 输出 desired_state 与 running 布尔状态。
- [x] `zaw_agent` resource 输出 environment、init script 和 Agent config。
- [x] Agent 支持 blocking/non-blocking startup、timeout 与 metadata。
- [x] Workspace、Server、Agent Host 地址和 Agent SDK 启动参数均完成注入。
- [x] create/start/reconfigure/rebuild/repair → running。
- [x] stop → stopped 且 Agent ID 仍保留在 Terraform State。
- [x] delete → deleted，并仅在 Terraform delete 时清除 Agent resource。
- [x] 不照搬 Coder `start_count`；用 running 属性避免 stop 移除 VM。

### 验收记录

```text
2026-07-27  Provider InternalValidate             通过
2026-07-27  Workspace/Agent schema tests          通过
2026-07-27  metadata/startup/lifecycle tests      通过
2026-07-27  local dev_overrides CLI load          通过
2026-07-27  Terraform plan/apply/read/delete      通过
2026-07-27  task lint                             通过
2026-07-27  task test                             通过
2026-07-27  task build                            通过
```

结论：M6 工作项和完成条件全部满足，可以开始 M7。

## M7：Incus Ubuntu 24 Template

### 验收清单

- [x] 本机 Incus Provider/CLI 可创建 Ubuntu 24.04 cloud VM。
- [x] VM 与独立 `/workspace` volume 由 Terraform 管理。
- [x] create/start/reconfigure/rebuild/repair 映射为 `running=true`。
- [x] stop 映射为 `running=false`，不会从 State 移除资源。
- [x] 只有 delete 调用 `terraform destroy`。
- [x] Provisioner 可注入 Agent Host binary、0600 配置和 0600 注册凭证。
- [x] 注册凭证不进入 Terraform variable、命令参数或 State。
- [x] 本地 State 使用固定 source snapshot 和 Workspace 独立路径。
- [x] `task test-incus` 提供有安全前缀与失败清理的本机实机验收。

### 实机生命周期验收

```text
2026-07-27  Incus 6.0.0 / Terraform 1.11.4 / lxc/incus 1.1.1
2026-07-27  Ubuntu 24 VM create                 2 add / 0 change / 0 destroy
2026-07-27  stop saved plan                     0 add / 1 change / 0 destroy
2026-07-27  stop apply                          VM=Stopped，State 保留 VM 与 volume
2026-07-27  start apply                         VM=Running，同一 volatile.uuid
2026-07-27  Agent Host binary                   /usr/local/bin/zaw，mode 0755
2026-07-27  Agent Host env/token                mode 0600，token 不在 State
2026-07-27  delete                              0 add / 0 change / 2 destroy
2026-07-27  isolated resource cleanup           VM 与 volume 均不存在
```

自动验收实例为
`zaw-m7-verify-20260727101555-1426870`，其跨 stop/start 保持的 UUID 为
`e769a67f-5c11-421d-a097-dc64a126ddb0`。State 使用唯一的
`verification/m7-verify-20260727101555-1426870.tfstate` key。

### 仓库门禁

```text
2026-07-27  task test-incus                     通过
2026-07-27  task lint                           通过
2026-07-27  task test                           通过
2026-07-27  task build                          通过
```

结论：M7 工作项和完成条件全部满足，可以开始 M8。

## M8：Agent Host 生命周期

### 验收清单

- [x] 注册凭证由 Server 签名，并严格限制到单个 Workspace。
- [x] 同一 Workspace 重复签发得到同一凭证，不实现 session token 轮换。
- [x] 凭证只从 mode 0600 文件读取；组/其他用户可读时拒绝启动。
- [x] Agent Host 主动建立反向 WebSocket，并发送 WebSocket ping 心跳。
- [x] HTTP telemetry 使用相同注册凭证并持久化健康与资源信息。
- [x] live registry 随 socket 建立和断开切换 online/offline。
- [x] 重复 Host 连接由最新连接接管，旧连接被关闭。
- [x] Server 重启后 Host 自动重连，Host 内存中的会话保持不变。
- [x] Workspace stop 主动断开 Host，并在 stopped 状态拒绝重连。
- [x] 连接中的 Host 响应 context cancellation，不阻塞 Fx shutdown。
- [x] token 不进入日志、Terraform State 或完整协议 payload 日志。

### 行为验收

| 场景 | 结果 |
| --- | --- |
| 无凭证或跨 Workspace 凭证连接 | 401 |
| 固定注册凭证重复签发 | 内容完全相同 |
| Host 连接/断开 | registry online/offline |
| HTTP telemetry | 认证成功并落库 |
| 重复 Host | 最新连接接管 |
| Server restart | 自动重连、凭证文件不变、会话仍在 |
| Workspace stop | 旧连接关闭，新连接返回 409 |
| Host context cancellation | 2 秒内退出 |
| PTY 分片输出稳定性 | 连续 50 次通过 |

### 验收记录

```text
2026-07-27  Agent Host identity/connection tests  通过
2026-07-27  Server restart/reconnect E2E          通过
2026-07-27  duplicate/stop/cancellation tests     通过
2026-07-27  telemetry registry test               通过
2026-07-27  task test-e2e                         通过
2026-07-27  task lint                             通过
2026-07-27  task test                             通过
2026-07-27  task build                            通过
```

结论：M8 工作项和完成条件全部满足，可以开始 M9。

## M9：Server LLM Gateway 与 Agent SDK

### 验收清单

- [x] OpenAI、Anthropic、DeepSeek Provider 和逻辑 Model 可通过 API 管理。
- [x] 用户填写 API base/key；key 只存 Secret Store，不进入数据库或响应。
- [x] Workspace 可选 Model，未选择时解析组织默认 Model。
- [x] 中立请求覆盖文本、多模态、推理、工具、结构化输出和流式响应。
- [x] 三家 Adapter 显式构造厂商请求并解析响应，不透传 wire payload。
- [x] 三家流测试均覆盖文本、推理、工具开始、参数 delta 和聚合完成响应。
- [x] 不支持的图片输入和 reasoning effort 返回明确的 400。
- [x] `include`、`store`、`prompt_cache_key` 不属于中立协议且不到达上游。
- [x] Agent Host 使用官方 GitHub Copilot Go SDK 和本机 Copilot CLI。
- [x] Copilot 仅持有 Workspace 固定注册凭证，不取得上游 API key。
- [x] Responses 边缘适配器补齐 item/content 生命周期和递增 sequence。
- [x] Agent SDK 文本、工具、审批、取消和错误映射通过 AHP E2E。

### 行为验收

| 场景 | 结果 |
| --- | --- |
| Provider API key 写入与读取 | 仅 Secret Store |
| Workspace Model profile | 固定凭证认证并返回能力 |
| 三家原生 SSE | 统一为中立 Event |
| 不支持的图片/effort | 400，不静默丢弃 |
| Copilot 自动兼容字段 | 入口丢弃，不进入上游请求 |
| Responses delta | SDK 收到 `assistant.message_delta` |
| 工具/审批/取消/错误 | 结构化 AHP/Agent SDK 事件 |

### 验收记录

```text
2026-07-27  Copilot CLI 1.0.75 本机安装                 通过
2026-07-27  三家 Provider 文本/推理/工具/SSE 测试       通过
2026-07-27  Model API、Secret 与能力拒绝测试             通过
2026-07-27  官方 Copilot SDK → Server → 伪上游流测试     通过
2026-07-27  include/store/prompt_cache_key 上游隔离       通过
2026-07-27  Agent SDK AHP E2E                            通过
2026-07-27  go test -race（llmproxy/http/agenthost）      通过
2026-07-27  task check-protocols                         通过
2026-07-27  task lint                                    通过
2026-07-27  task test                                    通过
2026-07-27  task build                                   通过
2026-07-27  task test-e2e                                通过
```

真实 SDK 验收使用
`ZAW_COPILOT_CLI_INTEGRATION=/home/evanxiao/.local/lib/node-v24/bin/copilot`，
上游为测试内 HTTP Server，不使用 GitHub 登录态或真实模型额度。

结论：M9 工作项和完成条件全部满足，可以开始 M10。

## M10：官方 AHP SDK 与协议升级

### 验收清单

- [x] Go module 固定官方 AHP Go Client SDK `v0.6.0`。
- [x] AHP 文档和 schema 固定到该版本对应提交
  `3234536b9824a5b6bc45c37458261f675fdc65c9`。
- [x] protocol check 同时核对 module 版本、上游提交、SDK 协议常量和 TS 常量。
- [x] Agent Host wire message、初始化参数、错误码和版本使用官方 `ahptypes`。
- [x] 官方 `ahp.Client` 完成请求关联、订阅事件分发和 reconnect 测试。
- [x] Go 产品代码没有另一套 Client pending/subscription 状态机。
- [x] 官方 SDK 未提供 Host Server runtime；Zaw Host handler 边界已记录。
- [x] Workbench 使用共享 TS AHP 类型，固定 schema 契约测试覆盖初始化和 action。

### 验收记录

```text
2026-07-27  官方 ahp.Client request/subscription/reconnect 测试  通过
2026-07-27  AHP module/tag/commit/protocol/TS 契约检查           通过
2026-07-27  旧版 0.3.0 与重复 Go Client 状态审计               通过
2026-07-27  go test -race（agenthost/http）                     通过
2026-07-27  task check-protocols                               通过
2026-07-27  task lint                                          通过
2026-07-27  task test                                          通过
2026-07-27  task build                                         通过
2026-07-27  task test-e2e                                      通过
```

`rpcRequest` 仅是官方 `ahptypes.JsonRpcRequest` 的类型别名；它不定义另一份
wire struct。Workbench 的浏览器连接仍有自己的 TypeScript 请求关联状态，M10
限制的是替换 Go Client 时不得在 Go 产品代码中并存两套状态机。

结论：M10 工作项和完成条件全部满足，可以开始 M11。

## M11：单逻辑 AHP 连接

### 验收清单

- [x] initialize 的 initial subscriptions 返回官方 Root snapshot。
- [x] subscribe 返回官方 Session、Chat、Terminal 和 Changeset snapshot。
- [x] listSessions 返回完整 `SessionSummary`，root 发送标准 session 通知。
- [x] Workbench 创建后订阅 Session/默认 Chat，输入使用 `chat/turnStarted`。
- [x] Agent SDK 文本流映射为 responsePart、delta、turnComplete/error。
- [x] 每个 Chat action 同步产生 `session/chatUpdated` 标准 action。
- [x] Terminal PTY 输出和 Changeset 刷新使用官方 action 类型。
- [x] 新官方 Client 断开后可用 reconnect 获取 fresh snapshots 恢复完整 Chat。

### 行为验收

| 场景 | 结果 |
| --- | --- |
| initialize + Root initial subscription | 官方 Root snapshot |
| createSession + listSessions | 标准 SessionSummary 与 root/sessionAdded |
| Session/Chat subscribe | 标准 snapshot，包含 defaultChat |
| chat/turnStarted | SDK 收到输入并流式返回 markdown action |
| Terminal create/output | 标准 Terminal snapshot/action |
| Changeset subscribe/refresh | 标准 Changeset snapshot/action |
| Client 断开并 reconnect | 返回 Root/Session/Chat/Changeset fresh snapshots |

### 验收记录

```text
2026-07-27  官方 Client 单 Peer 完整 Session/Chat 测试      通过
2026-07-27  Root/Terminal/Changeset 标准类型解码测试         通过
2026-07-27  Workbench 标准 Session/Chat 输入流程测试         通过
2026-07-27  fresh snapshot reconnect 恢复测试               通过
2026-07-27  go test -race（agenthost/http）                  通过
2026-07-27  task check-protocols                            通过
2026-07-27  task lint                                       通过
2026-07-27  task test                                       通过
2026-07-27  task build                                      通过
2026-07-27  task test-e2e                                   通过
```

M11 仍保留旧 Workbench 方法名 `promptSession` 作为内部 UI facade，但其 wire
实现已经是 `dispatchAction(chat/turnStarted)`，不会发送自定义
`promptSession` JSON-RPC request。工具审批的完整标准 Widget 流程属于 M16。

结论：M11 工作项和完成条件全部满足，可以开始 M12。

## M12：AHP 多路复用

### 验收清单

- [x] 项目自有 JSON schema 固定 `open`、`opened`、`data`、`close` 四种 frame。
- [x] `MuxTransport` 实现官方 `ahp.Transport` 并通过双向 frame 测试。
- [x] Host 共享 Agent 状态，但每个 logical peer 独立保存 clientId 和 subscriptions。
- [x] Terminal client claim 必须匹配 logical peer 的 clientId。
- [x] Server 只按 streamId 路由完整 AHP JSON-RPC payload，不解释或改写 payload。
- [x] 每个 stream 使用独立 64-frame 队列，Host/Server 均限制为 16 个 stream。
- [x] 单 stream 队列溢出只关闭该 stream。
- [x] Agent Host 物理连接断开会关闭其全部 logical streams。

### 隔离验收

| 场景 | 结果 |
| --- | --- |
| 两 stream 同时使用 JSON-RPC ID 7，响应反向返回 | 各自收到本 stream 响应 |
| peer-a unsubscribe root | peer-b 继续收到 root action |
| 关闭第一个 Workbench stream | 第二个 stream 继续 request/response |
| slow stream 接收队列溢出 | slow 关闭，fast 正常收到 frame |
| 第 17 个 logical peer | 明确 close frame 拒绝 |
| Agent Host socket 断开 | 全部 Workbench streams 关闭 |

### 验收记录

```text
2026-07-27  Mux schema 与 TypeScript union 契约测试          通过
2026-07-27  官方 ahp.Transport 双向 frame 测试              通过
2026-07-27  JSON-RPC ID/subscription/close 隔离测试          通过
2026-07-27  backpressure、peer limit、Host 断开测试          通过
2026-07-27  Terminal claim logical-peer 隔离测试             通过
2026-07-27  go test -race（ahpmux/agenthost/http）           通过
2026-07-27  task check-protocols                            通过
2026-07-27  task lint                                       通过
2026-07-27  task test                                       通过
2026-07-27  task build                                      通过
2026-07-27  task test-e2e                                   通过
```

结论：M12 工作项和完成条件全部满足，可以开始 M13。

## M13：Session Catalog

### 验收清单

- [x] 每个在线 Agent Host 有独立只读 `server-catalog` logical peer。
- [x] Catalog peer 使用官方 `ahp.Client` initialize、listSessions 和 root subscription。
- [x] Gorm Read Model 只保存 SessionSummary 轻量字段和可选 Changes 计数。
- [x] `GET /api/v1/sessions` 支持 limit、opaque cursor 和 `updated_after`。
- [x] 响应提供 ETag、observedAt、Agent Host 在线状态和 stale。
- [x] sessionAdded、sessionRemoved 和 sessionSummaryChanged 实时更新投影。
- [x] Agent Host 重连后重新 listSessions，并硬删除该 Workspace 已消失的摘要。
- [x] Agent Host 离线时保留 last-known 摘要，不保存完整状态。

### 行为验收

| 场景 | 结果 |
| --- | --- |
| 两个 Workspace 的摘要查询 | 按 modifiedAt 稳定排序并分页 |
| 相同查询携带匹配 If-None-Match | 304 Not Modified |
| Agent Host 创建或更新 Session | root summary 事件实时 Upsert |
| Agent Host 断线 | 摘要保留，online=false、stale=true |
| 同一 Host 重连 | 重新 listSessions，observedAt 刷新并全量对账 |
| 数据表字段审计 | 无 Chat 消息、Terminal 输出、Changeset 内容或 AHP history |

### 验收记录

```text
2026-07-27  官方 AHP Client Catalog 创建/事件同步测试        通过
2026-07-27  Agent Host 离线与重连全量对账 E2E              通过
2026-07-27  SQLite hard reconcile/cursor/updated_after 测试  通过
2026-07-27  HTTP pagination/ETag/online/stale 测试           通过
2026-07-27  SessionSummary 数据表轻量字段审计                通过
2026-07-27  go test -race（agenthost/gormstore/http）        通过
2026-07-27  task check-protocols                            通过
2026-07-27  task lint                                       通过
2026-07-27  task test                                       通过
2026-07-27  task build                                      通过
2026-07-27  task test-e2e                                   通过
```

结论：M13 工作项和完成条件全部满足，可以开始 M14。

## M14：Workbench 工程骨架

### 验收清单

- [x] Browser 与 UI package 不再包含 React、TSX 或 React 类型依赖。
- [x] Inversify 容器装配 Workspace、Agent Host 和管理能力接口。
- [x] HTTP 与 AHP 实现位于 providers；services 只暴露能力接口。
- [x] Titlebar、Left Sidebar、Primary Area、Bottom Panel 和 Secondary Sidebar
  均为位置型 Part。
- [x] Session Catalog、Session、Terminal、Details、Settings 和管理面板均为
  class View/Widget。
- [x] Part/View/Widget 不直接使用 fetch 或 WebSocket。
- [x] 每个位置型 Part 有独立 SCSS，Workbench shell 由 Part 组合。
- [x] 架构测试阻止 React/TSX、直接网络访问和非 Widget UI class 回归。

### 验收记录

```text
2026-07-27  Inversify capability binding 测试                 通过
2026-07-27  Workbench React/TSX 与网络边界架构测试            通过
2026-07-27  五个位置型 Part 独立 render/dispose 测试          通过
2026-07-27  Browser production build                         通过
2026-07-27  task check-protocols                             通过
2026-07-27  task lint                                        通过
2026-07-27  task test                                        通过
2026-07-27  task build                                       通过
2026-07-27  task test-e2e                                    通过
```

结论：M14 工作项和完成条件全部满足，可以开始 M15。

## M15：多 Workspace Catalog 与单 Attachment

### 验收清单

- [x] Left Sidebar 通过 HTTP Session Catalog 跨 Workspace 分组展示。
- [x] Session 身份和 View key 均使用 `{ workspaceId, resource }`。
- [x] `IActiveSessionService` 是唯一活动 Session 选择边界。
- [x] `IWorkspaceAttachmentService` 同时最多保留一个 AHP client。
- [x] 同 Workspace 复用 attachment；跨 Workspace 主动关闭旧 attachment。
- [x] 并发 attach 中迟到的旧连接会关闭并返回 stale 错误。
- [x] 旧 Host event 和旧 Workspace 异步结果不会覆盖当前 View。
- [x] HTTP Catalog 轮询更新摘要，但不会改变用户选择。
- [x] 每个 Workspace 独立保存 Session、Details 和 Terminal 恢复状态。

### 验收记录

```text
2026-07-27  HTTP Catalog opaque cursor 分页测试             通过
2026-07-27  复合 Session identity 冲突隔离测试              通过
2026-07-27  单 attachment/并发迟到连接/旧事件隔离测试       通过
2026-07-27  Workspace 独立 UI state 恢复测试                通过
2026-07-27  Browser production build                       通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
```

结论：M15 工作项和完成条件全部满足，可以开始 M16。

## M16：Chat 主流程

### 验收清单

- [x] Session Canvas 由 SessionView、ChatComposerWidget、ToolCallWidget 和
  ApprovalWidget 组合，不依赖 React。
- [x] 用户消息、Agent 流式文本、工具生命周期、审批和错误使用标准 AHP
  Chat action 展示。
- [x] Composer 支持 Agent、Server Model、附件和审批模式选择。
- [x] 草稿通过 `chat/draftChanged` 同步，并按复合 Session 身份本地恢复。
- [x] 发送、`chat/turnCancelled`、断线重连和 Chat snapshot 恢复可用。
- [x] 离线时禁用输入，HTTP Catalog 和历史摘要仍可浏览。
- [x] Agent Host 将 Copilot SDK 工具和权限事件映射为标准
  `chat/toolCall*` 与 `session/inputNeeded*`，不再要求 Workbench 处理
  `session/agentEvent` 或 `session/permissionRequest`。
- [x] 嵌入附件和模型选择进入标准 AHP Message，并传到 Copilot SDK。

### 验收记录

```text
2026-07-27  官方 AHP Client 工具审批与 inputNeeded 清理测试   通过
2026-07-27  Chat 复合身份草稿、选择和发送后清理测试          通过
2026-07-27  Composer/Tool/Approval 独立 Widget 测试          通过
2026-07-27  AHP draft/cancel/tool confirmation 契约测试      通过
2026-07-27  Browser production build                       通过
2026-07-27  go test -race（agenthost/http）                 通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
2026-07-27  git diff --check                               通过
```

结论：M16 工作项和完成条件全部满足，可以开始 M17。

## M17：Terminal

### 验收清单

- [x] AHPClient 使用标准 Terminal create、subscribe、input、resize、claim 和
  dispose 契约。
- [x] Root snapshot 和 `root/terminalsChanged` 是 Workspace Terminal 列表权威。
- [x] Workspace 重新 attached 后订阅现存 Terminal，并从完整 snapshot 恢复输出。
- [x] 同一浏览器标签为每个 Workspace 复用稳定 logical clientId，以便安全 reclaim。
- [x] BottomPanelPart 组合 TerminalView，不存在按功能命名的 TerminalPart。
- [x] 多 Terminal 标签、活动 Terminal、显式 dispose 和 Workspace 恢复可用。
- [x] Bottom Panel 支持自定义拖拽高度、折叠和隐藏，并按 Workspace 保存高度。
- [x] 隐藏面板只改变 UI 状态；只有 dispose 会关闭并终止远程 PTY。

### 验收记录

```text
2026-07-27  Root Terminal discovery/snapshot reattach 测试   通过
2026-07-27  标准 terminal/claimed Host reducer 测试         通过
2026-07-27  Bottom Panel resize/close/dispose 控件测试      通过
2026-07-27  Workspace Terminal panel height 恢复测试        通过
2026-07-27  Browser production build                       通过
2026-07-27  go test -race（agenthost/http）                 通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
2026-07-27  git diff --check                               通过
```

结论：M17 工作项和完成条件全部满足，可以开始 M18。

## M18：Changes 与 Files

### 验收清单

- [x] SecondarySidebarPart 使用可复用 TabsWidget 展示 Changes、Files 和预览。
- [x] Workbench 通过标准 AHP Changeset snapshot 加载变更，不调用自定义 Git 查询。
- [x] diff 随 ChangesetFile 传递，review 使用标准 filesReviewChanged action。
- [x] stage 和 revert 使用标准 invokeChangesetOperation 与 resource target。
- [x] Files 使用标准 resourceList/resourceRead，并在可关闭预览标签中打开。
- [x] UI 明确标注 Workspace Changes；Session Changeset 仅提供当前 Session 的关联入口。
- [x] Changes/Files 活动标签和预览状态按 Workspace 保存，切换不会串线。

### 验收记录

```text
2026-07-27  标准 Changeset snapshot/review/operation Host 测试  通过
2026-07-27  AHP Client 无自定义 workspace Git 方法契约测试     通过
2026-07-27  Secondary Sidebar tabs/scope/operation 视图测试    通过
2026-07-27  Browser production build                         通过
2026-07-27  go test -race（agenthost/http）                   通过
2026-07-27  task check-protocols                             通过
2026-07-27  task lint                                        通过
2026-07-27  task test                                        通过
2026-07-27  task build                                       通过
2026-07-27  task test-e2e                                    通过
2026-07-27  git diff --check                                 通过
```

结论：M18 工作项和完成条件全部满足，可以开始 M19。

## M19：Widget 与主题系统

### 验收清单

- [x] class Widget 覆盖 Button、PrimaryButton、Input、Select、Radio 和 Checkbox。
- [x] class Widget 覆盖 Tabs、Tree、Dialog、QuickPick 和 SplitView。
- [x] Workbench View 不直接输出原生 button、input、select 或 textarea。
- [x] Button、表单、Tabs、Tree、Dialog、QuickPick、SplitView 使用独立 SCSS。
- [x] Codicon 与文本使用统一 inline-flex 基线和 focus/hover 状态。
- [x] Dark、Light、High Contrast 和 System 仅通过颜色 token 定义。
- [x] Settings 使用 SelectWidget 选择主题并保存到 localStorage。

### 验收记录

```text
2026-07-27  UI 基础与复合 Widget 渲染测试                 通过
2026-07-27  Workbench 原生交互控件静态审计                通过，无命中
2026-07-27  token 文件外颜色字面量静态审计                通过，无命中
2026-07-27  Browser production build                      通过
2026-07-27  task check-protocols                          通过
2026-07-27  task lint                                     通过
2026-07-27  task test                                     通过
2026-07-27  task build                                    通过
2026-07-27  task test-e2e                                 通过
2026-07-27  git diff --check                              通过
```

结论：M19 工作项和完成条件全部满足，可以开始 M20。

## M20：浮动窗口基础设施

### 验收清单

- [x] IFloatingWindowService 是窗口状态、bounds、最大化和恢复的能力边界。
- [x] OverlayLayerWidget 与 FloatingWindowWidget 独立于业务 View。
- [x] 标题栏提供最大化、恢复和关闭 action，支持拖动。
- [x] 八个 resize handle 覆盖四边和四角，bounds 被限制在 viewport。
- [x] bounds 按窗口 ID 持久化，重新打开可恢复。
- [x] dialog/aria-modal、焦点捕获、背景 inert、Tab trap、Esc 与焦点恢复可用。
- [x] 540px 以下强制全 viewport，并禁用拖动和 resize。

### 验收记录

```text
2026-07-27  FloatingWindow service 持久化/maximize/restore 测试  通过
2026-07-27  dialog 语义、标题栏拖动和八方向 resize 渲染测试    通过
2026-07-27  Inversify IFloatingWindowService binding 测试       通过
2026-07-27  Browser production build                           通过
2026-07-27  task check-protocols                               通过
2026-07-27  task lint                                          通过
2026-07-27  task test                                          通过
2026-07-27  task build                                         通过
2026-07-27  task test-e2e                                      通过
2026-07-27  git diff --check                                   通过
```

结论：M20 工作项和完成条件全部满足，可以开始 M21。

## M21：Management Surface

### 验收清单

- [x] ManagementSurfaceWidget 组合搜索、Scope Tabs、Tree 和内容区。
- [x] IManagementViewRegistry 由 Inversify 提供并拒绝重复注册。
- [x] 内建 Settings、Template、Credential 和 Runtime View 均通过注册表发现。
- [x] View 选择使用窗口内历史栈并提供 Back action。
- [x] 编辑表单跟踪 dirty state，关闭时进入 discard confirmation。
- [x] Esc 先关闭管理 sheet/quick pick/dialog，再关闭浮动窗口。
- [x] Ctrl/Cmd+, 打开管理窗口，关闭后恢复原焦点。

### 验收记录

```text
2026-07-27  Management registry scope/duplicate 测试       通过
2026-07-27  search/scope/tree/back Surface 渲染测试        通过
2026-07-27  Inversify IManagementViewRegistry binding 测试 通过
2026-07-27  Browser production build                      通过
2026-07-27  task check-protocols                          通过
2026-07-27  task lint                                     通过
2026-07-27  task test                                     通过
2026-07-27  task build                                    通过
2026-07-27  task test-e2e                                 通过
2026-07-27  git diff --check                              通过
```

结论：M21 工作项和完成条件全部满足，可以开始 M22。

## M22：Template 管理窗口

### 验收清单

- [x] TemplateManagementView 展示列表、详情、固定 revision 和 Credential 引用。
- [x] Add Template 通过 QuickPick 选择 Git 或 Tar，再进入同窗编辑表单。
- [x] Git 表单支持 URL、ref、directory；Server 保存前解析完整 commit。
- [x] Tar 表单支持 URL、可选 SHA256、格式，并自动固定实际摘要。
- [x] 创建、PATCH 编辑、引用保护删除和 Workspace source snapshot 已有直接测试。
- [x] Tar 下载限制大小/重定向，解包限制大小/压缩比和路径/链接逃逸。
- [x] HTTP、Git SSH 和重定向目标均执行私网/本地地址 SSRF 检查。

### 验收记录

```text
2026-07-27  Template Management View 固定信息/actions 测试 通过
2026-07-27  Source SSRF/inline credential/format 测试       通过
2026-07-27  Archive size/ratio/path/symlink 安全测试        通过
2026-07-27  Template CRUD/引用保护/固定 snapshot 测试       通过
2026-07-27  Browser production build                       通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
2026-07-27  git diff --check                               通过
```

结论：M22 工作项和完成条件全部满足，可以开始 M23。

## M23：Credential 管理窗口

### 验收清单

- [x] Credential View 支持 token、username/password 和 SSH key metadata。
- [x] Secret 只进入 Local Secret Store；Gorm 和普通 API 不返回 secretRef 或 Secret。
- [x] metadata-only 编辑不会替换或轮换已保存 Secret。
- [x] Credential View 明确显示“不自动轮换”策略和 Template 使用范围。
- [x] 删除使用确认 Dialog，并拒绝 Template/Workspace snapshot 引用。
- [x] Provisioner Credential 只对 claimed job 的 Build source snapshot 授权。
- [x] 私有 Git/Tar 从 Local Secret Store 读取并通过环境或 Header 使用凭证。

### 验收记录

```text
2026-07-27  Credential View metadata/usage/no-secret 测试    通过
2026-07-27  Credential API create/edit/list no-secret 测试  通过
2026-07-27  metadata 编辑不轮换 Secret 测试                通过
2026-07-27  claimed Build Credential 授权边界测试          通过
2026-07-27  Template/Workspace 引用删除保护测试            通过
2026-07-27  go test -race（http/source）                   通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
2026-07-27  git diff --check                               通过
```

结论：M23 工作项和完成条件全部满足，可以开始 M24。

## M24：运行资源管理窗口

### 验收清单

- [x] Workspace View 显示 observed/desired state、Template 和当前 Build。
- [x] Agent Host View 显示连接状态、健康、CPU 和内存 telemetry。
- [x] Provisioner/Job View 显示能力、心跳、claim、attempt 和 Build 关联。
- [x] Build View 显示 operation、status、日志和失败详情。
- [x] 新增只读 `/builds`、`/provisioners`、`/provisioner-jobs` 管理 API。
- [x] Stop 使用明确确认 Dialog，并明确 VM 被保留而非销毁。
- [x] 管理 action 按目标 Workspace ID 调用，不改变活动 Session attachment。

### 验收记录

```text
2026-07-27  Runtime View provisioner/job/build diagnostics 测试 通过
2026-07-27  Runtime 管理只读 API 控制面闭环测试            通过
2026-07-27  Stop confirmation 与按目标 Workspace 路由审计  通过
2026-07-27  Browser production build                       通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
2026-07-27  git diff --check                               通过
```

结论：M24 工作项和完成条件全部满足，可以开始 M25。

## M25：响应式与视觉对齐

### 验收清单

- [x] Titlebar 不包含前进/后退和中央搜索，使用 Codicon 开关左右栏。
- [x] Left/Secondary Sidebar 和 Bottom Panel 均可拖拽 resize。
- [x] Button/Codicon/text 使用统一 inline-flex 基线、hover 与 focus token。
- [x] Secondary Sidebar 使用可复用、可关闭的多标签 TabsWidget。
- [x] 860px 以下左右栏以点击触发的全宽 drawer 弹出，不参与主区域堆叠。
- [x] 540px 以下浮动管理窗口占满 viewport，隐藏 drag/resize handle。
- [x] 逐面板对比结果记录于 `ui-visual-verification.md`。
- [x] 本机 Playwright 覆盖三种 viewport、四种主题和两种 Management viewport。

### 验收记录

```text
2026-07-27  当前 vscode.dev/agents 外壳只读截图复核       通过
2026-07-27  task screenshots（14 张最新截图）              通过
2026-07-27  横向溢出/全宽 drawer/窗口 viewport 自动断言    通过
2026-07-27  Desktop/Tablet/Mobile × 4 themes 尺寸校验      通过
2026-07-27  Browser production build                       通过
2026-07-27  task check-protocols                           通过
2026-07-27  task lint                                      通过
2026-07-27  task test                                      通过
2026-07-27  task build                                     通过
2026-07-27  task test-e2e                                  通过
2026-07-27  git diff --check                               通过
```

结论：M25 工作项和完成条件全部满足，可以开始 M26。

## M26：总体集成验收

### 验收清单

- [x] Git/Tar Template 固定 source revision 并创建 Incus Ubuntu 24 Workspace。
- [x] Agent Host 使用固定凭证注册，并以单 physical socket 承载多个 Logical Peer。
- [x] HTTP Catalog 独立投影多个 Workspace 下相同 resource URI 的 Session。
- [x] Workbench 单 attach 闭环覆盖 Chat、Terminal、Changes 和 Files 标准 AHP 资源。
- [x] 跨 Workspace 快速切换只保留最新 attachment，旧 Host 事件被隔离。
- [x] 多 Workbench Client 的相同 JSON-RPC ID、订阅和 Terminal claim 均按 Peer 隔离。
- [x] Server 重启后 Host 自动重连、固定凭证不变，Session 与 Catalog 被重新校正。
- [x] 真实 Incus VM stop/start 保持 UUID；只有 delete 销毁 VM 和数据卷。
- [x] SQLite 与 MySQL 运行同一套 Gorm migration/repository/no-soft-delete 验收。
- [x] AHP 副本、Build Credential、Local Secret Store 和 API no-secret 边界通过。
- [x] 中立 LLM API 不包含 `include`、`store` 或 `prompt_cache_key`。
- [x] Desktop、Tablet、Mobile、四种主题和 Management viewport 截图已更新。

### 验收记录

```text
2026-07-27  本机 Incus Ubuntu 24 create/stop/start/delete   通过
            stop plan: 0 add / 1 change / 0 destroy
            start 后 UUID: 2efab419-c912-4b88-af04-d68bc0552f46（保持不变）
            delete: VM 与 workspace data volume 均清理
2026-07-27  SQLite/MySQL 同套 Gorm migration/repository    通过
2026-07-27  多 Workspace HTTP Session Catalog              通过
2026-07-27  单 attachment 快速切换竞态                     通过
2026-07-27  Chat/Terminal/Changes/Files AHP Workbench       通过
2026-07-27  Mux 多 Client/Peer/订阅/claim 隔离              通过
2026-07-27  Server restart/Host reconnect/Catalog reconcile 通过
2026-07-27  Build Credential、Secret no-leak、协议副本      通过
2026-07-27  task check-protocols                            通过
2026-07-27  task lint                                       通过
2026-07-27  task test                                       通过
2026-07-27  task build                                      通过
2026-07-27  task test-e2e                                   通过
2026-07-27  task screenshots（14 张并带布局断言）           通过
2026-07-27  git diff --check                                通过
```

原 M0–M6 已映射至 M0–M24，每一项均有对应里程碑验收记录；M25–M26 补充了
视觉与跨层总体验收。至此 M0–M26 全部串行门禁均已通过。
