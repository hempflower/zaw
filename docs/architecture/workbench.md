# Workbench 设计

## 原则

- Workbench 是持续存在的应用壳，不使用传统页面跳转。
- Browser 与 Electron 复用 packages/workbench。
- Electron 只增加内置浏览器等原生增强；不运行 Workspace 本机 Shell。
- 管理能力使用覆盖式 Surface、Quick Pick、Sheet 和 Dialog。
- Esc 从最内层浮层逐级返回原 Session。
- Workbench 以 Workspace → Session 为唯一主结构，不存在 Chats。

## 主布局

~~~
┌───────────────┬───────────────────────────────────────┬──────────────┐
│ 左侧栏         │ Session Canvas                        │ 右侧辅助栏    │
│ Workspace      │ Session Header                        │ Changes       │
│  └─ Session[]  │ Agent 事件流 + 输入框                 │ Files         │
├───────────────┼───────────────────────────────────────┼──────────────┤
│ 设置入口       │ Bottom Panel Host（Terminal）                        │
└───────────────┴────────────────────────────────────────────────────┘
~~~

## 左侧栏

~~~
会话                                      [+ New] [搜索]

● browser-js
  ├─ 123
  ├─ 修复登录超时
  └─ 重构 API Client

● go-agent
  └─ 初始化项目

● node-dev
  └─ 更新依赖
~~~

- 绿点：该 Workspace 的 Agent Host 在线。
- 红点：该 Workspace 的 Agent Host 离线。
- 不显示“系统健康”“同步中”等泛化状态。
- New 默认在当前 Workspace 创建 Session；未选 Workspace 时弹出 Workspace Quick Pick。
- 离线 Workspace 的 Session 历史可浏览，但输入与终端不可执行。

## Session Canvas

Header 仅显示当前上下文：

~~~
Session 名称
[● Workspace] [Git 文件/变更统计] [CPU 12%] [Memory 2.1 / 8 GB]
~~~

Canvas 渲染用户消息、Agent 流、工具调用卡片、文件修改摘要、审批和明确错误。输入框位于底部，可就地选择 Agent、模型、附件和审批模式。

## 右侧辅助栏

右栏只显示当前 Session 的辅助信息：

~~~
[Changes] [Files] [Browser*]
~~~

- Changes：当前 Session 修改文件、diff 摘要、接受/还原操作。
- Files：Workspace 文件树与文件预览入口。
- Browser：仅 Electron 支持，用于预览 Workspace 暴露的 Web 服务或页面。
- 右栏可关闭、可调整宽度。

## 底部 Panel Host

底部必须可扩展，但第一期只注册 Terminal，不展示空功能标签：

~~~
┌────────────────────────────────────────────────────────────────────┐
│ Terminal                                             [+] [···] [×] │
├─────────────────────────────────────────────────┬──────────────────┤
│ $ pwd                                           │ Agent Host 终端   │
│ /workspace/browser-js                           │                  │
│                                                 │ > pwsh           │
│ $ git status                                    │   bash           │
│                                                 │   dev-server     │
└─────────────────────────────────────────────────┴──────────────────┘
~~~

- 左侧显示当前终端输入输出。
- 右侧固定宽度、垂直排列该 Workspace 的 Agent Host 终端列表。
- Terminal 属于 Workspace，可由同一 Workspace 的多个 Session 复用。
- + 通过 AHP 在 Agent Host 中创建终端；输入、输出、resize、关闭均通过 AHP。
- Browser 与 Electron 都渲染远程终端；Electron 不运行本机 Shell。
- 面板可拖拽高度、折叠或关闭；关闭面板不销毁终端。
- 后续可注册 output、tasks、ports、logs、debug 等贡献项。

~~~
BottomPanelContribution {
  id
  title
  render()
}
~~~

## Settings Surface

Template、Provisioner、系统凭证、MCP、插件等低频管理能力使用覆盖式 Settings Surface，不离开当前 Session：

~~~
Settings Surface → Workspace → Templates → Add Template
                                      └─ Quick Pick: Git / Tar URL
                                      └─ Sheet: 填写来源、目录、凭证
~~~

保存后回到 Surface 列表，不改变当前 Session 或 Workspace 上下文。
