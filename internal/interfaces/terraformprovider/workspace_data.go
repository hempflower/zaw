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
		SchemaVersion: 1,
		ReadContext:   readWorkspace,
		Schema: map[string]*schema.Schema{
			"workspace_id": {
				Type:     schema.TypeString,
				Computed: true,
			},
			"name": {
				Type:     schema.TypeString,
				Computed: true,
			},
			"transition": {
				Type:     schema.TypeString,
				Computed: true,
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
	workspaceID := config.workspaceID
	transition := config.workspaceTransition
	desiredState, err := workspaceDesiredState(transition)
	if err != nil {
		return diag.FromErr(err)
	}
	running, err := workspaceRunning(transition)
	if err != nil {
		return diag.FromErr(err)
	}
	values := map[string]any{
		"workspace_id":   workspaceID,
		"name":           config.workspaceName,
		"transition":     transition,
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
