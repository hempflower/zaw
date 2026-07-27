# Template 与 Credential

## Template 的版本语义

第一期不提供 Template Version、草稿/发布、活动版本、归档或版本升级 UI。

但 Workspace 创建时必须固定不可变 Source Snapshot：

~~~
Template 当前来源
  └─ 创建 Workspace
      └─ 固定 Source Snapshot
~~~
- 新 Workspace 使用 Template 当前来源。
- 已有 Workspace 永远使用原 Source Snapshot。
- 只有用户显式执行“按当前模板重建/更新”时，才使用新的来源快照。

## Terraform 定义

Template 使用标准 Terraform 加最小 zaw Terraform Provider；不引入重复描述资源、参数和生命周期的 YAML。

~~~
templates/go-agent/
├─ main.tf
├─ parameters.tf
├─ agent-host.tf
├─ variables.tf
├─ outputs.tf
├─ modules/
├─ scripts/
├─ README.md
└─ .terraform.lock.hcl
~~~

zaw Provider 需提供：

- zaw_workspace：Workspace ID、组织、Server URL 等上下文。
- zaw_parameter：创建 Workspace 时 Workbench 展示的参数定义。
- zaw_agent_host：Agent Host、Agent SDK、工具能力和运行时契约声明。

模板不得写入全局 Server Token、SSH 私钥、云密钥或其他 Secret。Agent Host
使用 Provisioner 注入且仅限单个 Workspace 的注册凭证，不增加 session token
轮换协议。

## 参数类别

| 类别 | 设置者 | 例子 |
| --- | --- | --- |
| Workspace Parameter | Workspace 创建者 | CPU、内存、镜像、仓库 |
| Preset | 模板管理员 | 标准 Go、GPU 大型 |
| Template Variable | 模板/平台管理员 | 网络 ID、镜像仓库、云配置 |
| Runtime Secret | Server/Secret Manager | Git Token、Workspace 注册凭据 |

Secret 不得进入 Terraform 明文参数、输出或 State。

## Git Source

~~~
GitSource {
  kind: git
  url
  ref
  directory
  credentialId?
}

GitSourceSnapshot {
  kind: git
  url
  directory
  commit
}
~~~

创建 Workspace 时，Server 将 ref（如 main）解析为完整 commit SHA；Workspace 固定该 SHA；Provisioner 以 detached HEAD checkout。

约束：

- 不得只保存分支名或 tag。
- 模板仓库必须保留历史 commit，避免强制推送。
- Module 固定版本或 commit，.terraform.lock.hcl 必须提交。
- Server/Provisioner 可有 Git mirror 缓存，但缓存不是源码事实来源。

## Tar URL Source

~~~
TarSource {
  kind: tar
  url
  sha256?             // 模板作者选填
  format?: tar.gz | tar.zst | tar
  directory?
}

TarSourceSnapshot {
  kind: tar
  url
  sha256              // 系统解析后必填
  format
  directory?
}
~~~

提供 SHA 时系统校验；未提供时系统下载并计算。Workspace 始终固定 URL 与实际 SHA-256；之后下载摘要不匹配必须失败。

Tar 下载与解包必须限制文件大小、压缩比、重定向次数，并拒绝绝对路径、../ 路径、设备文件和符号链接逃逸。URL 需受出站访问限制以防 SSRF。私有 URL 通过系统凭证访问，Token 不得出现于 URL 或日志。

## Credential 系统

Credential 是 Server 内独立系统，可供 Git、Terraform、镜像仓库及未来外部服务复用。第一期仅支持系统凭证。

- 组织管理员创建、编辑和删除凭证。
- Template 可引用 credentialId。
- 普通用户不能在创建 Workspace 时选择任意 Credential。
- Provisioner 仅在授权 Build 中获取短期 Credential Lease。

凭证按认证形态区分：

~~~
CredentialKind =
  username_password
  token
  ssh_key

Credential {
  id, organizationId, name, kind, metadata
}
~~~

| 类型 | metadata |
| --- | --- |
| username_password | username |
| token | 空对象 |
| ssh_key | username、publicKey、fingerprint |

密码、Token、私钥和私钥密码只存在 Secret Manager。secretRef 仅是 Credential 系统内部对 Secret Manager 的引用，不暴露给 Workbench、Template 或普通业务 API。

Git 映射：

~~~
HTTPS Basic Auth  → username_password
HTTPS PAT / OAuth → token
SSH Git URL       → ssh_key
公共仓库           → 无 Credential
~~~
