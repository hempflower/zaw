# Workbench 设计

> 当前实现向本设计的迁移由
> [Workbench 架构改造路线图](workbench-refactoring-roadmap.md) 跟踪。路线图中的
> R12 完成前，统一 View Registry 不等价于完整的 Workbench 解耦。

## 原则

- Workbench 是持续存在的应用壳，不使用传统页面跳转。
- Browser 与 Electron 复用 `packages/workbench`。
- Workbench 不使用 React，所有界面元素是 TypeScript class Widget。
- InversifyJS 负责 Service、View、Widget 和 Part 的装配。
- View 消费 Service，不直接访问 HTTP、WebSocket 或 AHP。
- 一个窗口可展示多个 Workspace 的 Session，但同时只 attach 一个 Workspace。
- 设置和管理能力使用 Workbench 内部浮动窗口。
- Esc 从最内层 Dropdown/QuickPick/Dialog 逐级返回原 Session。

## 工程结构

```text
src/
├─ bootstrap/
├─ services/
├─ providers/
├─ parts/
├─ views/
├─ widgets/
└─ styles/
```

关键接口包括：

- `ISessionCatalogService`
- `IActiveSessionService`
- `IWorkspaceAttachmentService`
- `IWorkbenchConnection`
- `ITerminalService`
- `IChangesService`
- `IFilesService`
- `IThemeService`
- `ILayoutService`
- `IFloatingWindowService`

## 主布局

```text
┌───────────────┬───────────────────────────────────────┬──────────────┐
│ LeftSidebar   │ PrimaryArea                           │ SecondaryBar │
│ Workspace[]   │ Active Session Canvas                 │ Changes      │
│  └─ Session[] │ Agent 事件流 + 输入框                 │ Files        │
├───────────────┴───────────────────────────────────────┴──────────────┤
│ BottomPanel：Terminal                                               │
└─────────────────────────────────────────────────────────────────────┘
```

固定 Part：

- `TitlebarPart`
- `LeftSidebarPart`
- `PrimaryAreaPart`
- `BottomPanelPart`
- `SecondarySidebarPart`

名称描述位置和用途。Terminal 是 `TerminalView`，注册到 BottomPanelPart；
Changes 和 Files 是注册到 SecondarySidebarPart 的 View。

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

## Secondary Sidebar

Secondary Sidebar 使用可复用 TabsWidget：

- Changes：Session Changeset 和 Workspace uncommitted changes。
- Files：Workspace 文件树和预览。
- Browser：仅 Electron 的可选贡献。

支持关闭、宽度拖拽、多标签页和文件预览标签。

## Bottom Panel

第一期只注册 TerminalView，不展示空功能标签：

- Terminal 属于 Workspace，可被同一 Workspace 的多个 Session 复用。
- 创建、订阅、输入、输出、resize、detach 和 dispose 使用 AHP Terminal。
- 面板可调整高度、折叠和关闭。
- 关闭面板不销毁远程 Terminal。
- 切回 Workspace 时重新 attach 仍存在的 Terminal。

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
      ├─ Search
      ├─ Scope Tabs
      ├─ Navigation
      └─ Content
```

- 浮动窗口居中，可拖动、resize、最大化和恢复。
- 背景变暗并 inert，关闭后恢复原焦点。
- 管理窗口内部使用导航栈，不叠加第二个大型窗口。
- 未保存内容关闭前必须确认。
- 移动端占满 viewport，禁用拖动和 resize。

## 响应式行为

- Desktop 支持左右栏和 Bottom Panel 拖拽。
- 标题栏可开关 LeftSidebar 和 SecondarySidebar。
- 移动端面板通过点击弹出的全宽抽屉展示，不进行纵向堆叠。
- 移动端管理窗口使用全屏模式。
- Desktop、Tablet、Mobile 和所有主题均执行截图回归。
