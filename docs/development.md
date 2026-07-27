# 本地开发

Zaw 直接使用本机工具链编译和测试，不通过 Docker 构建项目。容器仅可作为
MySQL、MinIO 和 OpenBao 等可选开发依赖。

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

MySQL、MinIO 和 OpenBao 可由操作者自行安装，也可以仅把它们作为本地依赖运行
`task up`；这不会用容器编译 Go、TypeScript、Terraform Provider 或 Workbench。

数据库集成测试始终运行 SQLite；设置 `ZAW_MYSQL_TEST_DSN` 后，同一套 migration、
Repository、JSON、时间、唯一索引、事务和硬删除检查也会在 MySQL 上运行。CI 使用
临时 MySQL 服务执行该矩阵，但仍直接在 Runner 上编译项目。
