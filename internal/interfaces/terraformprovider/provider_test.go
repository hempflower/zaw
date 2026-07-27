package terraformprovider

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func TestProviderExposesAgentInjectionResource(t *testing.T) {
	provider := Provider()
	if err := provider.InternalValidate(); err != nil {
		t.Fatalf("provider schema is invalid: %v", err)
	}
	if provider.ResourcesMap["zaw_agent"] == nil {
		t.Fatal("zaw_agent resource is not registered")
	}
	if provider.Schema["server_url"] == nil {
		t.Fatal("server_url provider configuration is not registered")
	}
	if provider.DataSourcesMap["zaw_workspace"] == nil {
		t.Fatal("zaw_workspace data source is not registered")
	}
	if provider.ResourcesMap["zaw_agent"].Schema["metadata"] == nil {
		t.Fatal("Agent metadata schema is not registered")
	}
}

func TestAgentLifecycleAndMetadata(t *testing.T) {
	resource := agentResource()
	data := schema.TestResourceDataRaw(t, resource.Schema, map[string]any{
		"workspace_id":         "workspace-1",
		"workspace_transition": "create",
		"agent_provider":       "copilot",
		"copilot_cli_path":     "/usr/local/bin/copilot",
		"startup_script":       "echo ready",
		"metadata": []any{map[string]any{
			"key":          "cpu",
			"display_name": "CPU",
			"script":       "nproc",
			"interval":     10,
			"timeout":      2,
		}},
	})
	diagnostics := agentCreate(
		context.Background(),
		data,
		configuration{
			serverURL:        "https://zaw.example",
			agentHostBaseURL: "wss://zaw.example",
		},
	)
	if diagnostics.HasError() {
		t.Fatalf("create Agent: %v", diagnostics)
	}
	if data.Id() != "workspace-1/agent" {
		t.Fatalf("Agent ID = %q", data.Id())
	}
	if data.Get("desired_state") != "running" || data.Get("startup_state") != "pending" {
		t.Fatalf(
			"Agent create state = %q/%q",
			data.Get("desired_state"),
			data.Get("startup_state"),
		)
	}
	if err := data.Set("workspace_transition", "stop"); err != nil {
		t.Fatalf("set stop transition: %v", err)
	}
	diagnostics = agentRead(
		context.Background(),
		data,
		configuration{
			serverURL:        "https://zaw.example",
			agentHostBaseURL: "wss://zaw.example",
		},
	)
	if diagnostics.HasError() {
		t.Fatalf("update Agent to stopped: %v", diagnostics)
	}
	if data.Id() != "workspace-1/agent" {
		t.Fatalf("stop removed Agent from State: %q", data.Id())
	}
	if data.Get("desired_state") != "stopped" || data.Get("startup_state") != "stopped" {
		t.Fatalf(
			"Agent stop state = %q/%q",
			data.Get("desired_state"),
			data.Get("startup_state"),
		)
	}
	if data.Get("agent_host_url") != "wss://zaw.example/api/v1/agent-hosts/workspace-1/ahp" {
		t.Fatalf("Agent Host URL = %q", data.Get("agent_host_url"))
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(data.Get("agent_config_json").(string)), &config); err != nil {
		t.Fatalf("decode Agent config: %v", err)
	}
	metadata, ok := config["metadata"].([]any)
	if !ok || len(metadata) != 1 {
		t.Fatalf("Agent metadata = %#v", config["metadata"])
	}
	initScript := data.Get("init_script").(string)
	if !strings.Contains(initScript, "timeout 900") ||
		!strings.Contains(initScript, "exec zaw agent-host") {
		t.Fatalf("Agent init script = %s", initScript)
	}
	if diagnostics := agentDelete(context.Background(), data, nil); diagnostics.HasError() {
		t.Fatalf("delete Agent: %v", diagnostics)
	}
	if data.Id() != "" {
		t.Fatalf("Agent remains in State after delete: %q", data.Id())
	}
}

func TestWorkspaceDataSourceMapsLifecycle(t *testing.T) {
	data := schema.TestResourceDataRaw(t, workspaceDataSource().Schema, map[string]any{
		"workspace_id": "workspace-1",
		"transition":   "stop",
	})
	diagnostics := readWorkspace(
		context.Background(),
		data,
		configuration{serverURL: "https://zaw.example"},
	)
	if diagnostics.HasError() {
		t.Fatalf("read Workspace: %v", diagnostics)
	}
	if data.Id() != "workspace-1" || data.Get("desired_state") != "stopped" {
		t.Fatalf("Workspace State = %q/%q", data.Id(), data.Get("desired_state"))
	}
	if data.Get("running") != false {
		t.Fatalf("stopped Workspace running = %v", data.Get("running"))
	}
}

func TestWorkspaceLifecycleMapping(t *testing.T) {
	for _, transition := range workspaceTransitions() {
		desiredState, err := workspaceDesiredState(transition)
		if err != nil {
			t.Fatalf("map %q: %v", transition, err)
		}
		if transition == transitionStop && desiredState != "stopped" {
			t.Fatalf("stop desired state = %q", desiredState)
		}
		if transition == transitionDelete && desiredState != "deleted" {
			t.Fatalf("delete desired state = %q", desiredState)
		}
	}
	if _, err := workspaceDesiredState("unknown"); err == nil {
		t.Fatal("unknown transition was accepted")
	}
}

func TestAgentInitializationIncludesCopilotSDKConfiguration(t *testing.T) {
	data := schema.TestResourceDataRaw(t, agentResource().Schema, map[string]any{
		"workspace_id":     "workspace-1",
		"agent_provider":   "copilot",
		"copilot_cli_path": "/usr/local/bin/copilot",
	})
	diagnostics := setAgentOutputs(data, configuration{serverURL: "https://zaw.example"})
	if diagnostics.HasError() {
		t.Fatalf("set agent outputs: %v", diagnostics)
	}
	initScript := data.Get("init_script").(string)
	if !strings.Contains(initScript, "--agent-provider \"$ZAW_AGENT_PROVIDER\"") ||
		!strings.Contains(initScript, "--copilot-cli \"$ZAW_COPILOT_CLI_PATH\"") {
		t.Fatalf("agent init script does not pass Copilot SDK configuration: %s", initScript)
	}
	if !strings.Contains(
		initScript,
		"--registration-token-file \"$ZAW_AGENT_REGISTRATION_TOKEN_FILE\"",
	) {
		t.Fatalf("agent init script does not read the credential file: %s", initScript)
	}
}
