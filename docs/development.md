# 本地开发

Zaw 直接使用本机工具链编译和测试，不通过 Docker 构建项目。MySQL 是唯一的
可选容器依赖；使用 SQLite 时不需要启动任何容器。

## 工具版本

最低基线与 CI 保持一致：

- Go 1.24.x
- Node.js 24.x，以及项目 `packageManager` 指定的 pnpm 10.13.1
- Terraform 1.11.4
- Task 3.44 或更高版本
- Incus 6.x，仅在开发 Incus Workspace Template 时需要

启用 pnpm 并安装依赖：

```sh
corepack enable
task deps -- --frozen-lockfile
```

## 统一任务入口

所有本机和 CI 工作流均从 `Taskfile.yml` 进入：

```sh
task fmt
task lint
task test
task build
task check-protocols
```

`task lint` 同时检查 Go 格式、Terraform 格式、前端 Prettier 格式、Go Vet、
TypeScript 类型和 100 字符源码行宽。`task test-e2e` 是端到端测试的固定入口，
`task screenshots` 是 M25 接入 Workbench 截图自动化的固定入口。

## 本地配置

将 `.env.example` 复制为 `.env`。Server 自动加载它，并可通过
`ZAW_DATABASE_DRIVER` 在 SQLite 与 MySQL 间切换。快速启动时建议使用 SQLite：

```dotenv
ZAW_DATABASE_DRIVER=sqlite
ZAW_DATABASE_DSN=./.data/zaw.db
```

MySQL 可由操作者自行安装，也可以通过 `task up` 作为本地依赖运行；这不会用
容器编译 Go、TypeScript、Terraform Provider 或 Workbench。上游模型密钥和
模板源凭据由 Server 以 `0700` 目录、`0600` 文件保存在
`ZAW_SECRET_STORE_DIR`（默认 `.data/secrets`）。

## Incus VM 经 Meta TUN 联网

本机使用 Clash/Mihomo Meta TUN 时，运行以下一次性安装任务：

```sh
task install-meta-routing
```

该任务安装并启用 `zaw-incus-meta-routing.service`。服务把默认 Incus VM 子网
`10.99.0.0/24` 导入 Meta 的 `2022` 路由表，并在 Docker 的 `DOCKER-USER` 链中
放行 Incus 转发。Workspace Template 不包含代理地址或代理环境变量。

不同网络布局可在 `/etc/default/zaw-incus-meta-routing` 中覆盖
`ZAW_VM_CIDR`、`ZAW_VM_BRIDGE`、`ZAW_META_INTERFACE` 和
`ZAW_META_ROUTE_TABLE`，随后重启该服务。

数据库集成测试始终运行 SQLite；设置 `ZAW_MYSQL_TEST_DSN` 后，同一套 migration、
Repository、JSON、时间、唯一索引、事务和硬删除检查也会在 MySQL 上运行。CI 使用
临时 MySQL 服务执行该矩阵，但仍直接在 Runner 上编译项目。
