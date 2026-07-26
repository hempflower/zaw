# 运行时架构

## 目标与边界

Zaw 是面向远程、隔离开发环境的 AI Agent 工作台。Workspace 是 Agent 的实际执行环境；WorkBench 只连接 Server，不直连 Workspace。

- Workspace 是独立开发与 Agent 执行环境。
- 一个 Workspace 对应多个 Session；不存在独立全局 Chats。
- Agent Host 在 Workspace 内通过 ACP 驱动实际 Agent。
- Server 不执行 Agent、Terraform、Shell 或文件操作。
- Server 不保存 Session 状态、事件、快照或历史。

## 进程角色

同一个 Go 二进制 zaw 以三个子命令运行：

~~~
zaw server
zaw provisioner
zaw agent-host
~~~

~~~
Browser Workbench ─┐
                   ├── HTTP / WebSocket ──> Server
Electron Workbench ─┘                          │
                                                ├── Build / 调度任务
                                                │
                              主动连接 ┌─────────┴─────────┐
                                       │                   │
                                  Provisioner          Agent Host
                                 （资源节点）          （Workspace 内）
                                       │                   │
                                   Terraform            AHP WebSocket
                                       │                   │
                                  Workspace 资源          ACP
                                                            │
                                                        实际 Agent
~~~

## Server

Server 是控制平面，负责：

- 服务 Browser Workbench 静态资源；构建产物通过 go:embed 内嵌。
- 为 Browser、Electron 提供 HTTP API 和业务 WebSocket。
- 管理组织、用户、权限、Template、Workspace、Build、Provisioner 和系统凭证。
- 接收 Provisioner 和 Agent Host 的反向连接，维护临时在线注册表。
- 创建、分发 Workspace Build，并接收 Build 日志、状态和资源摘要。
- 校验 Workbench 的 Workspace 权限，并在 Workbench 与 Agent Host 之间转发 AHP WebSocket。
- 接收 Agent Host HTTP 遥测：CPU、内存、磁盘、健康度。

Server 不得保存 AHP 事件或 Session 相关数据，也不得修改会话序号、origin 或事件顺序。

## Provisioner

Provisioner 运行在能访问目标基础设施的节点，主动连接 Server。

- 拉取 Git 或 Tar 模板源码，验证固定快照。
- 在临时目录执行 terraform init、plan、apply、destroy。
- 创建、更新、停止、修复、删除 Workspace 资源。
- 上报执行日志、资源摘要、状态和错误。
- 按 Build 从 Credential 系统获取短期 Git 凭据。

Provisioner 与 Server 的反向控制流具体传输实现尚未定稿。

## Agent Host

Agent Host 运行在 Workspace 内：

- 维护该 Workspace 的 Agent Session 状态与历史。
- 通过 ACP 与实际 Agent 后端通讯。
- 提供 Workspace 范围内的文件、终端、Git 等工具能力。
- 主动建立到 Server 的 AHP WebSocket。
- 通过 HTTP 上报遥测。
- 提供远程终端的创建、输入、输出、resize 与关闭。

Server 重启或连接丢失后，Agent Host 与 Workbench 分别重连；会话恢复由 Workbench 经 Server 重新附着 Agent Host 完成。

## 协议边界

### AHP：会话与终端

~~~
Workbench ── AHP ──> Server AHP Gateway ── AHP ──> Agent Host ── ACP ──> Agent
~~~

Gateway 处理顺序：

1. 认证 Workbench 用户，并校验 Workspace 授权。
2. 按 Workspace 定位在线 Agent Host。
3. 建立或复用两端转发。
4. 原样转发 AHP envelope。
5. Host 离线时返回明确的 Workspace 离线错误。

Session 列表、会话历史、恢复、删除、事件顺序均由 Agent Host 实现。

### HTTP / 业务 WebSocket：控制平面

| 领域 | 通讯方式 |
| --- | --- |
| 组织、用户、权限 | HTTP API |
| Template、Credential、Provisioner 管理 | HTTP API |
| Workspace 生命周期 | HTTP API + Build 事件 |
| Terraform 日志与 Build 状态 | 业务 WebSocket / 拉取 API |
| Host 遥测 | Agent Host → Server HTTP |
| Agent Session、终端 | AHP WebSocket |
