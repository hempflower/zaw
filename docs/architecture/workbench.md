# Workbench 设计

> 当前实现向本设计的迁移由
> [Workbench 架构改造路线图](workbench-refactoring-roadmap.md) 跟踪。路线图中的
> R0–R20 已按该路线图迁移；固定视觉基准为 VS Code
> `27e3232864f30340158056fc4520a596030eca7a` 的独立 Agents Window。

## 原则

- Workbench 是持续存在的应用壳，不使用传统页面跳转。
- Browser 与 Electron 复用 `packages/workbench`。
- Workbench 不使用 React，所有界面元素是 TypeScript class Widget。
- InversifyJS 负责 Service、View、Widget 和 Part 的装配。
- View 消费 Service，不直接访问 HTTP、WebSocket 或 AHP。
- 一个窗口可展示多个 Workspace 的 Session，但同时只 attach 一个 Workspace。
- 设置和管理能力使用 Workbench 内部浮动窗口。
- Esc 从最内层 Dropdown/QuickPick/Dialog 逐级返回原 Session。

## 组件职责定义

以下职责边界是当前生产约定。

### Workbench

- 只负责 startup、restore、shutdown、全局错误处理、稳定 Part 布局。
- 不 import Session、Terminal、Changes、Files、Management 具体实现。
- 不持有任何领域列表、编辑表单、AHP 投影或 HTTP endpoint。
- 构造参数不超过 8 个基础 framework service。

### Part（Titlebar、Sidebar、Primary、Auxiliary、Panel、Overlay）

- 稳定 DOM 和布局单元，Workbench 启动时创建一次，后续永不替换。
- 拥有尺寸、可见性、resize handle；不拥有领域状态。
- View 通过 View Registry 注册到 Part，Part 不直接知道具体 View 类型。

### View

- 通过 descriptor 注册，由 DI 创建，只注入本功能所需 Service。
- 构造函数创建稳定 DOM；事件只更新 View 自己拥有的节点。
- 不 import HTTP/WebSocket/AHP provider，不调用 `container.get()`。
- subscribe `onDidXxx` 事件做局部 DOM 更新，不重建整个 Workbench 或 Part。

### Service

- 状态和行为的唯一所有者；通过 `onDidXxx` 发布变化。
- 不 import View、Widget、Part 或具体 DOM 类型（布局服务除外）。
- 不返回可变数组，不把原始 HTTP response 暴露给调用者。
- 不同状态使用足够细的 `onDidXxx`，避免一个万能 `onDidChange`。

### Command

- 行为入口；菜单、快捷键和 View 都调用同一个 command。
- Handler 只调用 Service，不操作 DOM。
- 参数有运行时 validation。

### Action

- 声明呈现位置（menu、titlebar、context menu）和条件（precondition）。
- 多个 Action 可引用同一个 command ID。

### Context Key

- 可观察、可组合的布尔上下文。
- 负责 action/menu/view 的 enablement 和 visibility。
- 各领域 Service 在状态变化时更新自己拥有的 key。
- View、Menu、Keybinding 共用同一表达式结果。

### Contribution

- 负责功能接线（注册 service、view、command、action、context key）。
- 构造函数只负责接线和启动，不保存长期领域状态。
- 按生命周期 phase 由 Contribution Registry 实例化。

### Provider

- 只实现 typed port（interface），封装 URL、method、header、JSON decoding、
  transport error mapping。
- Service 和 View 不知道 URL、JSON 或 AHP frame。
- Provider contract 可用 fake adapter 完整测试。

## 依赖方向

```text
bootstrap ──► platform/workbench 注册与布局接口
contrib/<feature> ──► platform, workbench framework, provider port
services ──► provider port（不依赖 View/Widget/Part）
providers ──► 只实现 typed port（不依赖 View/Part/Workbench）
views ──► services（不依赖 HTTP/WebSocket/AHP provider）
widgets ──► @zaw/ui 基础组件
```

## 工程结构

```text
src/
├─ bootstrap/
├─ platform/
├─ workbench/
├─ contrib/
├─ services/
├─ providers/
├─ views/
└─ styles/
```

关键接口包括：

- `ISessionCatalogService`
- `IActiveSessionService`
- `IWorkspaceAttachmentService`
- `IAgentHostProviderRegistry`
- `ISessionStatusRegistry`
- `IWorkbenchLayoutService`
- `ITerminalService`
- `IWorkspaceResourceService`
- `IThemeService`
- `IDetailViewService`

## 主布局

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Titlebar：左右 action hosts + 真正居中的 command center             │
├───────────────┬───────────────────────────────────────┬─────────────┤
│ Sidebar       │ Primary                               │ Auxiliary   │
│ Session tree  │ New Session / Active Chat / Preview   │ Tab + View  │
│               ├───────────────────────────────────────┴─────────────┤
│               │ Panel：Terminal（独立 Part，横跨 Primary+Auxiliary）│
└───────────────┴─────────────────────────────────────────────────────┘
```

固定 Part：

- `Part.Titlebar`
- `Part.Sidebar`
- `Part.Primary`
- `Part.AuxiliaryBar`
- `Part.Panel`
- `Part.Overlay`

Auxiliary 与 Primary 是独立浮动面板，顶部为 composite tab，下面为 View；Terminal 使用
xterm.js 并注册到 Panel。可见 gap 与 sash 命中区是两套几何，Panel sash 的左右端点随
Sidebar/Auxiliary 显隐更新，右侧竖 sash 不穿过 Panel。

## 多 Workspace 与单 Attachment

左栏通过 HTTP Session Catalog 展示多个 Workspace：

```text
browser-js
├─ 修复登录超时
└─ Terraform Provider

replay-ng
└─ 重构认证流程  ← selected
```

选中 Session 使用复合身份：

```text
{ workspaceId, sessionResource }
```

- 同 Workspace 切换 Session：复用实时连接并调整 subscription。
- 跨 Workspace 切换：释放旧 attachment，建立新 attachment。
- 后台 Catalog 更新不能改变当前选中 Session。
- 未 attach 的 Workspace 不创建完整实时订阅。
- Host 离线时显示 last-known SessionSummary 和 stale 状态。

## Session Canvas

PrimaryArea 只显示当前 Session：

- 用户和 Agent 消息。
- 流式 response part。
- 工具调用。
- 审批请求。
- 文件修改摘要。
- 明确错误。
- Agent、模型、附件和审批模式选择。

## Auxiliary Bar

Auxiliary Bar 使用持久 View descriptor：

- Changes：Session Changeset 和 Workspace uncommitted changes。
- Files：Workspace 文件树和预览。
- Browser：仅 Electron 的可选贡献。

支持关闭、宽度拖拽、多标签页和文件预览标签。

## Panel

当前只注册 Terminal View，不展示空功能标签：

- Terminal 属于 Workspace，可被同一 Workspace 的多个 Session 复用。
- 创建、订阅、输入、输出、resize、detach 和 dispose 使用 AHP Terminal。
- 面板可调整高度、折叠和关闭。
- 关闭面板不销毁远程 Terminal。
- 切回 Workspace 时重新 attach 仍存在的 Terminal。

## 扩展点与真实数据

- `mountWorkbench(root, apiBase, configure)` 在启动前暴露 Action、Command、Agent Host
  provider 与 Session status registry。
- provider picker 来自 AHP Root `agents[]`/`root/agentsChanged`，model 来自真实管理 API，
  workspace 来自 HTTP，Session status presentation 来自 registry；生产代码没有 fixture
  provider 或产品名 fallback。
- Browser E2E 使用 SQLite 控制面、真实 HTTP/WebSocket/AHP mux、真实 Agent Host 与临时
  Git Workspace 验证 create/send/cancel/approval/files/changes/layout restore。

## 视觉与 DOM 门禁

- 固定 VS Code permalink 的人工源码标注约束 shell inset、Part gap、宽度、圆角与输入动作
  尺寸；Playwright snapshot 的 `maxDiffPixelRatio` 为 `0.005`，不 mask geometry、border、
  icon 或状态控件。
- MutationObserver 保证 streaming、picker、catalog refresh 和 layout resize 不替换稳定
  DOM；主题矩阵覆盖 dark/light/high-contrast、1x/2x DPR 与 reduced motion。

## Widget 与主题

所有基础控件使用 class Widget，包括 Button、PrimaryButton、Input、Select、
Radio、Checkbox、Tabs、Tree、Dialog、QuickPick 和 SplitView。

- 每个 Widget/Part 使用独立 SCSS。
- 使用 Codicon。
- 图标和文本共享统一基线、间距和状态样式。
- 所有颜色使用 token，支持 Dark、Light、High Contrast 和 System。
- 主题通过 SelectWidget 选择。

## 浮动设置与管理窗口

设置、Template、Credential、Workspace、Agent Host 和 Provisioner 管理使用：

```text
OverlayLayer
└─ FloatingWindowWidget
   └─ ManagementSurfaceWidget
      ├─ Settings Navigation
      │  ├─ Common Settings
      │  ├─ Workspaces / Templates / Credentials / Models
      │  └─ Provisioners / Jobs / Builds
      ├─ Content
      └─ Form / Confirmation Sheet
```

- 浮动窗口居中，可拖动、resize、最大化和恢复。
- 背景变暗并 inert，关闭后恢复原焦点。
- 管理窗口内部使用导航栈，不叠加第二个大型窗口。
- Settings 使用单一配置层级，不区分 User、Workspace、Remote 或 Provisioner scope。
- New Session 的 workspace picker 始终包含 `Create New Workspace…`；该 action 通过
  `zaw.workspace.openCreate` 打开真实表单，并由 `WorkspaceService.create()` 调用 typed
  provider 后刷新 workspace catalog。
- 未保存内容关闭前必须确认。
- 移动端占满 viewport，禁用拖动和 resize。

## 响应式行为

- Desktop 支持左右栏和 Bottom Panel 拖拽。
- 标题栏可开关 LeftSidebar 和 SecondarySidebar。
- 移动端面板通过点击弹出的全宽抽屉展示，不进行纵向堆叠。
- 移动端管理窗口使用全屏模式。
- Desktop、Tablet、Mobile 和所有主题均执行截图回归。
