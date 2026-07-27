# Workbench 视觉验收

本记录以用户提供的 VS Code Agents Window 截图和当前
[`vscode.dev/agents`](https://vscode.dev/agents) 外壳为视觉参照。Zaw 不复制
受认证状态影响的业务内容，只对齐 Workbench 的位置、层级、密度与交互模式。

## 逐面板对比

| 区域 | 对齐项 | Zaw 结果 |
| --- | --- | --- |
| Titlebar | 无前进/后退和中央搜索；Codicon 面板开关位于右侧 | 已对齐 |
| Left Sidebar | Sessions 标题、紧凑 New/action 行、Workspace/Session 列表 | 已对齐 |
| Primary Area | 单 Session tab、居中空状态、底部 composer | 已对齐 |
| Secondary Sidebar | 可关闭多标签、Changes/Files、独立 toolbar | 已对齐 |
| Bottom Panel | 位置型面板、Terminal tabs、独立折叠/关闭/销毁 | 已对齐 |
| Split boundaries | 左右栏与 Bottom Panel 可拖动，hover 使用 focus token | 已对齐 |
| Mobile | 左右面板点击后以全宽 drawer 弹出，不参与主区域堆叠 | 已对齐 |
| Management | Workbench 内浮动窗口；小屏全 viewport | 已对齐 |

## 自动截图矩阵

`task screenshots` 使用本机 Playwright Chromium 和 Vite，不使用 Docker。命令覆盖：

- Desktop 1440×900：Dark、Light、High Contrast、System。
- Tablet 768×1024：Dark、Light、High Contrast、System。
- Mobile 390×844：Dark、Light、High Contrast、System。
- Management：1280×900 浮动窗口和 390×844 全屏窗口。

自动化同时断言无横向溢出、移动 drawer 占满宽度、浮动窗口不离开 viewport，
且移动管理窗口占满 viewport。最新基线位于 [screenshots](../screenshots/)。
