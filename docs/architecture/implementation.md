# 实施计划

## Monorepo

~~~
zaw/
├─ apps/
│  ├─ browser/                   # 浏览器构建入口；产物由 Server 内嵌
│  └─ electron/                  # Electron 主进程、preload、打包
├─ packages/
│  ├─ workbench/                 # 通用前端主包
│  ├─ ui/                        # 主题、图标、基础组件
│  ├─ protocol/                  # TS 共享模型、API/事件类型
│  └─ config/                    # TS、Lint、Prettier 等工程配置复用
├─ cmd/
│  └─ zaw/main.go
├─ internal/
│  ├─ server/
│  ├─ provisioner/
│  ├─ agenthost/
│  ├─ workspace/
│  ├─ template/
│  ├─ credential/
│  ├─ storage/mysql/
│  ├─ auth/
│  └─ observability/
├─ contracts/
├─ infra/terraform/
├─ docs/
├─ go.mod
├─ package.json
└─ pnpm-workspace.yaml
~~~

packages/config 仅用于 TypeScript、ESLint、Prettier 和可选 Tailwind preset 等工程配置复用；它不承载 Server 配置、Template 参数、Credential 或 Workbench 业务设置。

## MVP 验收范围

1. zaw server 启动 MySQL 迁移、提供 API，并内嵌 Browser Workbench。
2. zaw provisioner 能反向注册、领取 Build、从 Git 拉取固定 commit 并执行 Terraform。
3. zaw agent-host 能反向连接、上报遥测，并与一个 Agent 通过 ACP 通讯。
4. Browser 与 Electron 能连接同一个 Server，展示 Workspace → Session 树。
5. Workbench 能经 Server AHP Gateway 附着 Agent Host Session；Server 不落库会话内容。
6. Workbench 能显示 Workspace 红/绿在线点，以及 Header 中的 CPU、内存和 Git 摘要。
7. Workbench 能通过 AHP 创建、使用和关闭 Agent Host 终端；终端列表在底部面板右侧垂直显示。
8. 管理员可在 Settings Surface 中添加 Git 或 Tar URL Template，并绑定系统 Git Credential。

## 待决事项

- Provisioner 与 Server 的反向控制流具体协议。
- 身份认证、组织权限与 Workspace 共享模型。
- MySQL ID 选用 ULID 还是 BINARY(16) UUID。
- Terraform State 的具体 Backend、锁实现与加密策略。
- Secret Manager 的具体实现：内置加密存储、Vault 或云 Secret 服务。
- Template 的 Terraform validate/plan 在 Server 侧还是由 Provisioner Job 执行。
- Agent Host 的工作负载身份签发与首次注册协议。
- AHP WebSocket 的具体 endpoint、握手与多 Session multiplexing 方案。
