package terraformprovider

import (
	"context"
	"os"
	"strings"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/plugin"
)

type configuration struct {
	serverURL           string
	agentHostBaseURL    string
	workspaceID         string
	workspaceName       string
	workspaceTransition string
}

func Serve() {
	plugin.Serve(&plugin.ServeOpts{ProviderFunc: Provider})
}

func Provider() *schema.Provider {
	return &schema.Provider{
		Schema: map[string]*schema.Schema{
			"server_url": {
				Type:        schema.TypeString,
				Optional:    true,
				DefaultFunc: schema.EnvDefaultFunc("ZAW_SERVER_URL", nil),
			},
			"agent_host_base_url": {
				Type:        schema.TypeString,
				Optional:    true,
				DefaultFunc: schema.EnvDefaultFunc("ZAW_AGENT_HOST_BASE_URL", nil),
			},
		},
		ResourcesMap: map[string]*schema.Resource{
			"zaw_agent": agentResource(),
		},
		DataSourcesMap: map[string]*schema.Resource{
			"zaw_workspace": workspaceDataSource(),
		},
		ConfigureContextFunc: configure,
	}
}

func configure(_ context.Context, data *schema.ResourceData) (any, diag.Diagnostics) {
	serverURL := strings.TrimRight(data.Get("server_url").(string), "/")
	if serverURL == "" {
		return nil, diag.Errorf("zaw provider requires server_url or ZAW_SERVER_URL")
	}
	agentHostBaseURL := strings.TrimRight(data.Get("agent_host_base_url").(string), "/")
	if agentHostBaseURL == "" {
		agentHostBaseURL = serverURL
	}
	workspaceID := strings.TrimSpace(os.Getenv("ZAW_WORKSPACE_ID"))
	if workspaceID == "" {
		return nil, diag.Errorf("zaw provider requires ZAW_WORKSPACE_ID")
	}
	workspaceName := strings.TrimSpace(os.Getenv("ZAW_WORKSPACE_NAME"))
	if workspaceName == "" {
		return nil, diag.Errorf("zaw provider requires ZAW_WORKSPACE_NAME")
	}
	workspaceTransition := strings.TrimSpace(os.Getenv("ZAW_WORKSPACE_TRANSITION"))
	if _, err := workspaceDesiredState(workspaceTransition); err != nil {
		return nil, diag.FromErr(err)
	}
	return configuration{
		serverURL:           serverURL,
		agentHostBaseURL:    agentHostBaseURL,
		workspaceID:         workspaceID,
		workspaceName:       workspaceName,
		workspaceTransition: workspaceTransition,
	}, nil
}
