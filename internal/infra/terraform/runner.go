package terraform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	domainworkspace "github.com/zaw-dev/zaw/internal/domain/workspace"
)

const planFileName = ".zaw.tfplan"

type Runner struct {
	Binary          string
	Environment     []string
	State           StateConfig
	Timeout         time.Duration
	PluginCacheDir  string
	SensitiveValues []string
}

type StateConfig struct {
	Directory string
}

type WorkspaceContext struct {
	ID               string
	Name             string
	Transition       string
	ServerURL        string
	AgentHostBaseURL string
}

func (r Runner) Execute(
	ctx context.Context,
	workingDirectory string,
	workspace WorkspaceContext,
	logs io.Writer,
) (map[string]any, error) {
	executionContext, cancel := context.WithTimeout(ctx, r.timeout())
	defer cancel()
	binary := r.Binary
	if binary == "" {
		binary = "terraform"
	}
	environment, err := r.environment(workspace)
	if err != nil {
		return nil, err
	}
	stateArguments, err := r.State.initArguments(workspace.ID)
	if err != nil {
		return nil, err
	}
	initArgs := append([]string{"init", "-input=false"}, stateArguments...)
	if err := r.command(
		executionContext,
		workingDirectory,
		logs,
		environment,
		binary,
		initArgs...,
	); err != nil {
		return nil, err
	}
	planPath := filepath.Join(workingDirectory, planFileName)
	defer func() { _ = os.Remove(planPath) }()
	planArguments := []string{
		"plan",
		"-input=false",
		"-out=" + planPath,
	}
	if destroysResources(workspace.Transition) {
		planArguments = append(planArguments, "-destroy")
	}
	if err := r.command(
		executionContext,
		workingDirectory,
		logs,
		environment,
		binary,
		planArguments...,
	); err != nil {
		return nil, err
	}
	if err := r.command(
		executionContext,
		workingDirectory,
		logs,
		environment,
		binary,
		"apply",
		"-auto-approve",
		"-input=false",
		planPath,
	); err != nil {
		return nil, err
	}
	if destroysResources(workspace.Transition) {
		return map[string]any{}, nil
	}
	return r.outputs(executionContext, workingDirectory, environment, binary)
}

func (r Runner) timeout() time.Duration {
	if r.Timeout > 0 {
		return r.Timeout
	}
	return 30 * time.Minute
}

func (r Runner) environment(workspace WorkspaceContext) ([]string, error) {
	environment := append([]string{}, r.Environment...)
	if workspace.ID == "" {
		return nil, fmt.Errorf("Terraform Workspace context requires an ID")
	}
	if workspace.Name == "" {
		return nil, fmt.Errorf("Terraform Workspace context requires a name")
	}
	if _, err := domainworkspace.ParseBuildOperation(workspace.Transition); err != nil {
		return nil, err
	}
	if workspace.ServerURL == "" {
		return nil, fmt.Errorf("Terraform Workspace context requires a Server URL")
	}
	environment = append(environment,
		"ZAW_WORKSPACE_ID="+workspace.ID,
		"ZAW_WORKSPACE_NAME="+workspace.Name,
		"ZAW_WORKSPACE_TRANSITION="+workspace.Transition,
		"ZAW_SERVER_URL="+strings.TrimRight(workspace.ServerURL, "/"),
	)
	if workspace.AgentHostBaseURL != "" {
		environment = append(
			environment,
			"ZAW_AGENT_HOST_BASE_URL="+strings.TrimRight(workspace.AgentHostBaseURL, "/"),
		)
	}
	if r.PluginCacheDir == "" {
		return environment, nil
	}
	if err := os.MkdirAll(r.PluginCacheDir, 0o700); err != nil {
		return nil, fmt.Errorf("create Terraform plugin cache: %w", err)
	}
	return append(environment, "TF_PLUGIN_CACHE_DIR="+r.PluginCacheDir), nil
}

func destroysResources(operation string) bool {
	return operation == "delete"
}

func (c StateConfig) initArguments(workspaceID string) ([]string, error) {
	if c.Directory == "" {
		return nil, nil
	}
	directory, err := filepath.Abs(c.Directory)
	if err != nil {
		return nil, fmt.Errorf("resolve Terraform state directory: %w", err)
	}
	workspaceDirectory := filepath.Join(directory, "workspaces", filepath.Base(workspaceID))
	if err := os.MkdirAll(workspaceDirectory, 0o700); err != nil {
		return nil, fmt.Errorf("create Terraform state directory: %w", err)
	}
	statePath := filepath.Join(workspaceDirectory, "terraform.tfstate")
	return []string{"-backend-config=path=" + statePath}, nil
}

func (r Runner) outputs(
	ctx context.Context,
	workingDirectory string,
	environment []string,
	binary string,
) (map[string]any, error) {
	command := exec.CommandContext(ctx, binary, "output", "-json")
	configureProcessGroup(command)
	command.Dir = workingDirectory
	command.Env = terraformEnvironment(environment)
	payload, err := command.Output()
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("terraform output: %w", ctx.Err())
		}
		return nil, fmt.Errorf("terraform output: %w", err)
	}
	var outputs map[string]struct {
		Sensitive bool `json:"sensitive"`
		Value     any  `json:"value"`
	}
	if err := json.Unmarshal(payload, &outputs); err != nil {
		return nil, fmt.Errorf("decode terraform output: %w", err)
	}
	resources := make(map[string]any, len(outputs))
	for name, output := range outputs {
		if output.Sensitive {
			continue
		}
		resources[name] = output.Value
	}
	return resources, nil
}

func (r Runner) command(
	ctx context.Context,
	workingDirectory string,
	logs io.Writer,
	environment []string,
	binary string,
	args ...string,
) error {
	commandEnvironment := terraformEnvironment(environment)
	redactedLogs := newRedactingWriter(logs, r.redactions(commandEnvironment))
	defer func() { _ = redactedLogs.Flush() }()
	_, _ = fmt.Fprintf(redactedLogs, "$ %s %s\n", binary, strings.Join(args, " "))
	command := exec.CommandContext(ctx, binary, args...)
	configureProcessGroup(command)
	command.Dir = workingDirectory
	command.Env = commandEnvironment
	command.Stdout = redactedLogs
	command.Stderr = redactedLogs
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("terraform %s: %w", args[0], ctx.Err())
		}
		return fmt.Errorf("terraform %s: %w", args[0], err)
	}
	return nil
}

func terraformEnvironment(overrides []string) []string {
	overrideNames := make(map[string]struct{}, len(overrides))
	lastOverride := make(map[string]int, len(overrides))
	for index, variable := range overrides {
		name, _, found := strings.Cut(variable, "=")
		if !found {
			continue
		}
		overrideNames[name] = struct{}{}
		lastOverride[name] = index
	}
	environment := make([]string, 0, len(os.Environ())+len(overrides))
	for _, variable := range os.Environ() {
		name, _, _ := strings.Cut(variable, "=")
		if strings.HasPrefix(name, "ZAW_") {
			continue
		}
		if _, overridden := overrideNames[name]; overridden {
			continue
		}
		environment = append(environment, variable)
	}
	for index, variable := range overrides {
		name, _, found := strings.Cut(variable, "=")
		if found && lastOverride[name] != index {
			continue
		}
		environment = append(environment, variable)
	}
	return environment
}

func (r Runner) redactions(environment []string) []string {
	values := append([]string{}, r.SensitiveValues...)
	for _, variable := range environment {
		name, value, found := strings.Cut(variable, "=")
		if !found || value == "" {
			continue
		}
		upperName := strings.ToUpper(name)
		if strings.Contains(upperName, "SECRET") ||
			strings.Contains(upperName, "TOKEN") ||
			strings.Contains(upperName, "PASSWORD") ||
			strings.Contains(upperName, "ACCESS_KEY") ||
			strings.Contains(upperName, "CREDENTIAL") {
			values = append(values, value)
		}
	}
	return values
}
