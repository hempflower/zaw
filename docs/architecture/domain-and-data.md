# 领域与数据模型

## Workspace

Workspace 是长期存在的逻辑开发环境，不是一次 Terraform 执行，也不是一段聊天。

~~~
Workspace
├─ Source Snapshot（模板源码快照）
├─ Parameter Snapshot（参数快照）
├─ Workspace Build（多次生命周期执行）
├─ Workspace Resources（VM / Pod / Container / Volume / Network）
├─ Agent Host
└─ Session[]
~~~

建议模型：

~~~
Workspace {
  id, organizationId, projectId?, name, ownerId,
  templateId, sourceSnapshot, parameterValues,
  desiredState: running | stopped | deleted,
  observedState: pending | provisioning | running | stopping |
                 stopped | deleting | failed | degraded,
  currentBuildId?, agentHostStatus
}
~~~

规则：

- 一个 Workspace 可以有多个 Session。
- Session 仅在所属 Workspace 下展示。
- Workspace 停止或 Agent Host 离线时，Session 历史仍可查看，但不可执行新请求或创建终端。
- 停止是否释放计算资源、保留卷、缓存或网络资源由 Template 定义。
- Workspace 资源可重建；Workspace ID、权限和 Build 审计保留。

## Workspace Build

所有 Workspace 生命周期变化创建不可变 Build：

~~~
create | start | stop | reconfigure | rebuild-from-current-template | repair | delete
~~~

每条 Build 记录操作者、参数快照、目标 Provisioner、Terraform 日志位置、资源摘要、执行状态、错误信息和 Agent Host 注册结果。

## Agent Host 注册

MySQL 只保存 Agent Host 与 Workspace 的关联、最后遥测和在线状态。在线 WebSocket 注册表仅存在 Server 进程内，可直接丢失：

~~~
LiveAgentHostConnection {
  workspaceId, agentHostId, connectedAt, connection
}
~~~

## MySQL

MySQL 使用 8.0、InnoDB、utf8mb4 和 DATETIME(3)。ID 在第一条迁移前统一选择 ULID 字符串或 BINARY(16) UUID。

首批表：

~~~
organizations
users
memberships
templates
template_sources
template_parameters
workspaces
workspace_builds
workspace_resources
provisioners
provisioner_jobs
agent_hosts
credentials
audit_logs
~~~

不创建任何 Session 相关表。

## 存储边界

| 数据 | 存储位置 |
| --- | --- |
| 业务元数据、状态、审计 | MySQL |
| Terraform State | 独立远程 State Backend，例如 MinIO/S3 |
| Secret | Secret Manager |
| 模板文件 | Git 或 Tar URL |
| 临时 Terraform 工作目录 | Provisioner 节点临时磁盘，完成后清理 |
