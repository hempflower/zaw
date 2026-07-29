# Zaw 设计文档

本文档集合是 Zaw 当前已确认设计的唯一入口。实现时应以这些文档为准；尚未决定的项目只存在于“待决事项”，不得自行推断为既定行为。

## 阅读路径

1. [运行时架构](architecture/runtime.md)：组件职责、部署拓扑、AHP 边界。
2. [模型网关](architecture/model-gateway.md)：中立 LLM API、三家 Provider 与 Secret 边界。
3. [领域与数据模型](architecture/domain-and-data.md)：Workspace、Build、MySQL 与存储。
4. [模板与凭证](architecture/templates-and-credentials.md)：Terraform、Git/Tar 来源、Credential。
5. [Workbench](architecture/workbench.md)：前端交互、布局和终端。
6. [Workbench 视觉验收](architecture/ui-visual-verification.md)：逐面板对比与截图矩阵。
7. [实施计划](architecture/implementation.md)：Monorepo、MVP 验收与待决事项。
8. [逐步推进计划](architecture/delivery-plan.md)：按里程碑执行的任务、产出和验收条件。
9. [Workbench 架构改造路线图](architecture/workbench-refactoring-roadmap.md)：按 R0–R12 将 Workbench 改造为 Contribution、Service、Command 和稳定 Part 驱动的可扩展框架。
10. [Zaw Terraform Provider](architecture/terraform-provider-zaw.md)：Agent 注入资源与模板生命周期。
11. [本地开发](development.md)：本机工具版本、Task 入口和环境配置。
12. [里程碑验收记录](architecture/milestone-verification.md)：M0–M26 的门禁状态和直接证据。
13. [Plan 评审设计（暂缓实现）](architecture/plan-review.md)：AHP 上游现状、候选私有扩展、范围批注交互与恢复实施条件。
14. [发布流程](releasing.md)：版本一致性、门禁、GitHub Release 与 Terraform Registry 边界。

## 已确认的核心决策

- Go 二进制以 server、provisioner、agent-host、terraform-provider 四种角色运行。
- Browser 和 Electron 都直接连接 Server；共用 packages/workbench。
- Agent Host 在 Workspace 内运行；它拥有 Session 状态与历史。
- Agent Host 到 Server 的一条物理连接承载多个相互隔离的逻辑 AHP Peer。
- Server 使用官方 Go AHP Client，不自行实现请求、订阅、重连或 reducer。
- Server 保存 SessionSummary 查询投影，但不保存完整 Chat、Terminal、
  Changeset、AHP snapshot 或 action history。
- Provisioner 主动连接 Server，并执行 Terraform。
- Gorm 支持 SQLite 和 MySQL；Terraform State 使用 Provisioner 本机持久目录。
- Server 统一提供 OpenAI、Anthropic 与 DeepSeek 模型；公开 LLM API 中立且不透传。
- Template 不提供显式版本化；Workspace 固定创建时的源码快照。
- Template 源码支持 Git 与 Tar URL。
- 第一阶段仅支持系统凭证。
- Workbench 不使用 React，不采用传统页面跳转；窗口可列出多个 Workspace，
  但同时只 attach 当前 Session 所属的一个 Workspace。
- 设置与管理能力在 Workbench 内的浮动窗口中打开。
