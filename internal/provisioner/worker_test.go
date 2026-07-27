package provisioner

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWriteWorkspaceVariablesMergesSnapshotAndWorkspaceID(t *testing.T) {
	directory := t.TempDir()
	build := buildPayload{
		WorkspaceID: "workspace-1",
		ParameterSnapshot: json.RawMessage(`{
			"image":"alpine:3.21",
			"workspace_id":"caller-cannot-override"
		}`),
	}
	if err := writeWorkspaceVariables(directory, build, "http://zaw.test"); err != nil {
		t.Fatalf("write variables: %v", err)
	}
	payload, err := os.ReadFile(filepath.Join(directory, "zaw.auto.tfvars.json"))
	if err != nil {
		t.Fatalf("read variables: %v", err)
	}
	var variables map[string]any
	if err := json.Unmarshal(payload, &variables); err != nil {
		t.Fatalf("decode variables: %v", err)
	}
	if variables["image"] != "alpine:3.21" {
		t.Fatalf("image variable = %q", variables["image"])
	}
	if variables["workspace_id"] != "workspace-1" {
		t.Fatalf("workspace ID = %q", variables["workspace_id"])
	}
	if variables["zaw_workspace_running"] != true {
		t.Fatalf("workspace running = %q", variables["zaw_workspace_running"])
	}
	if variables["zaw_workspace_transition"] != "" {
		t.Fatalf("workspace transition = %q", variables["zaw_workspace_transition"])
	}
	if variables["zaw_server_url"] != "http://zaw.test" {
		t.Fatalf("server URL = %q", variables["zaw_server_url"])
	}
}

func TestWorkspaceRunningStopsWithoutDestroyingState(t *testing.T) {
	if got := workspaceRunning("stop"); got {
		t.Fatal("stop must set running to false")
	}
	if got := workspaceRunning("start"); !got {
		t.Fatal("start must set running to true")
	}
}

func TestNewPassesConfiguredDockerHostToTerraform(t *testing.T) {
	t.Setenv("ZAW_DOCKER_HOST", "unix:///run/user/1000/docker.sock")
	worker, err := New(Config{WorkRoot: t.TempDir()})
	if err != nil {
		t.Fatalf("create worker: %v", err)
	}
	environment := strings.Join(worker.runner.Environment, " ")
	if !strings.Contains(environment, "DOCKER_HOST=unix:///run/user/1000/docker.sock") {
		t.Fatalf("Terraform Docker host was not configured: %s", environment)
	}
}

func TestNewConfiguresTerraformExecutionPolicy(t *testing.T) {
	workRoot := t.TempDir()
	worker, err := New(Config{
		WorkRoot:                    workRoot,
		TerraformTimeout:            45 * time.Second,
		RetainFailedWorkDirectories: true,
	})
	if err != nil {
		t.Fatalf("create worker: %v", err)
	}
	if worker.runner.Timeout != 45*time.Second {
		t.Fatalf("Terraform timeout = %s", worker.runner.Timeout)
	}
	wantCache := filepath.Join(workRoot, "terraform-plugin-cache")
	if worker.runner.PluginCacheDir != wantCache {
		t.Fatalf("Terraform plugin cache = %q", worker.runner.PluginCacheDir)
	}
	if !worker.config.RetainFailedWorkDirectories {
		t.Fatal("failed work directory policy was not retained")
	}
}

func TestCleanupWorkDirectoryPolicy(t *testing.T) {
	removed := filepath.Join(t.TempDir(), "removed")
	if err := os.Mkdir(removed, 0o700); err != nil {
		t.Fatalf("create disposable directory: %v", err)
	}
	cleanupWorkDirectory(removed, false, false, &bytes.Buffer{})
	if _, err := os.Stat(removed); !os.IsNotExist(err) {
		t.Fatalf("failed directory was not deleted by default: %v", err)
	}

	retained := filepath.Join(t.TempDir(), "retained")
	if err := os.Mkdir(retained, 0o700); err != nil {
		t.Fatalf("create retained directory: %v", err)
	}
	var logs bytes.Buffer
	cleanupWorkDirectory(retained, false, true, &logs)
	if _, err := os.Stat(retained); err != nil {
		t.Fatalf("diagnostic directory was not retained: %v", err)
	}
	if !strings.Contains(logs.String(), retained) {
		t.Fatalf("retained directory was not reported: %s", logs.String())
	}
}

func TestIncusAgentCredentialInjectionKeepsTokenOutOfLogsAndArguments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/agent-host-token") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"token":"never-log-this"}`))
	}))
	defer server.Close()
	directory := t.TempDir()
	agentHostBinary := filepath.Join(directory, "zaw")
	if err := os.WriteFile(agentHostBinary, []byte("test binary"), 0o755); err != nil {
		t.Fatalf("write fake Agent Host binary: %v", err)
	}
	tracePath := filepath.Join(directory, "incus.trace")
	binaryPath := filepath.Join(directory, "incus")
	script := "#!/bin/sh\n"
	script += "printf '%s\\n' \"$*\" >> \"$ZAW_INCUS_TRACE\"\n"
	if err := os.WriteFile(binaryPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake Incus: %v", err)
	}
	t.Setenv("ZAW_INCUS_TRACE", tracePath)
	var logs bytes.Buffer
	worker := &Worker{
		config: Config{
			IncusBinary:     binaryPath,
			AgentHostBinary: agentHostBinary,
			ServerURL:       server.URL,
		},
		client: &http.Client{},
	}
	err := worker.injectIncusAgentCredential(
		t.Context(),
		"provisioner-1",
		claimedJob{ID: "job-1"},
		map[string]any{"instance_name": "zaw-workspace-1"},
		directory,
		&logs,
	)
	if err != nil {
		t.Fatalf("inject credential: %v", err)
	}
	trace, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("read Incus trace: %v", err)
	}
	if strings.Contains(logs.String(), "never-log-this") ||
		strings.Contains(string(trace), "never-log-this") {
		t.Fatal("Agent Host credential leaked into logs or command arguments")
	}
	if !strings.Contains(string(trace), "file push --mode=0755") ||
		!strings.Contains(string(trace), "file push --mode=0600") ||
		!strings.Contains(string(trace), "systemctl enable --now zaw-agent-host.service") {
		t.Fatalf("unexpected Incus calls: %s", trace)
	}
}
