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
  currentBuildId?, agentHostState
	  modelId?
}
~~~

规则：

- 一个 Workspace 可以有多个 Session。
- Session 通过 HTTP Catalog 按 Workspace 分组展示；窗口可同时列出多个
  Workspace，但实时区域只 attach 当前 Session 所属 Workspace。
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

Gorm 保存 Agent Host 与 Workspace 的关联、最后遥测和在线状态。在线
WebSocket 注册表仅存在 Server 进程内，可直接重建：

~~~
LiveAgentHostConnection {
  workspaceId, agentHostId, connectedAt, connection
}
~~~

## Gorm 与数据库

开发和单节点模式支持 SQLite，生产部署支持 MySQL 8.0。数据库通过环境
变量和 `.env` 选择。模型使用显式时间字段，不包含 `gorm.DeletedAt`，不启用
Gorm 软删除。

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
session_summaries
credentials
audit_logs
llm_providers
llm_models
~~~

`session_summaries` 是 HTTP Catalog 的轻量 Read Model，只保存 Workspace、
Session resource、标题、状态、活动描述、修改时间、观察时间、stale 标记和
可选 Changes 摘要。不得保存完整聊天消息、Terminal 输出、Changeset 内容、
AHP snapshot 或 action history。

## 存储边界

| 数据 | 存储位置 |
| --- | --- |
| 业务元数据、状态、审计、SessionSummary | SQLite / MySQL |
| Terraform State | Provisioner 本机持久目录，按 Workspace 隔离 |
| Secret | Local Secret Store |
| Model Provider API key | Local Secret Store；Gorm 仅保存 Secret reference |
| 模板文件 | Git 或 Tar URL |
| 临时 Terraform 工作目录 | Provisioner 节点临时磁盘，完成后清理 |
