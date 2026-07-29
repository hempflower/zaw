terraform {
  required_version = ">= 1.6.0"

  required_providers {
    zaw = {
      source  = "zaw-dev/zaw"
      version = "~> 0.2"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.6"
    }
  }

  backend "local" {}
}

provider "zaw" {}
provider "docker" {}

data "zaw_workspace" "current" {}

resource "zaw_agent" "main" {
  workspace_id         = data.zaw_workspace.current.workspace_id
  workspace_transition = data.zaw_workspace.current.transition
  directory            = var.zaw_agent_workspace_dir
  agent_provider       = var.zaw_agent_provider
  copilot_cli_path     = var.zaw_copilot_cli_path
  host_command         = var.zaw_agent_command == "" ? "zaw agent-host" : var.zaw_agent_command
}

locals {
  agent_environment = concat(
    [for name in sort(keys(zaw_agent.main.environment)) :
      "${name}=${zaw_agent.main.environment[name]}"
    ],
    var.zaw_agent_command == "" ? [] : ["ZAW_AGENT_COMMAND=${var.zaw_agent_command}"],
  )
}

resource "docker_volume" "workspace_home" {
  name = "zaw-${data.zaw_workspace.current.workspace_id}-home"

  labels {
    label = "zaw.workspace_id"
    value = data.zaw_workspace.current.workspace_id
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
  name  = "zaw-${data.zaw_workspace.current.workspace_id}"
  image = docker_image.workspace.image_id

  must_run = data.zaw_workspace.current.running

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
    value = data.zaw_workspace.current.workspace_id
  }
}

output "container_id" {
  value = docker_container.workspace.id
}

output "container_name" {
  value = docker_container.workspace.name
}
