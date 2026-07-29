package terraformprovider

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	terra "github.com/zaw-dev/zaw/internal/infra/terraform"
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
		"./cmd/zaw",
	)
	build.Dir = repositoryRoot
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build Provider: %v\n%s", err, output)
	}
	cliConfigPath, err := terra.InstallBundledProvider(directory, providerBinary)
	if err != nil {
		t.Fatalf("install Provider mirror: %v", err)
	}
	configuration := `terraform {
  required_providers {
    zaw = {
      source  = "zaw-dev/zaw"
      version = "~> 0.2"
    }
  }
}

provider "zaw" {}

data "zaw_workspace" "current" {}

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
		"ZAW_SERVER_URL=https://zaw.example",
		"ZAW_AGENT_HOST_BASE_URL=wss://zaw.example",
		"ZAW_WORKSPACE_ID=workspace-cli",
		"ZAW_WORKSPACE_NAME=workspace-cli",
		"ZAW_WORKSPACE_TRANSITION=stop",
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
	runTerraform("init", "-input=false")
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
