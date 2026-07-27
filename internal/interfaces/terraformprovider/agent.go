package terraformprovider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/validation"
)

func agentResource() *schema.Resource {
	return &schema.Resource{
		CreateContext: agentCreate,
		ReadContext:   agentRead,
		UpdateContext: agentRead,
		DeleteContext: agentDelete,
		Schema: map[string]*schema.Schema{
			"workspace_id": {
				Type:     schema.TypeString,
				Required: true,
				ForceNew: true,
			},
			"workspace_transition": {
				Type:     schema.TypeString,
				Optional: true,
				DefaultFunc: schema.EnvDefaultFunc(
					"ZAW_WORKSPACE_TRANSITION",
					transitionCreate,
				),
				ValidateFunc: validation.StringInSlice(workspaceTransitions(), false),
			},
			"os": {
				Type:         schema.TypeString,
				Optional:     true,
				Default:      "linux",
				ValidateFunc: validation.StringInSlice([]string{"linux"}, false),
			},
			"arch": {
				Type:     schema.TypeString,
				Optional: true,
				Default:  "amd64",
				ValidateFunc: validation.StringInSlice(
					[]string{"amd64", "arm64"},
					false,
				),
			},
			"directory": {
				Type:     schema.TypeString,
				Optional: true,
				Default:  "/workspace",
			},
			"agent_provider": {
				Type:         schema.TypeString,
				Optional:     true,
				Default:      "copilot",
				ValidateFunc: validation.StringInSlice([]string{"copilot"}, false),
			},
			"copilot_cli_path": {
				Type:     schema.TypeString,
				Optional: true,
				Default:  "copilot",
			},
			"host_command": {
				Type:     schema.TypeString,
				Optional: true,
				Default:  "zaw agent-host",
			},
			"registration_token_file": {
				Type:     schema.TypeString,
				Optional: true,
				Default:  "/etc/zaw/registration.token",
			},
			"startup_script": {
				Type:     schema.TypeString,
				Optional: true,
			},
			"startup_script_behavior": {
				Type:         schema.TypeString,
				Optional:     true,
				Default:      "blocking",
				ValidateFunc: validation.StringInSlice([]string{"blocking", "non-blocking"}, false),
			},
			"startup_script_timeout": {
				Type:         schema.TypeInt,
				Optional:     true,
				Default:      900,
				ValidateFunc: validation.IntAtLeast(0),
			},
			"metadata": agentMetadataSchema(),
			"desired_state": {
				Type:     schema.TypeString,
				Computed: true,
			},
			"startup_state": {
				Type:     schema.TypeString,
				Computed: true,
			},
			"server_url": {
				Type:     schema.TypeString,
				Computed: true,
			},
			"agent_host_url": {
				Type:     schema.TypeString,
				Computed: true,
			},
			"environment": {
				Type:     schema.TypeMap,
				Computed: true,
				Elem:     &schema.Schema{Type: schema.TypeString},
			},
			"agent_config_json": {
				Type:      schema.TypeString,
				Computed:  true,
				Sensitive: true,
			},
			"init_script": {
				Type:     schema.TypeString,
				Computed: true,
			},
		},
	}
}

func agentMetadataSchema() *schema.Schema {
	return &schema.Schema{
		Type:     schema.TypeList,
		Optional: true,
		Elem: &schema.Resource{Schema: map[string]*schema.Schema{
			"key": {
				Type:     schema.TypeString,
				Required: true,
			},
			"display_name": {
				Type:     schema.TypeString,
				Optional: true,
			},
			"script": {
				Type:     schema.TypeString,
				Required: true,
			},
			"interval": {
				Type:         schema.TypeInt,
				Optional:     true,
				Default:      30,
				ValidateFunc: validation.IntAtLeast(1),
			},
			"timeout": {
				Type:         schema.TypeInt,
				Optional:     true,
				Default:      5,
				ValidateFunc: validation.IntAtLeast(1),
			},
			"sensitive": {
				Type:     schema.TypeBool,
				Optional: true,
				Default:  false,
			},
		}},
	}
}

func agentCreate(
	ctx context.Context,
	data *schema.ResourceData,
	meta any,
) diag.Diagnostics {
	if diagnostics := agentRead(ctx, data, meta); diagnostics.HasError() {
		return diagnostics
	}
	workspaceID := data.Get("workspace_id").(string)
	data.SetId(workspaceID + "/agent")
	return nil
}

func agentRead(
	_ context.Context,
	data *schema.ResourceData,
	meta any,
) diag.Diagnostics {
	config, ok := meta.(configuration)
	if !ok {
		return diag.Errorf("zaw provider configuration is unavailable")
	}
	return setAgentOutputs(data, config)
}

func agentDelete(
	_ context.Context,
	data *schema.ResourceData,
	_ any,
) diag.Diagnostics {
	data.SetId("")
	return nil
}

func setAgentOutputs(data *schema.ResourceData, config configuration) diag.Diagnostics {
	workspaceID := data.Get("workspace_id").(string)
	transition := data.Get("workspace_transition").(string)
	desiredState, err := workspaceDesiredState(transition)
	if err != nil {
		return diag.FromErr(err)
	}
	startupState := "pending"
	if desiredState != "running" {
		startupState = desiredState
	}
	environment := map[string]string{
		"ZAW_AGENT_PROVIDER":                data.Get("agent_provider").(string),
		"ZAW_AGENT_HOST_URL":                config.agentHostURL(workspaceID),
		"ZAW_AGENT_REGISTRATION_TOKEN_FILE": data.Get("registration_token_file").(string),
		"ZAW_COPILOT_CLI_PATH":              data.Get("copilot_cli_path").(string),
		"ZAW_SERVER_URL":                    config.serverURL,
		"ZAW_WORKSPACE_DIR":                 data.Get("directory").(string),
		"ZAW_WORKSPACE_ID":                  workspaceID,
		"ZAW_WORKSPACE_TRANSITION":          transition,
	}
	agentConfig, err := json.Marshal(map[string]any{
		"arch":          data.Get("arch"),
		"metadata":      data.Get("metadata"),
		"os":            data.Get("os"),
		"startupScript": data.Get("startup_script"),
	})
	if err != nil {
		return diag.FromErr(fmt.Errorf("encode Agent config: %w", err))
	}
	values := map[string]any{
		"agent_config_json": string(agentConfig),
		"agent_host_url":    config.agentHostURL(workspaceID),
		"desired_state":     desiredState,
		"environment":       environment,
		"init_script":       buildAgentInitScript(data),
		"server_url":        config.serverURL,
		"startup_state":     startupState,
	}
	for name, value := range values {
		if err := data.Set(name, value); err != nil {
			return diag.FromErr(fmt.Errorf("set Agent %s: %w", name, err))
		}
	}
	return nil
}

func buildAgentInitScript(data *schema.ResourceData) string {
	lines := []string{"#!/bin/sh", "set -eu", "umask 077"}
	startupScript := data.Get("startup_script").(string)
	if startupScript != "" {
		encoded := base64.StdEncoding.EncodeToString([]byte(startupScript))
		lines = append(
			lines,
			`startup_path="${TMPDIR:-/tmp}/zaw-workspace-startup.sh"`,
			"printf '%s' '"+encoded+"' | base64 -d > \"$startup_path\"",
			`chmod 0700 "$startup_path"`,
		)
		startupCommand := `"$startup_path"`
		timeout := data.Get("startup_script_timeout").(int)
		if timeout > 0 {
			startupCommand = "timeout " + strconv.Itoa(timeout) + " " + startupCommand
		}
		if data.Get("startup_script_behavior").(string) == "non-blocking" {
			startupCommand = "(" + startupCommand + ") &"
		}
		lines = append(lines, startupCommand)
	}
	lines = append(
		lines,
		"exec "+data.Get("host_command").(string)+" \\",
		`  --server "$ZAW_SERVER_URL" \`,
		`  --workspace-id "$ZAW_WORKSPACE_ID" \`,
		`  --workspace-dir "$ZAW_WORKSPACE_DIR" \`,
		`  --registration-token-file "$ZAW_AGENT_REGISTRATION_TOKEN_FILE" \`,
		`  --agent-provider "$ZAW_AGENT_PROVIDER" \`,
		`  --copilot-cli "$ZAW_COPILOT_CLI_PATH"`,
	)
	return strings.Join(lines, "\n") + "\n"
}

func workspaceTransitions() []string {
	return []string{
		transitionCreate,
		transitionStart,
		transitionStop,
		transitionReconfigure,
		transitionRebuild,
		transitionRepair,
		transitionDelete,
	}
}
