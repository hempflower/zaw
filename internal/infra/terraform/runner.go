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

func (r Runner) Execute(
	ctx context.Context,
	workingDirectory string,
	workspaceID string,
	operation string,
	logs io.Writer,
) (map[string]any, error) {
	executionContext, cancel := context.WithTimeout(ctx, r.timeout())
	defer cancel()
	binary := r.Binary
	if binary == "" {
		binary = "terraform"
	}
	environment, err := r.environment()
	if err != nil {
		return nil, err
	}
	stateArguments, err := r.State.initArguments(workspaceID)
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
	if destroysResources(operation) {
		err := r.command(
			executionContext,
			workingDirectory,
			logs,
			environment,
			binary,
			"destroy",
			"-auto-approve",
			"-input=false",
		)
		return map[string]any{}, err
	}
	planPath := filepath.Join(workingDirectory, planFileName)
	defer func() { _ = os.Remove(planPath) }()
	if err := r.command(
		executionContext,
		workingDirectory,
		logs,
		environment,
		binary,
		"plan",
		"-input=false",
		"-out="+planPath,
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
	return r.outputs(executionContext, workingDirectory, environment, binary)
}

func (r Runner) timeout() time.Duration {
	if r.Timeout > 0 {
		return r.Timeout
	}
	return 30 * time.Minute
}

func (r Runner) environment() ([]string, error) {
	environment := append([]string{}, r.Environment...)
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
	command.Env = append(os.Environ(), environment...)
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
	redactedLogs := newRedactingWriter(logs, r.redactions(environment))
	defer func() { _ = redactedLogs.Flush() }()
	_, _ = fmt.Fprintf(redactedLogs, "$ %s %s\n", binary, strings.Join(args, " "))
	command := exec.CommandContext(ctx, binary, args...)
	configureProcessGroup(command)
	command.Dir = workingDirectory
	command.Env = append(os.Environ(), environment...)
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
