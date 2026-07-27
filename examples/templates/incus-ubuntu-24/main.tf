terraform {
  required_version = ">= 1.6.0"

  required_providers {
    incus = {
      source  = "lxc/incus"
      version = "~> 1.1"
    }
  }

  backend "s3" {}
}

provider "incus" {}

locals {
  agent_environment = {
    ZAW_AGENT_PROVIDER                = var.zaw_agent_provider
    ZAW_SERVER_URL                    = var.zaw_server_url
    ZAW_WORKSPACE_DIR                 = var.zaw_agent_workspace_dir
    ZAW_WORKSPACE_ID                  = var.zaw_workspace_id
    ZAW_AGENT_REGISTRATION_TOKEN_FILE = "/etc/zaw/registration.token"
    ZAW_COPILOT_CLI_PATH              = var.zaw_copilot_cli_path
  }

  agent_environment_file = join("\n", [
    for name in sort(keys(local.agent_environment)) :
    "${name}=${jsonencode(local.agent_environment[name])}"
  ])

  agent_init_script = <<-SCRIPT
    #!/bin/sh
    set -eu
    exec ${var.zaw_agent_host_command} \\
      --server "$ZAW_SERVER_URL" \\
      --workspace-id "$ZAW_WORKSPACE_ID" \\
      --workspace-dir "$ZAW_WORKSPACE_DIR" \\
      --registration-token-file "$ZAW_AGENT_REGISTRATION_TOKEN_FILE" \\
      --agent-provider "$ZAW_AGENT_PROVIDER" \
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
        "command -v zaw >/dev/null 2>&1 && systemctl enable --now zaw-agent-host.service || true",
      ],
    )
  })}"
}

resource "incus_storage_volume" "workspace_data" {
  name = "zaw-${var.zaw_workspace_id}-workspace"
  pool = var.incus_storage_pool

  lifecycle {
    ignore_changes = all
  }
}

resource "incus_instance" "workspace" {
  name     = "zaw-${var.zaw_workspace_id}"
  image    = var.image
  profiles = [var.incus_profile]
  running  = var.zaw_workspace_running
  type     = "virtual-machine"

  config = {
    "boot.autostart"          = tostring(var.zaw_workspace_running)
    "cloud-init.user-data"    = local.cloud_config
    "limits.cpu"              = tostring(var.cpu)
    "limits.memory"           = var.memory
    "security.secureboot"     = "false"
    "user.zaw.workspace_id"   = var.zaw_workspace_id
    "user.zaw.workspace_name" = var.workspace_id
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
