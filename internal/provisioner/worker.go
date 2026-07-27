package provisioner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/zaw-dev/zaw/internal/infra/source"
	terraformrunner "github.com/zaw-dev/zaw/internal/infra/terraform"
)

type Config struct {
	ServerURL                   string
	Name                        string
	WorkRoot                    string
	TerraformBinary             string
	DockerHost                  string
	IncusBinary                 string
	AgentHostBinary             string
	SecretManagerURL            string
	StateEndpoint               string
	StateBucket                 string
	StateAccessKey              string
	StateSecretKey              string
	TerraformTimeout            time.Duration
	PluginCacheDir              string
	RetainFailedWorkDirectories bool
}

type Worker struct {
	config Config
	client *http.Client
	runner terraformrunner.Runner
}

type sourceSnapshot struct {
	Kind         string `json:"kind"`
	URL          string `json:"url"`
	Commit       string `json:"commit"`
	SHA256       string `json:"sha256"`
	Format       string `json:"format"`
	Directory    string `json:"directory"`
	CredentialID string `json:"credentialId"`
}

type buildPayload struct {
	ID                string          `json:"ID"`
	WorkspaceID       string          `json:"WorkspaceID"`
	Operation         string          `json:"Operation"`
	SourceSnapshot    json.RawMessage `json:"SourceSnapshot"`
	ParameterSnapshot json.RawMessage `json:"ParameterSnapshot"`
}

type claimedJob struct {
	ID    string       `json:"id"`
	Build buildPayload `json:"build"`
}

func Run(ctx context.Context, config Config) error {
	worker, err := New(config)
	if err != nil {
		return err
	}
	return worker.Run(ctx)
}

func New(config Config) (*Worker, error) {
	if config.ServerURL == "" {
		config.ServerURL = os.Getenv("ZAW_SERVER_URL")
	}
	if config.ServerURL == "" {
		config.ServerURL = "http://127.0.0.1:8080"
	}
	if config.Name == "" {
		config.Name = os.Getenv("ZAW_PROVISIONER_NAME")
	}
	if config.Name == "" {
		config.Name = "local-provisioner"
	}
	if config.WorkRoot == "" {
		config.WorkRoot = os.Getenv("ZAW_PROVISIONER_WORK_ROOT")
	}
	if config.SecretManagerURL == "" {
		config.SecretManagerURL = os.Getenv("ZAW_SECRET_MANAGER_ADDR")
	}
	if config.SecretManagerURL == "" {
		config.SecretManagerURL = "http://127.0.0.1:8200"
	}
	if config.WorkRoot == "" {
		config.WorkRoot = os.TempDir()
	}
	if config.TerraformTimeout == 0 {
		if configured := os.Getenv("ZAW_TERRAFORM_TIMEOUT"); configured != "" {
			parsed, err := time.ParseDuration(configured)
			if err != nil {
				return nil, fmt.Errorf("parse ZAW_TERRAFORM_TIMEOUT: %w", err)
			}
			config.TerraformTimeout = parsed
		}
	}
	if config.TerraformTimeout == 0 {
		config.TerraformTimeout = 30 * time.Minute
	}
	if config.PluginCacheDir == "" {
		config.PluginCacheDir = os.Getenv("ZAW_TERRAFORM_PLUGIN_CACHE_DIR")
	}
	if config.PluginCacheDir == "" {
		config.PluginCacheDir = filepath.Join(config.WorkRoot, "terraform-plugin-cache")
	}
	if os.Getenv("ZAW_PROVISIONER_RETAIN_FAILED_WORKDIR") == "true" {
		config.RetainFailedWorkDirectories = true
	}
	if config.StateEndpoint == "" {
		config.StateEndpoint = os.Getenv("ZAW_STATE_S3_ENDPOINT")
	}
	if config.StateBucket == "" {
		config.StateBucket = os.Getenv("ZAW_STATE_S3_BUCKET")
	}
	if config.StateAccessKey == "" {
		config.StateAccessKey = os.Getenv("ZAW_STATE_S3_ACCESS_KEY")
	}
	if config.StateSecretKey == "" {
		config.StateSecretKey = os.Getenv("ZAW_STATE_S3_SECRET_KEY")
	}
	if config.DockerHost == "" {
		config.DockerHost = os.Getenv("ZAW_DOCKER_HOST")
	}
	if config.IncusBinary == "" {
		config.IncusBinary = os.Getenv("ZAW_INCUS_BINARY")
	}
	if config.IncusBinary == "" {
		config.IncusBinary = "incus"
	}
	if config.AgentHostBinary == "" {
		config.AgentHostBinary = os.Getenv("ZAW_AGENT_HOST_BINARY")
	}
	if config.DockerHost == "" {
		config.DockerHost = os.Getenv("DOCKER_HOST")
	}
	if err := os.MkdirAll(config.WorkRoot, 0o700); err != nil {
		return nil, err
	}
	terraformEnvironment := []string{}
	if config.DockerHost != "" {
		terraformEnvironment = append(terraformEnvironment, "DOCKER_HOST="+config.DockerHost)
	}
	return &Worker{
		config: config,
		client: &http.Client{Timeout: 30 * time.Second},
		runner: terraformrunner.Runner{
			Binary:         config.TerraformBinary,
			Environment:    terraformEnvironment,
			Timeout:        config.TerraformTimeout,
			PluginCacheDir: config.PluginCacheDir,
			State: terraformrunner.StateConfig{
				Endpoint:  config.StateEndpoint,
				Bucket:    config.StateBucket,
				AccessKey: config.StateAccessKey,
				SecretKey: config.StateSecretKey,
			},
		},
	}, nil
}

func (w *Worker) Run(ctx context.Context) error {
	provisionerID, err := w.register(ctx)
	if err != nil {
		return err
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := w.heartbeat(ctx, provisionerID); err != nil {
			return err
		}
		job, err := w.claim(ctx, provisionerID)
		if err != nil {
			return err
		}
		if job != nil {
			w.execute(ctx, provisionerID, *job)
			continue
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (w *Worker) register(ctx context.Context) (string, error) {
	var response struct {
		ID string `json:"id"`
	}
	err := w.request(ctx, http.MethodPost, "/api/v1/provisioners/register", map[string]any{
		"name":         w.config.Name,
		"capabilities": map[string]bool{"terraform": true, "git": true, "tar": true},
	}, &response)
	if err != nil {
		return "", err
	}
	return response.ID, nil
}

func (w *Worker) heartbeat(ctx context.Context, provisionerID string) error {
	return w.request(
		ctx,
		http.MethodPost,
		"/api/v1/provisioners/"+provisionerID+"/heartbeat",
		nil,
		nil,
	)
}

func (w *Worker) claim(ctx context.Context, provisionerID string) (*claimedJob, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(w.config.ServerURL, "/")+"/api/v1/provisioners/"+provisionerID+"/claim",
		nil,
	)
	if err != nil {
		return nil, err
	}
	response, err := w.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if response.StatusCode/100 != 2 {
		return nil, fmt.Errorf("claim build: server returned %s", response.Status)
	}
	var job claimedJob
	if err := json.NewDecoder(response.Body).Decode(&job); err != nil {
		return nil, err
	}
	return &job, nil
}

func (w *Worker) execute(ctx context.Context, provisionerID string, job claimedJob) {
	var logs bytes.Buffer
	status := "succeeded"
	resources, err := w.executeBuild(ctx, provisionerID, job, &logs)
	if err != nil {
		status = "failed"
		_, _ = fmt.Fprintf(&logs, "build failed: %v\n", err)
	}
	payload := map[string]any{
		"type":      "completed",
		"message":   logs.String(),
		"status":    status,
		"resources": resources,
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	_ = w.request(
		ctx,
		http.MethodPost,
		"/api/v1/provisioners/"+provisionerID+"/jobs/"+job.ID+"/events",
		payload,
		nil,
	)
}

func (w *Worker) executeBuild(
	ctx context.Context,
	provisionerID string,
	job claimedJob,
	logs io.Writer,
) (map[string]any, error) {
	var snapshot sourceSnapshot
	if err := json.Unmarshal(job.Build.SourceSnapshot, &snapshot); err != nil {
		return nil, fmt.Errorf("decode source snapshot: %w", err)
	}
	workDirectory, err := os.MkdirTemp(w.config.WorkRoot, "zaw-build-*")
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		cleanupWorkDirectory(
			workDirectory,
			success,
			w.config.RetainFailedWorkDirectories,
			logs,
		)
	}()
	credential, err := w.credentialForBuild(ctx, provisionerID, job, snapshot)
	if err != nil {
		return nil, err
	}
	templateDirectory, err := checkoutSource(ctx, snapshot, workDirectory, logs, credential)
	if err != nil {
		return nil, err
	}
	if err := writeWorkspaceVariables(templateDirectory, job.Build, w.config.ServerURL); err != nil {
		return nil, err
	}
	resources, err := w.runner.Execute(
		ctx,
		templateDirectory,
		job.Build.WorkspaceID,
		job.Build.Operation,
		logs,
	)
	if err != nil {
		return nil, err
	}
	if job.Build.Operation != "stop" && job.Build.Operation != "delete" {
		if err := w.injectIncusAgentCredential(
			ctx,
			provisionerID,
			job,
			resources,
			workDirectory,
			logs,
		); err != nil {
			return nil, err
		}
	}
	success = true
	return resources, nil
}

func cleanupWorkDirectory(
	directory string,
	success bool,
	retainFailure bool,
	logs io.Writer,
) {
	if success || !retainFailure {
		_ = os.RemoveAll(directory)
		return
	}
	_, _ = fmt.Fprintf(logs, "retained failed build directory: %s\n", directory)
}

func (w *Worker) injectIncusAgentCredential(
	ctx context.Context,
	provisionerID string,
	job claimedJob,
	resources map[string]any,
	workDirectory string,
	logs io.Writer,
) error {
	instanceName, ok := resources["instance_name"].(string)
	if !ok || instanceName == "" {
		return nil
	}
	if w.config.AgentHostBinary != "" {
		binaryPath, err := filepath.Abs(w.config.AgentHostBinary)
		if err != nil {
			return fmt.Errorf("resolve Agent Host binary: %w", err)
		}
		info, err := os.Stat(binaryPath)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("Agent Host binary is unavailable: %s", binaryPath)
		}
		if err := runRedactedCommand(
			ctx,
			logs,
			w.config.IncusBinary,
			[]string{
				"file",
				"push",
				"--mode=0755",
				binaryPath,
				instanceName + "/usr/local/bin/zaw",
			},
			w.config.IncusBinary+" file push [zaw binary] "+
				instanceName+"/usr/local/bin/zaw",
		); err != nil {
			return fmt.Errorf("install Agent Host binary in Incus VM: %w", err)
		}
	}
	var response struct {
		Token string `json:"token"`
	}
	path := "/api/v1/provisioners/" + provisionerID + "/jobs/" + job.ID
	if err := w.request(ctx, http.MethodPost, path+"/agent-host-token", nil, &response); err != nil {
		return fmt.Errorf("issue Agent Host registration credential: %w", err)
	}
	credentialFile, err := os.CreateTemp(workDirectory, ".zaw-agent-credential-*")
	if err != nil {
		return fmt.Errorf("create Agent Host credential file: %w", err)
	}
	credentialPath := credentialFile.Name()
	defer func() { _ = os.Remove(credentialPath) }()
	if _, err := credentialFile.WriteString(response.Token + "\n"); err != nil {
		_ = credentialFile.Close()
		return fmt.Errorf("write Agent Host credential: %w", err)
	}
	if err := credentialFile.Chmod(0o600); err != nil {
		_ = credentialFile.Close()
		return fmt.Errorf("protect Agent Host credential: %w", err)
	}
	if err := credentialFile.Close(); err != nil {
		return fmt.Errorf("close Agent Host credential: %w", err)
	}
	if err := runRedactedCommand(
		ctx,
		logs,
		w.config.IncusBinary,
		[]string{
			"file",
			"push",
			"--mode=0600",
			credentialPath,
			instanceName + "/etc/zaw/registration.token",
		},
		w.config.IncusBinary+" file push [agent credential] "+instanceName+"/etc/zaw/registration.token",
	); err != nil {
		return fmt.Errorf("install Agent Host credential in Incus VM: %w", err)
	}
	if err := runRedactedCommand(
		ctx,
		logs,
		w.config.IncusBinary,
		[]string{
			"exec",
			instanceName,
			"--",
			"systemctl",
			"enable",
			"--now",
			"zaw-agent-host.service",
		},
		w.config.IncusBinary+" exec "+instanceName+
			" -- systemctl enable --now zaw-agent-host.service",
	); err != nil {
		return fmt.Errorf("start Agent Host in Incus VM: %w", err)
	}
	return nil
}

func runRedactedCommand(
	ctx context.Context,
	logs io.Writer,
	binary string,
	args []string,
	logLine string,
) error {
	_, _ = fmt.Fprintf(logs, "$ %s\n", logLine)
	command := exec.CommandContext(ctx, binary, args...)
	command.Stdout = logs
	command.Stderr = logs
	return command.Run()
}

func writeWorkspaceVariables(
	templateDirectory string,
	build buildPayload,
	serverURL string,
) error {
	parameters := map[string]any{}
	if len(build.ParameterSnapshot) > 0 {
		if err := json.Unmarshal(build.ParameterSnapshot, &parameters); err != nil {
			return fmt.Errorf("decode parameter snapshot: %w", err)
		}
	}
	parameters["workspace_id"] = build.WorkspaceID
	parameters["zaw_workspace_id"] = build.WorkspaceID
	parameters["zaw_workspace_transition"] = build.Operation
	parameters["zaw_workspace_running"] = workspaceRunning(build.Operation)
	parameters["zaw_server_url"] = serverURL
	payload, err := json.Marshal(parameters)
	if err != nil {
		return fmt.Errorf("encode workspace variables: %w", err)
	}
	variableFile := filepath.Join(templateDirectory, "zaw.auto.tfvars.json")
	if err := os.WriteFile(variableFile, payload, 0o600); err != nil {
		return fmt.Errorf("write workspace variables: %w", err)
	}
	return nil
}

func workspaceRunning(operation string) bool {
	if operation == "stop" || operation == "delete" {
		return false
	}
	return true
}

type gitCredential struct {
	Kind     string
	Metadata map[string]string
	Secret   map[string]string
}

func checkoutSource(
	ctx context.Context,
	snapshot sourceSnapshot,
	workDirectory string,
	logs io.Writer,
	credential *gitCredential,
) (string, error) {
	switch snapshot.Kind {
	case "git":
		return checkoutGit(ctx, snapshot, workDirectory, logs, credential)
	case "tar":
		return checkoutTar(ctx, snapshot, workDirectory, credential)
	default:
		return "", fmt.Errorf("unsupported source kind %q", snapshot.Kind)
	}
}

func checkoutTar(
	ctx context.Context,
	snapshot sourceSnapshot,
	workDirectory string,
	credential *gitCredential,
) (string, error) {
	if snapshot.SHA256 == "" {
		return "", fmt.Errorf("tar snapshot has no fixed sha256")
	}
	archive, format, _, err := source.DownloadArchiveWithOptions(
		ctx,
		snapshot.URL,
		snapshot.SHA256,
		archiveOptions(credential),
	)
	if err != nil {
		return "", err
	}
	if snapshot.Format != "" && snapshot.Format != format {
		return "", fmt.Errorf("tar archive format changed since snapshot")
	}
	if err := source.ExtractArchive(format, bytes.NewReader(archive), workDirectory); err != nil {
		return "", err
	}
	directory := filepath.Join(workDirectory, snapshot.Directory)
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("template directory is unavailable: %s", snapshot.Directory)
	}
	return directory, nil
}

func archiveOptions(credential *gitCredential) source.DownloadOptions {
	if credential == nil {
		return source.DownloadOptions{}
	}
	if credential.Kind == "username_password" {
		return source.DownloadOptions{
			Username: credential.Metadata["username"],
			Password: credential.Secret["password"],
		}
	}
	if credential.Kind == "token" {
		return source.DownloadOptions{BearerToken: credential.Secret["token"]}
	}
	return source.DownloadOptions{}
}

func (w *Worker) credentialForBuild(
	ctx context.Context,
	provisionerID string,
	job claimedJob,
	snapshot sourceSnapshot,
) (*gitCredential, error) {
	if snapshot.CredentialID == "" {
		return nil, nil
	}
	var lease struct {
		LeaseToken string            `json:"leaseToken"`
		Kind       string            `json:"kind"`
		Metadata   map[string]string `json:"metadata"`
	}
	path := "/api/v1/provisioners/" + provisionerID + "/jobs/" + job.ID
	path += "/credentials/" + snapshot.CredentialID + "/lease"
	if err := w.request(ctx, http.MethodPost, path, nil, &lease); err != nil {
		return nil, err
	}
	secret, err := w.unwrapLease(ctx, lease.LeaseToken)
	if err != nil {
		return nil, err
	}
	return &gitCredential{Kind: lease.Kind, Metadata: lease.Metadata, Secret: secret}, nil
}

func (w *Worker) unwrapLease(ctx context.Context, token string) (map[string]string, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(w.config.SecretManagerURL, "/")+"/v1/sys/wrapping/unwrap",
		nil,
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Vault-Token", token)
	response, err := w.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return nil, fmt.Errorf("credential lease unwrap failed")
	}
	var payload struct {
		Data struct {
			Data map[string]string `json:"data"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload.Data.Data, nil
}

func gitCredentialEnvironment(
	workDirectory string,
	credential *gitCredential,
) ([]string, func(), error) {
	if credential == nil {
		return []string{"GIT_TERMINAL_PROMPT=0"}, func() {}, nil
	}
	if credential.Kind == "ssh_key" {
		keyPath := filepath.Join(workDirectory, ".zaw-git-key")
		if err := os.WriteFile(keyPath, []byte(credential.Secret["privateKey"]), 0o600); err != nil {
			return nil, nil, err
		}
		return []string{
			"GIT_TERMINAL_PROMPT=0",
			"GIT_SSH_COMMAND=ssh -i " + keyPath + " -o IdentitiesOnly=yes",
		}, func() { _ = os.Remove(keyPath) }, nil
	}
	username := credential.Metadata["username"]
	password := credential.Secret["password"]
	if credential.Kind == "token" {
		username = "x-access-token"
		password = credential.Secret["token"]
	}
	askPassPath := filepath.Join(workDirectory, ".zaw-git-askpass")
	script := "#!/bin/sh\n"
	script += "case \"$1\" in\n"
	script += "  *Username*) printf '%s' \"$ZAW_GIT_USERNAME\" ;;\n"
	script += "  *) printf '%s' \"$ZAW_GIT_PASSWORD\" ;;\n"
	script += "esac\n"
	if err := os.WriteFile(askPassPath, []byte(script), 0o700); err != nil {
		return nil, nil, err
	}
	return []string{
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ASKPASS=" + askPassPath,
		"ZAW_GIT_USERNAME=" + username,
		"ZAW_GIT_PASSWORD=" + password,
	}, func() { _ = os.Remove(askPassPath) }, nil
}

func checkoutGit(
	ctx context.Context,
	snapshot sourceSnapshot,
	workDirectory string,
	logs io.Writer,
	credential *gitCredential,
) (string, error) {
	if snapshot.Commit == "" {
		return "", fmt.Errorf("git snapshot has no fixed commit")
	}
	environment, cleanup, err := gitCredentialEnvironment(workDirectory, credential)
	if err != nil {
		return "", err
	}
	defer cleanup()
	if err := runCommand(
		ctx,
		logs,
		workDirectory,
		environment,
		"git",
		"clone",
		"--no-checkout",
		snapshot.URL,
		".",
	); err != nil {
		return "", err
	}
	if err := runCommand(
		ctx,
		logs,
		workDirectory,
		environment,
		"git",
		"checkout",
		"--detach",
		snapshot.Commit,
	); err != nil {
		return "", err
	}
	directory := filepath.Join(workDirectory, snapshot.Directory)
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("template directory is unavailable: %s", snapshot.Directory)
	}
	return directory, nil
}

func runCommand(
	ctx context.Context,
	logs io.Writer,
	directory string,
	environment []string,
	binary string,
	args ...string,
) error {
	_, _ = fmt.Fprintf(logs, "$ %s %s\n", binary, strings.Join(args, " "))
	command := exec.CommandContext(ctx, binary, args...)
	command.Dir = directory
	command.Env = append(os.Environ(), environment...)
	command.Stdout = logs
	command.Stderr = logs
	return command.Run()
}

func (w *Worker) request(
	ctx context.Context,
	method string,
	path string,
	body any,
	output any,
) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		method,
		strings.TrimRight(w.config.ServerURL, "/")+path,
		reader,
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := w.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return fmt.Errorf("server returned %s", response.Status)
	}
	if output != nil {
		return json.NewDecoder(response.Body).Decode(output)
	}
	return nil
}
