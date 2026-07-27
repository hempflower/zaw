package terraformprovider

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestProviderLoadsThroughLocalTerraformCLI(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate Provider test")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../.."))
	directory := t.TempDir()
	providerDirectory := filepath.Join(directory, "providers")
	if err := os.Mkdir(providerDirectory, 0o700); err != nil {
		t.Fatalf("create Provider directory: %v", err)
	}
	providerBinary := filepath.Join(providerDirectory, "terraform-provider-zaw")
	build := exec.Command(
		"go",
		"build",
		"-o",
		providerBinary,
		"./cmd/terraform-provider-zaw",
	)
	build.Dir = repositoryRoot
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build Provider: %v\n%s", err, output)
	}
	cliConfig := `provider_installation {
  dev_overrides {
    "zaw.local/dev/zaw" = "` + providerDirectory + `"
  }
  direct {}
}
`
	cliConfigPath := filepath.Join(directory, "terraform.rc")
	if err := os.WriteFile(cliConfigPath, []byte(cliConfig), 0o600); err != nil {
		t.Fatalf("write Terraform CLI config: %v", err)
	}
	configuration := `terraform {
  required_providers {
    zaw = {
      source = "zaw.local/dev/zaw"
    }
  }
}

provider "zaw" {
  server_url         = "https://zaw.example"
  agent_host_base_url = "wss://zaw.example"
}

data "zaw_workspace" "current" {
  workspace_id = "workspace-cli"
  transition   = "stop"
}

resource "zaw_agent" "main" {
  workspace_id         = data.zaw_workspace.current.workspace_id
  workspace_transition = data.zaw_workspace.current.transition
  agent_provider       = "copilot"
  copilot_cli_path     = "/usr/local/bin/copilot"
  startup_script       = "echo ready"

  metadata {
    key      = "cpu"
    script   = "nproc"
    interval = 10
    timeout  = 2
  }
}

output "agent_id" {
  value = zaw_agent.main.id
}

output "desired_state" {
  value = zaw_agent.main.desired_state
}
`
	if err := os.WriteFile(
		filepath.Join(directory, "main.tf"),
		[]byte(configuration),
		0o600,
	); err != nil {
		t.Fatalf("write Terraform configuration: %v", err)
	}
	environment := append(
		os.Environ(),
		"TF_CLI_CONFIG_FILE="+cliConfigPath,
		"TF_IN_AUTOMATION=1",
	)
	runTerraform := func(arguments ...string) string {
		t.Helper()
		command := exec.Command("terraform", arguments...)
		command.Dir = directory
		command.Env = environment
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("terraform %s: %v\n%s", strings.Join(arguments, " "), err, output)
		}
		return string(output)
	}
	runTerraform("apply", "-auto-approve", "-input=false")
	agentID := strings.TrimSpace(runTerraform("output", "-raw", "agent_id"))
	if agentID != "workspace-cli/agent" {
		t.Fatalf("Provider Agent ID = %q", agentID)
	}
	desiredState := strings.TrimSpace(runTerraform("output", "-raw", "desired_state"))
	if desiredState != "stopped" {
		t.Fatalf("Provider desired state = %q", desiredState)
	}
	runTerraform("destroy", "-auto-approve", "-input=false")
}
