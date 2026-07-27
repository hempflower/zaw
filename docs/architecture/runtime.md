# 运行时架构

## 目标与边界

Zaw 是面向远程、隔离开发环境的 AI Agent 工作台。Workspace 是 Agent 的
实际执行环境；Workbench 只连接 Zaw Server，不直接连接 Workspace 网络。

- Workspace 是长期存在的逻辑开发环境。
- 一个 Workspace 可以拥有多个 Session。
- 一个窗口可以列出多个 Workspace 的 Session，但同时只 attach 一个
  Workspace。
- Agent Host 在 Workspace 内通过 Agent SDK 驱动实际 Agent；首个实现为官方
  GitHub Copilot Go SDK。
- Agent Host 是完整 Session、Chat、Terminal 和 Changeset 状态的权威。
- Server 不执行 Agent、Terraform、Shell 或 Workspace 文件操作。
- Server 持久化控制平面数据和 SessionSummary Read Model，不持久化完整
  Chat reducer、Terminal 输出、Changeset 内容、AHP snapshot 或 action history。

## 进程角色

同一个 Go 二进制以三个角色运行：

```text
zaw server
zaw provisioner
zaw agent-host
```

```text
Browser / Electron Workbench
├─ HTTP：Workspace、Session Catalog、Template、Credential
└─ WebSocket：当前 attached Workspace 的实时交互
                         │
                         ▼
                    Zaw Server
                    ├─ 控制平面
                    ├─ SessionSummary Read Model
                    ├─ Workbench Gateway
                    └─ AHP logical-stream routing
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
        Provisioner              Agent Host
        Terraform CLI            AHP Mux Server
             │                       │
             ▼                       ▼
	       Workspace 资源              Agent SDK
	                                      └─ Copilot SDK
```

## Server

Server 负责：

- 服务 Browser Workbench 静态资源。
- 通过 HTTP 提供 Workspace、Build、Template、Credential 和 Session Catalog。
- 创建、分发 Workspace Build，并接收日志、状态和资源摘要。
- 接收 Provisioner 和 Agent Host 的反向连接。
- 认证 Workbench，并校验目标 Workspace 权限。
- 将 Workbench 实时连接绑定到一个 Agent Host logical stream。
- 使用官方 `ahp.Client` 处理 AHP 请求、订阅、重连和事件分发。
- 运行只读 `server-catalog` logical peer，读取 `listSessions` 和 root summary
  事件并更新 SessionSummary Read Model。
- 接收 Agent Host HTTP 遥测。
- 管理 OpenAI、Anthropic 和 DeepSeek Provider、Model 与 Workspace 选择。
- 从 Secret Store 读取用户配置的 API key，通过厂商中立 LLM API 提供文本、
  推理、多模态、工具、结构化输出和统一 SSE 事件。

Server 不维护第二套完整 Agent 状态。SessionSummary 是面向查询的投影，包含
Workspace、Session resource、标题、状态、活动描述、修改时间、观察时间、
stale 标记和可选 Changes 摘要。

## Provisioner

Provisioner 运行在能访问目标基础设施的节点，主动连接 Server：

- 拉取 Git 或 Tar Template，验证固定 Source Snapshot。
- 使用本机 Terraform CLI 执行 init、plan、apply 和 destroy。
- 创建、启动、停止、修复、重建和删除 Workspace 资源。
- stop 只改变运行状态，不从 Terraform State 移除 VM；delete 才 destroy。
- 上报执行日志、资源摘要、状态和错误。
- 在授权 Build 中取得短期 Credential Lease。

## Agent Host

Agent Host 运行在 Workspace 内：

- 持有完整 Session、Chat、Terminal 和 Changeset 状态。
- 通过 `agentsdk.Runtime` 与实际 Agent 通讯，Agent SDK 生命周期由 Host 管理。
- Copilot SDK 使用 Server 的 Responses 边缘适配器；该适配器先转换为中立
  LLM 模型，不透传上游协议，Host 永远不读取厂商 API key。
- 提供 Workspace 范围的文件、终端和 Git 能力。
- 主动建立一条到 Server 的物理 WebSocket。
- 在物理连接上为 catalog 和 Workbench 提供独立 logical peer。
- 为每个 peer 隔离 clientId、JSON-RPC ID、subscription、reconnect 和 claim。
- 通过 HTTP 上报遥测。

官方 Go SDK 提供 Client、transport、reducer 和多 Host 的客户端 runtime，但
不提供 Agent Host JSON-RPC Server runtime。因此 Agent Host handler 由 Zaw
实现，并使用官方 `ahptypes` 的 envelope、版本和错误码，不重复实现 Go Client
的 pending request、subscription、reconnect 或事件分发。

## 协议边界

### Agent Host 物理连接与 Mux

```text
Agent Host physical connection
├─ logical peer: server-catalog
├─ logical peer: workbench-window-1
└─ logical peer: workbench-window-2
```

Mux 只负责 open、opened、data、close、路由、授权、有界队列和 backpressure。AHP
logical peer 之间不共享 initialize、subscription 或 request ID 空间。
固定 wire schema 位于 `docs/protocols/zaw-ahp-mux.schema.json`。Server 为每个
stream 使用独立的 64-frame 接收队列，单 Host 最多 16 个 stream；单 stream
溢出只关闭该 stream，不阻塞或关闭其他 stream。

### Workbench HTTP

| 领域 | 通讯方式 |
| --- | --- |
| Workspace、Build、Template、Credential | HTTP API |
| 跨 Workspace Session Catalog | HTTP API，支持 cursor/ETag |
| Host 遥测和最后观察状态 | HTTP API |
| Model Catalog 与中立 LLM Generate | HTTP API + SSE |

### Workbench 实时 WebSocket

Workbench 实时 WebSocket 只服务当前 attached Workspace。Server 终止用户
认证和 Workspace 授权，为连接分配 logical peer，并通过官方 `ahp.Client`
驱动 Agent Host。它不是 Agent Host 物理 socket 的独占字节级透传。

同 Workspace 切换 Session 时复用连接并调整 subscription；跨 Workspace
切换时关闭旧 logical peer，再建立新 logical peer。Agent Host 断开只关闭其
logical peers，不关闭 Workbench 的控制平面能力。

## 恢复语义

- Agent Host 重连后，catalog peer 重新 listSessions 并校正摘要。
- SessionSummary 在 Host 离线时保留 last-known 值并标记 stale。
- 完整聊天恢复由 Agent Host snapshot/reconnect 提供。
- Terminal detach 不等于 dispose；重新 attach 时恢复仍存在的 Terminal。
- Server 重启不改变 Workspace 或 Agent Host 中的完整 Session 权威状态。
