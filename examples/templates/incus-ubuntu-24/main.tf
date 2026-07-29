terraform {
  required_version = ">= 1.6.0"

  required_providers {
    zaw = {
      source  = "zaw-dev/zaw"
      version = "~> 0.2"
    }
    incus = {
      source  = "lxc/incus"
      version = "~> 1.1"
    }
  }

  backend "local" {}
}

provider "zaw" {}
provider "incus" {}

data "zaw_workspace" "current" {}

resource "zaw_agent" "main" {
  workspace_id         = data.zaw_workspace.current.workspace_id
  workspace_transition = data.zaw_workspace.current.transition
  directory            = var.zaw_agent_workspace_dir
  agent_provider       = var.zaw_agent_provider
  copilot_cli_path     = var.zaw_copilot_cli_path
  host_command         = var.zaw_agent_host_command
}

locals {
  agent_environment_file = join("\n", [
    for name in sort(keys(zaw_agent.main.environment)) :
    "${name}=${jsonencode(zaw_agent.main.environment[name])}"
  ])

  agent_init_script = <<-SCRIPT
    #!/bin/sh
    set -eu
    runtime_base=$(printf '%s' "$ZAW_SERVER_URL" | sed \
      -e 's#^ws://#http://#' -e 's#^wss://#https://#' -e 's#/$##')
    runtime_arch=$(uname -m | sed -e 's/^x86_64$/amd64/' -e 's/^aarch64$/arm64/')
    runtime_url="$runtime_base/downloads/zaw/linux/$runtime_arch"
    runtime_update="/usr/local/bin/.zaw-update.$$"
    runtime_headers="/tmp/zaw-runtime-headers.$$"
    trap 'rm -f "$runtime_update" "$runtime_headers"' EXIT
    curl -fsS -D "$runtime_headers" -o "$runtime_update" "$runtime_url"
    runtime_expected=$(awk \
      'tolower($1)=="x-zaw-runtime-sha256:" {gsub("\\r", "", $2); print tolower($2)}' \
      "$runtime_headers")
    runtime_actual=$(sha256sum "$runtime_update" | awk '{print $1}')
    test -n "$runtime_expected"
    test "$runtime_actual" = "$runtime_expected"
    chmod 0755 "$runtime_update"
    mv "$runtime_update" /usr/local/bin/zaw
    rm -f "$runtime_headers"
    trap - EXIT
    exec ${var.zaw_agent_host_command} \\
      --server "$ZAW_SERVER_URL" \\
      --workspace-id "$ZAW_WORKSPACE_ID" \\
      --workspace-dir "$ZAW_WORKSPACE_DIR" \\
      --registration-token-file "$ZAW_AGENT_REGISTRATION_TOKEN_FILE" \\
      --agent-provider "$ZAW_AGENT_PROVIDER" \\
      --auto-update \\
      --copilot-cli "$ZAW_COPILOT_CLI_PATH"
  SCRIPT

  cloud_config = "#cloud-config\n${yamlencode({
    write_files = [
      {
        path        = "/etc/zaw/agent.env"
        permissions = "0600"
        content     = local.agent_environment_file
      },
      {
        path        = "/usr/local/lib/zaw/agent-init.sh"
        permissions = "0755"
        content     = local.agent_init_script
      },
      {
        path        = "/etc/systemd/system/zaw-agent-host.service"
        permissions = "0644"
        content     = <<-SERVICE
          [Unit]
          Description=Zaw Agent Host
          After=network-online.target
          Wants=network-online.target
          ConditionPathExists=/etc/zaw/registration.token

          [Service]
          Type=simple
          EnvironmentFile=/etc/zaw/agent.env
          WorkingDirectory=${var.zaw_agent_workspace_dir}
          ExecStart=/usr/local/lib/zaw/agent-init.sh
          Restart=always
          RestartSec=5

          [Install]
          WantedBy=multi-user.target
        SERVICE
      },
    ]
    runcmd = concat(
      var.zaw_install_command == "" ? [] : [var.zaw_install_command],
      [
        "install -d -o ubuntu -g ubuntu ${var.zaw_agent_workspace_dir}",
        "systemctl daemon-reload",
        "systemctl enable zaw-agent-host.service",
      ],
    )
  })}"
}

resource "incus_storage_volume" "workspace_data" {
  name = "zaw-${data.zaw_workspace.current.workspace_id}-workspace"
  pool = var.incus_storage_pool

  lifecycle {
    ignore_changes = all
  }
}

resource "incus_instance" "workspace" {
  name     = "zaw-${data.zaw_workspace.current.workspace_id}"
  image    = var.image
  profiles = [var.incus_profile]
  running  = data.zaw_workspace.current.running
  type     = "virtual-machine"

  config = {
    "boot.autostart"          = tostring(data.zaw_workspace.current.running)
    "cloud-init.user-data"    = local.cloud_config
    "limits.cpu"              = tostring(var.cpu)
    "limits.memory"           = var.memory
    "security.secureboot"     = "false"
    "user.zaw.workspace_id"   = data.zaw_workspace.current.workspace_id
    "user.zaw.workspace_name" = data.zaw_workspace.current.name
  }

  device {
    name = "workspace-data"
    type = "disk"

    properties = {
      path   = var.zaw_agent_workspace_dir
      pool   = var.incus_storage_pool
      source = incus_storage_volume.workspace_data.name
    }
  }

  wait_for {
    type = "cloud-init"
  }
}

output "instance_name" {
  value = incus_instance.workspace.name
}

output "ipv4_address" {
  value = incus_instance.workspace.ipv4_address
}
