# 实施架构

具体顺序和验收门禁见 [交付计划](delivery-plan.md)。本文件只定义目标目录、
依赖方向和最终集成范围。

## Monorepo

```text
zaw/
├─ apps/
│  ├─ browser/
│  └─ electron/
├─ packages/
│  ├─ workbench/
│  ├─ ui/
│  ├─ protocol/
│  └─ config/
├─ cmd/
│  ├─ zaw/
│  └─ terraform-provider-zaw/
├─ internal/
│  ├─ bootstrap/                 # Fx application 与模块装配
│  ├─ domain/                    # 领域实体、值对象和端口
│  ├─ usecase/                   # 应用用例
│  ├─ infra/                     # Gorm、Terraform、Secret、Source adapter
│  ├─ interfaces/
│  │  ├─ http/                   # Chi HTTP delivery adapter
│  │  └─ terraformprovider/      # Terraform Provider entry adapter
│  ├─ agenthost/                 # Agent Host、AHP Server、Agent SDK adapters
│  └─ provisioner/               # Job worker 与 Terraform orchestration
├─ examples/templates/
├─ docs/
├─ Taskfile.yml
├─ go.mod
└─ pnpm-workspace.yaml
```

依赖规则：

- `bootstrap` 可以依赖所有装配目标，但不承载业务实现。
- `domain` 不依赖 HTTP、Gorm、Terraform、Fx 或具体数据库。
- `usecase` 依赖 domain port，不直接依赖 adapter。
- `infra` 实现持久化、Secret、Source 和 Terraform 等端口。
- `interfaces` 只做外部输入输出适配，不收纳 AHP、Agent SDK 或 Provisioner 领域。
- Fx application 不放在 `infra`。

## Workbench

Workbench 内部架构的最终改造步骤、删除清单和验收门禁见
[Workbench 架构改造路线图](workbench-refactoring-roadmap.md)。

### 当前目录（R20）

```text
packages/workbench/src/
├─ bootstrap/          # DI 容器、framework-only Workbench 入口、架构守卫
├─ platform/           # Command、Action、Context Key、Lifecycle、Overlay、Theme
├─ workbench/          # Contribution lifecycle 与稳定 Layout/Part 框架
├─ contrib/            # Sessions、Workspace、Terminal、Management 功能贡献
├─ services/           # 跨功能 typed port、View registry、可扩展 provider/status registry
├─ providers/          # HTTP/AHP transport adapter
├─ views/workbench/    # Titlebar framework View
└─ styles/             # shell、views、widgets 分所有权 SCSS
```

目录表达所有权，不强制一次性搬动全部文件。文件移动必须伴随依赖方向检查。

### 生产 Import 规则

| 源目录 | 可依赖 | 禁止依赖 |
| ------ | ------ | -------- |
| `bootstrap/` | platform、workbench 注册与布局接口 | contrib/\*\* 具体功能实现 |
| `contrib/<feature>/` | platform、workbench framework、provider port | 其他 contrib 的具体 Service |
| `services/` | provider port（只 import interface） | View、Widget、Part、具体 DOM 类型 |
| `providers/` | 无（只实现 typed port） | View、Part、Workbench、bootstrap |
| `views/` | services（只 import interface） | HTTP/WebSocket/AHP provider |
| `platform/` | @zaw/ui 基础类型 | contrib/\*\*、具体 Service、View |

- Workbench 不使用 React。
- InversifyJS 负责接口和实现装配。
- View 只消费 Service，不直接访问 HTTP、WebSocket 或 AHP。
- 所有 UI 元素是 class Widget；可复用组件也属于 widgets。
- 固定 Part ID 为 Titlebar、Sidebar、Primary、AuxiliaryBar、Panel、Overlay；DOM 在启动时
  创建一次，隐藏只改变 Layout 状态。
- Terminal、Changes 和 Files 是注册到 Part 的 View，不是 Part。
- `IAgentHostProviderRegistry`、`ISessionStatusRegistry` 和 `IActionRegistry` 是公开扩展点；
  新 provider/status/action 不修改 Workbench 或通用 renderer。
- 设置和管理功能使用 OverlayLayer 中的 FloatingWindowWidget。

## 最终集成范围

1. Server 通过 Fx 启动 Chi API，并使用 Gorm 支持 SQLite/MySQL。
2. Provisioner 领取 Build，固定 Git/Tar snapshot，并通过本机 Terraform CLI
   管理 Incus Ubuntu 24 VM。
3. stop 停止 VM但保留资源；delete 才执行 destroy。
4. Agent Host 反向注册，通过 Agent SDK 驱动 Agent，并在物理连接上提供 AHP mux。
5. Server 使用官方 Go AHP SDK，不自行实现 Client request/subscription/reducer。
6. HTTP 提供跨 Workspace SessionSummary Catalog。
7. Workbench 可列出多个 Workspace，但实时区域只 attach 一个 Workspace。
8. Chat、Terminal、Changes 和 Files 均通过当前 logical peer 工作。
9. Template、Credential、Workspace、Host 和 Provisioner 管理在浮动窗口完成。
10. Desktop、Tablet、Mobile 和所有主题通过截图回归。
11. Server 提供厂商中立 LLM API；OpenAI、Anthropic、DeepSeek 仅作为 Infra
    Adapter，上游密钥只存 Secret Store。

## 尚待后续里程碑确定的事项

- 正式身份认证、组织权限与 Workspace 共享模型。
- Terraform State 本机目录的备份、权限和磁盘可靠性策略。
- Local Secret Store 的备份与文件权限检查策略。
- Server 横向扩展时 Agent Host physical connection 的归属和迁移策略。
- Electron 原生增强和内置浏览器的最终安全边界。
