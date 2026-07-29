variable "zaw_agent_provider" {
  type        = string
  description = "Agent SDK provider used inside the VM."
  default     = "copilot"
}

variable "zaw_copilot_cli_path" {
  type        = string
  description = "GitHub Copilot CLI executable available inside the VM."
  default     = "copilot"
}

variable "zaw_agent_workspace_dir" {
  type        = string
  description = "Persistent workspace directory mounted into the VM."
  default     = "/workspace"
}

variable "zaw_install_command" {
  type        = string
  description = "Cloud-init command that installs the Agent Host and its runtime dependencies."
  default     = "curl -fsSL https://gh.io/copilot-install | VERSION=v1.0.75 PREFIX=/usr/local bash"
}

variable "zaw_agent_host_command" {
  type        = string
  description = "Command that starts the Agent Host after the zaw binary is installed."
  default     = "zaw agent-host"
}

variable "incus_profile" {
  type        = string
  description = "Existing Incus profile that supplies root disk and networking."
  default     = "default"
}

variable "incus_storage_pool" {
  type        = string
  description = "Existing Incus storage pool for the persistent workspace volume."
  default     = "default"
}

variable "image" {
  type        = string
  description = "Ubuntu 24.04 cloud VM image available from the local images remote."
  default     = "images:ubuntu/24.04/cloud"
}

variable "cpu" {
  type        = number
  description = "VM vCPU limit."
  default     = 2
}

variable "memory" {
  type        = string
  description = "VM memory limit."
  default     = "4GiB"
}
