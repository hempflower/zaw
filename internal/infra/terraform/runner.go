package terraform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
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
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
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
	initArgs := append(
		[]string{"init", "-input=false"},
		r.State.initArguments(workspaceID)...,
	)
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
	environment := append(r.State.environment(), r.Environment...)
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

func (c StateConfig) environment() []string {
	environment := make([]string, 0, 3)
	if c.AccessKey != "" {
		environment = append(environment, "AWS_ACCESS_KEY_ID="+c.AccessKey)
	}
	if c.SecretKey != "" {
		environment = append(environment, "AWS_SECRET_ACCESS_KEY="+c.SecretKey)
	}
	if c.Endpoint != "" {
		environment = append(environment, "AWS_ENDPOINT_URL_S3="+c.Endpoint)
	}
	return environment
}

func (c StateConfig) initArguments(workspaceID string) []string {
	if c.Bucket == "" {
		return nil
	}
	arguments := []string{
		"-backend-config=bucket=" + c.Bucket,
		"-backend-config=key=" + path.Join("workspaces", workspaceID, "terraform.tfstate"),
		"-backend-config=region=us-east-1",
		"-backend-config=skip_credentials_validation=true",
		"-backend-config=skip_metadata_api_check=true",
		"-backend-config=skip_requesting_account_id=true",
		"-backend-config=use_path_style=true",
		"-backend-config=use_lockfile=true",
	}
	return arguments
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
	values = append(values, r.State.AccessKey, r.State.SecretKey)
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
