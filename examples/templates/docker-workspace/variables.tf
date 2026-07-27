variable "workspace_id" {
  type        = string
  description = "The immutable Zaw Workspace identifier."
}

variable "zaw_workspace_id" {
  type        = string
  description = "The immutable Zaw Workspace identifier injected by the Provisioner."
}

variable "zaw_workspace_running" {
  type        = bool
  description = "Whether the existing container should be running; delete uses terraform destroy."
  default     = true
}

variable "zaw_workspace_transition" {
  type        = string
  description = "The control-plane operation currently being applied."
  default     = "create"
}

variable "zaw_server_url" {
  type        = string
  description = "Control-plane URL available to an Agent Host inside the workspace."
  default     = ""
}

variable "zaw_agent_workspace_dir" {
  type        = string
  description = "Working directory passed to the Agent Host."
  default     = "/workspace"
}

variable "zaw_agent_provider" {
  type        = string
  description = "Agent SDK provider used by the Agent Host."
  default     = "copilot"
}

variable "zaw_copilot_cli_path" {
  type        = string
  description = "GitHub Copilot CLI executable in the workspace image."
  default     = "copilot"
}

variable "zaw_agent_command" {
  type        = string
  description = "Optional command that starts zaw agent-host in the workspace image."
  default     = ""
}

variable "image" {
  type        = string
  description = "Container image for the development workspace."
  default     = "alpine:3.21"
}
