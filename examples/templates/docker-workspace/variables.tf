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
