# Zaw Terraform Provider

`terraform-provider-zaw` is the template-facing provider. Its initial
`zaw_agent` resource mirrors Coder's agent injection pattern without exposing
a control-plane session or a long-lived credential in Terraform output.

```hcl
terraform {
  required_providers {
    zaw = { source = "zaw-dev/zaw" }
  }
}

provider "zaw" {}

data "zaw_workspace" "current" {}

resource "zaw_agent" "main" {
  workspace_id         = data.zaw_workspace.current.workspace_id
  workspace_transition = data.zaw_workspace.current.transition
  directory            = "/workspace"
  agent_provider        = "copilot"
  copilot_cli_path      = "/usr/local/bin/copilot"
  startup_script        = "./configure-workspace.sh"

  metadata {
    key          = "cpu"
    display_name = "CPU"
    script       = "nproc"
    interval     = 30
    timeout      = 5
  }
}
```

The Provisioner passes `ZAW_WORKSPACE_ID`, `ZAW_WORKSPACE_NAME`,
`ZAW_WORKSPACE_TRANSITION`, `ZAW_SERVER_URL`, and optionally
`ZAW_AGENT_HOST_BASE_URL` directly to every Terraform subprocess. These values
are control-plane context, not template variables. The data source rejects
missing or unsupported context instead of defaulting to a create operation.

The official templates use source address `zaw-dev/zaw` at version `0.2.x`.
Until a public Registry release exists, the Provisioner exposes its own `zaw`
executable under the expected Provider filename in a private filesystem mirror.
Terraform downloads all unrelated providers normally. A separately packaged
Provider can be selected with `ZAW_TERRAFORM_PROVIDER_BINARY`.

Attach `zaw_agent.main.environment` to the compute resource and use
`zaw_agent.main.init_script` as its entrypoint. The image must contain the
`zaw` executable and configured GitHub Copilot CLI. The provider has no token
attribute. A Provisioner obtains a Workspace-scoped registration credential for
its claimed Build and delivers it after `apply` through the runtime's protected
file channel. For the Incus template this is `incus file push` to
`/etc/zaw/registration.token`; it is not a Terraform input, output, State
value, URL, or command-line argument. The Agent Host reuses the protected
credential for reconnects and HTTP telemetry; there is no session-token
rotation protocol.

`zaw_agent.main.environment` contains only stable runtime configuration. The
current build transition is deliberately excluded so stop/start operations do
not rewrite cloud-init or container bootstrap configuration.

Model Provider、API base、API key 和逻辑 Model 均由 Server 管理，不是 Terraform
参数。Agent Host 使用 Workspace 注册凭证访问 Server 模型网关，上游 key 不会
进入模板、VM 环境或 Terraform State。

The Provider exposes the Workspace desired state separately from resource
existence. Templates must map a stop build to the runtime's stopped state while
keeping the VM and its Terraform resource in State. For Incus this means
stopping the existing instance, not applying `count = 0`. A start build starts
the same instance; only a delete build invokes Terraform destroy. Persistent
volumes and VM identity therefore survive stop/start cycles.

`zaw_workspace.current.running` is a boolean lifecycle input intended for a
provider property such as `incus_instance.running`. Unlike Coder's common
`start_count` pattern, Zaw deliberately does not expose a resource count because
using zero would remove the VM from Terraform State during stop.

The Agent resource follows the useful parts of
[Coder's Agent model](https://registry.terraform.io/providers/coder/coder/latest/docs/resources/agent): a stable
initialization script, explicit blocking/non-blocking startup behavior, timeout,
and periodic metadata definitions. Runtime readiness is still owned by Agent Host
and reported through Server; Terraform only emits the initial `pending`, `stopped`,
or `deleted` startup state. Metadata marked sensitive controls runtime display; a
secret must never be embedded in a metadata script because Terraform configuration
and State are not Secret stores.
