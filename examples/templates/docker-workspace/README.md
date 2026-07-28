# Docker Workspace Template

This is Zaw's minimal Terraform Docker template. It creates a long-running
development container and returns its ID and name as Workspace resources. Its
home volume is persistent; `stop` sets the existing container's `must_run`
property to false, while `delete` runs Terraform destroy.

The Provisioner configures the local backend under `ZAW_TERRAFORM_STATE_DIR`.
Do not put backend credentials in this template or commit a local state file.

Publish this directory in a Git repository, then add it through Settings using
the repository URL, a ref, and `examples/templates/docker-workspace` as the
Template directory. A local Provisioner needs access to Docker and Terraform.
Set `ZAW_DOCKER_HOST` when Terraform must use a non-default Docker endpoint,
such as a rootless Docker socket.

## Agent Host injection

The Provisioner injects `zaw_workspace_id`, `zaw_workspace_running`, and
`zaw_workspace_transition`. The template forwards Agent Host values as
`ZAW_SERVER_URL`, `ZAW_WORKSPACE_ID`, `ZAW_WORKSPACE_DIR`, and
`ZAW_AGENT_PROVIDER` and `ZAW_COPILOT_CLI_PATH`. Supply `zaw_agent_command` only
in an image that already contains the `zaw` binary and GitHub Copilot CLI:

```hcl
zaw_agent_command    = "zaw agent-host"
zaw_server_url       = "ws://control-plane.internal:8080"
zaw_agent_provider   = "copilot"
zaw_copilot_cli_path = "/usr/local/bin/copilot"
```

Keeping the executable image-specific makes the template portable and avoids
putting a privileged Docker socket or model credentials into Terraform state.
The container supervises the command and enables authenticated runtime updates;
after an atomic update the Agent Host exits and the loop starts the new binary.
