package terraformprovider

import (
	"context"
	"fmt"
	"path"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func workspaceDataSource() *schema.Resource {
	return &schema.Resource{
		ReadContext: readWorkspace,
		Schema: map[string]*schema.Schema{
			"workspace_id": {
				Type:        schema.TypeString,
				Optional:    true,
				DefaultFunc: schema.EnvDefaultFunc("ZAW_WORKSPACE_ID", nil),
			},
			"name": {
				Type:        schema.TypeString,
				Optional:    true,
				DefaultFunc: schema.EnvDefaultFunc("ZAW_WORKSPACE_NAME", ""),
			},
			"transition": {
				Type:        schema.TypeString,
				Optional:    true,
				DefaultFunc: schema.EnvDefaultFunc("ZAW_WORKSPACE_TRANSITION", transitionCreate),
			},
			"desired_state": {Type: schema.TypeString, Computed: true},
			"running":       {Type: schema.TypeBool, Computed: true},
			"server_url":    {Type: schema.TypeString, Computed: true},
			"agent_host_url": {
				Type:     schema.TypeString,
				Computed: true,
			},
		},
	}
}

func readWorkspace(
	_ context.Context,
	data *schema.ResourceData,
	meta any,
) diag.Diagnostics {
	config, ok := meta.(configuration)
	if !ok {
		return diag.Errorf("zaw provider configuration is unavailable")
	}
	workspaceID := data.Get("workspace_id").(string)
	if workspaceID == "" {
		return diag.Errorf("zaw_workspace requires workspace_id or ZAW_WORKSPACE_ID")
	}
	transition := data.Get("transition").(string)
	desiredState, err := workspaceDesiredState(transition)
	if err != nil {
		return diag.FromErr(err)
	}
	running, err := workspaceRunning(transition)
	if err != nil {
		return diag.FromErr(err)
	}
	values := map[string]any{
		"desired_state":  desiredState,
		"running":        running,
		"server_url":     config.serverURL,
		"agent_host_url": config.agentHostURL(workspaceID),
	}
	for name, value := range values {
		if err := data.Set(name, value); err != nil {
			return diag.FromErr(fmt.Errorf("set Workspace %s: %w", name, err))
		}
	}
	data.SetId(workspaceID)
	return nil
}

func (c configuration) agentHostURL(workspaceID string) string {
	baseURL := c.agentHostBaseURL
	if baseURL == "" {
		baseURL = c.serverURL
	}
	return baseURL + "/" + path.Join(
		"api/v1/agent-hosts",
		workspaceID,
		"ahp",
	)
}
