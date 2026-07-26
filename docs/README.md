# Zaw 设计文档

本文档集合是 Zaw 当前已确认设计的唯一入口。实现时应以这些文档为准；尚未决定的项目只存在于“待决事项”，不得自行推断为既定行为。

## 阅读路径

1. [运行时架构](architecture/runtime.md)：组件职责、部署拓扑、AHP 边界。
2. [领域与数据模型](architecture/domain-and-data.md)：Workspace、Build、MySQL 与存储。
3. [模板与凭证](architecture/templates-and-credentials.md)：Terraform、Git/Tar 来源、Credential。
4. [Workbench](architecture/workbench.md)：前端交互、布局和终端。
5. [实施计划](architecture/implementation.md)：Monorepo、MVP 验收与待决事项。
6. [逐步推进计划](architecture/delivery-plan.md)：按里程碑执行的任务、产出和验收条件。

## 已确认的核心决策

- Go 二进制以 server、provisioner、agent-host 三种角色运行。
- Browser 和 Electron 都直接连接 Server；共用 packages/workbench。
- Agent Host 在 Workspace 内运行；它拥有 Session 状态与历史。
- Server 是控制平面和 AHP 网关，不保存任何 Session 状态、事件、快照或历史。
- Provisioner 主动连接 Server，并执行 Terraform。
- MySQL 8.0 + InnoDB 保存系统元数据；Terraform State、Secret、模板源码使用专门存储。
- Template 不提供显式版本化；Workspace 固定创建时的源码快照。
- Template 源码支持 Git 与 Tar URL。
- 第一阶段仅支持系统凭证。
- Workbench 不采用传统页面跳转；一个 Workspace 下显示多个 Session。
