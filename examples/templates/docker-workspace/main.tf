terraform {
  required_version = ">= 1.6.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.6"
    }
  }

  backend "local" {}
}

provider "docker" {}

locals {
  agent_environment = concat(
    [
      "ZAW_SERVER_URL=${var.zaw_server_url}",
      "ZAW_WORKSPACE_ID=${var.zaw_workspace_id}",
      "ZAW_WORKSPACE_DIR=${var.zaw_agent_workspace_dir}",
      "ZAW_AGENT_PROVIDER=${var.zaw_agent_provider}",
      "ZAW_AGENT_AUTO_UPDATE=true",
      "ZAW_COPILOT_CLI_PATH=${var.zaw_copilot_cli_path}",
      "ZAW_WORKSPACE_TRANSITION=${var.zaw_workspace_transition}",
    ],
    var.zaw_agent_command == "" ? [] : ["ZAW_AGENT_COMMAND=${var.zaw_agent_command}"],
  )
}

resource "docker_volume" "workspace_home" {
  name = "zaw-${var.zaw_workspace_id}-home"

  labels {
    label = "zaw.workspace_id"
    value = var.zaw_workspace_id
  }

  lifecycle {
    ignore_changes = all
  }
}

resource "docker_image" "workspace" {
  name         = var.image
  keep_locally = false
}

resource "docker_container" "workspace" {
  name  = "zaw-${var.zaw_workspace_id}"
  image = docker_image.workspace.image_id

  must_run = var.zaw_workspace_running

  command = [
    "sh",
    "-ec",
    <<-SCRIPT
      if [ -n "$${ZAW_AGENT_COMMAND:-}" ]; then
        (
          while true; do
            sh -c "$${ZAW_AGENT_COMMAND}" || true
            sleep 5
          done
        ) &
      fi
      exec sleep infinity
    SCRIPT
  ]

  env = local.agent_environment

  volumes {
    volume_name    = docker_volume.workspace_home.name
    container_path = var.zaw_agent_workspace_dir
  }

  labels {
    label = "zaw.workspace_id"
    value = var.zaw_workspace_id
  }
}

output "container_id" {
  value = docker_container.workspace.id
}

output "container_name" {
  value = docker_container.workspace.name
}
