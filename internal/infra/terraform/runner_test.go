package terraform

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestStateInitArgumentsUseWorkspaceSpecificLocalPath(t *testing.T) {
	stateDirectory := t.TempDir()
	config := StateConfig{Directory: stateDirectory}
	values, err := config.initArguments("workspace-1")
	if err != nil {
		t.Fatalf("create state arguments: %v", err)
	}
	arguments := strings.Join(values, " ")
	want := filepath.Join(
		stateDirectory,
		"workspaces",
		"workspace-1",
		"terraform.tfstate",
	)
	if !strings.Contains(arguments, "path="+want) {
		t.Fatalf("workspace state path missing: %s", arguments)
	}
	if info, err := os.Stat(filepath.Dir(want)); err != nil || !info.IsDir() {
		t.Fatalf("workspace state directory is unavailable: %v", err)
	}
}

func TestRunnerPassesConfiguredDockerHostAsEnvironment(t *testing.T) {
	runner := Runner{Environment: []string{"DOCKER_HOST=unix:///run/user/1000/docker.sock"}}
	environment := strings.Join(runner.Environment, " ")
	if !strings.Contains(environment, "DOCKER_HOST=unix:///run/user/1000/docker.sock") {
		t.Fatalf("Docker host environment missing: %s", environment)
	}
}

func TestInstallBundledProviderCreatesFilesystemMirror(t *testing.T) {
	directory := t.TempDir()
	providerBinary := writeFakeTerraform(t, directory, "")
	configurationPath, err := InstallBundledProvider(directory, providerBinary)
	if err != nil {
		t.Fatalf("install bundled Provider: %v", err)
	}
	configuration, err := os.ReadFile(configurationPath)
	if err != nil {
		t.Fatalf("read Terraform CLI configuration: %v", err)
	}
	if !strings.Contains(string(configuration), ProviderSource) ||
		!strings.Contains(string(configuration), "filesystem_mirror") {
		t.Fatalf("Terraform CLI configuration = %s", configuration)
	}
	providerPath := filepath.Join(
		directory,
		"terraform-provider-mirror",
		ProviderSource,
		ProviderVersion,
		runtime.GOOS+"_"+runtime.GOARCH,
		"terraform-provider-zaw_v"+ProviderVersion,
	)
	if _, err := os.Stat(providerPath); err != nil {
		t.Fatalf("bundled Provider is unavailable: %v", err)
	}
	if _, err := InstallBundledProvider(directory, providerBinary); err != nil {
		t.Fatalf("reinstall bundled Provider: %v", err)
	}
}

func TestTerraformEnvironmentExcludesHostZawSecrets(t *testing.T) {
	t.Setenv("ZAW_PROVISIONER_KEY", "provisioner-secret")
	t.Setenv("AWS_REGION", "us-test-1")
	t.Setenv("TF_CLI_CONFIG_FILE", "/host/terraform.tfrc")
	environment := terraformEnvironment([]string{
		"ZAW_TERRAFORM_TRACE=stale",
		"ZAW_TERRAFORM_TRACE=explicit",
		"TF_CLI_CONFIG_FILE=/zaw/terraform.tfrc",
	})
	joined := strings.Join(environment, "\n")
	if strings.Contains(joined, "ZAW_PROVISIONER_KEY=") {
		t.Fatalf("host Zaw secret was passed to Terraform: %s", joined)
	}
	if !strings.Contains(joined, "AWS_REGION=us-test-1") {
		t.Fatalf("provider environment was not preserved: %s", joined)
	}
	if !strings.Contains(joined, "ZAW_TERRAFORM_TRACE=explicit") {
		t.Fatalf("explicit Terraform environment was not preserved: %s", joined)
	}
	if strings.Contains(joined, "ZAW_TERRAFORM_TRACE=stale") ||
		strings.Contains(joined, "TF_CLI_CONFIG_FILE=/host/terraform.tfrc") ||
		!strings.Contains(joined, "TF_CLI_CONFIG_FILE=/zaw/terraform.tfrc") {
		t.Fatalf("explicit Terraform overrides did not win: %s", joined)
	}
}

func TestRunnerBuildsExplicitWorkspaceEnvironment(t *testing.T) {
	t.Setenv("ZAW_WORKSPACE_ID", "host-workspace")
	runner := Runner{Environment: []string{"DOCKER_HOST=unix:///docker.sock"}}
	environment, err := runner.environment(WorkspaceContext{
		ID:               "workspace-1",
		Name:             "example",
		Transition:       "stop",
		ServerURL:        "https://zaw.example/",
		AgentHostBaseURL: "wss://agents.example/",
	})
	if err != nil {
		t.Fatalf("build Terraform environment: %v", err)
	}
	joined := strings.Join(terraformEnvironment(environment), "\n")
	for _, expected := range []string{
		"ZAW_WORKSPACE_ID=workspace-1",
		"ZAW_WORKSPACE_NAME=example",
		"ZAW_WORKSPACE_TRANSITION=stop",
		"ZAW_SERVER_URL=https://zaw.example",
		"ZAW_AGENT_HOST_BASE_URL=wss://agents.example",
		"DOCKER_HOST=unix:///docker.sock",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("Terraform environment is missing %q: %s", expected, joined)
		}
	}
	if strings.Contains(joined, "ZAW_WORKSPACE_ID=host-workspace") {
		t.Fatalf("host Workspace context leaked into Terraform: %s", joined)
	}
}

func TestRunnerRejectsInvalidWorkspaceContext(t *testing.T) {
	runner := Runner{}
	for _, workspace := range []WorkspaceContext{
		{Name: "example", Transition: "start", ServerURL: "https://zaw.example"},
		{ID: "workspace-1", Transition: "start", ServerURL: "https://zaw.example"},
		{ID: "workspace-1", Name: "example", Transition: "unknown", ServerURL: "https://zaw.example"},
		{ID: "workspace-1", Name: "example", Transition: "start"},
	} {
		if _, err := runner.environment(workspace); err == nil {
			t.Fatalf("invalid Workspace context was accepted: %#v", workspace)
		}
	}
}

func TestOnlyDeleteDestroysTerraformResources(t *testing.T) {
	if destroysResources("stop") {
		t.Fatal("stop must apply a lifecycle transition, not destroy resources")
	}
	if !destroysResources("delete") {
		t.Fatal("delete must destroy Terraform resources")
	}
}

func TestRunnerCompletesRealTerraformLifecycle(t *testing.T) {
	directory := t.TempDir()
	configuration := `
terraform {
  required_version = ">= 1.4.0"
}

resource "terraform_data" "probe" {
  input = "ok"
}

output "probe" {
  value = terraform_data.probe.output
}
`
	if err := os.WriteFile(
		filepath.Join(directory, "main.tf"),
		[]byte(configuration),
		0o600,
	); err != nil {
		t.Fatalf("write Terraform configuration: %v", err)
	}
	var logs bytes.Buffer
	runner := Runner{
		PluginCacheDir: filepath.Join(t.TempDir(), "plugins"),
		Timeout:        2 * time.Minute,
	}
	resources, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-real", "create"),
		&logs,
	)
	if err != nil {
		t.Fatalf("apply real Terraform configuration: %v\n%s", err, logs.String())
	}
	if resources["probe"] != "ok" {
		t.Fatalf("Terraform outputs = %#v", resources)
	}
	if _, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-real", "delete"),
		&logs,
	); err != nil {
		t.Fatalf("destroy real Terraform configuration: %v\n%s", err, logs.String())
	}
	stateList := exec.Command("terraform", "state", "list")
	stateList.Dir = directory
	remaining, err := stateList.Output()
	if err != nil {
		t.Fatalf("list Terraform state: %v", err)
	}
	if strings.TrimSpace(string(remaining)) != "" {
		t.Fatalf("resources remain after destroy: %s", remaining)
	}
	if info, err := os.Stat(runner.PluginCacheDir); err != nil || !info.IsDir() {
		t.Fatalf("Terraform plugin cache is unavailable: %v", err)
	}
}

func TestRunnerRedactsLogsAndOmitsSensitiveOutputs(t *testing.T) {
	directory := t.TempDir()
	binaryPath := writeFakeTerraform(t, directory, `
if [ "$1" = output ]; then
  echo '{"public":{"sensitive":false,"value":"ok"},"private":{"sensitive":true,"value":"hidden"}}'
else
  echo "$AWS_SECRET_ACCESS_KEY"
  echo "$API_TOKEN" >&2
fi
`)
	var logs bytes.Buffer
	runner := Runner{
		Binary: binaryPath,
		Environment: []string{
			"API_TOKEN=token-value",
			"AWS_SECRET_ACCESS_KEY=state-secret",
		},
	}
	resources, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-1", "start"),
		&logs,
	)
	if err != nil {
		t.Fatalf("execute fake Terraform: %v", err)
	}
	if strings.Contains(logs.String(), "state-secret") ||
		strings.Contains(logs.String(), "token-value") {
		t.Fatalf("secret leaked into logs: %s", logs.String())
	}
	if !strings.Contains(logs.String(), "[REDACTED]") {
		t.Fatalf("logs do not show redaction marker: %s", logs.String())
	}
	if resources["public"] != "ok" {
		t.Fatalf("public output = %#v", resources)
	}
	if _, found := resources["private"]; found {
		t.Fatalf("sensitive output escaped into resource summary: %#v", resources)
	}
}

func TestRunnerTimeoutKillsTerraformProcessGroup(t *testing.T) {
	directory := t.TempDir()
	childPIDPath := filepath.Join(directory, "child.pid")
	binaryPath := writeFakeTerraform(t, directory, `
if [ "$1" = plan ]; then
  sleep 30 &
  echo "$!" > "$CHILD_PID_PATH"
  wait
fi
`)
	runner := Runner{
		Binary:      binaryPath,
		Environment: []string{"CHILD_PID_PATH=" + childPIDPath},
		Timeout:     200 * time.Millisecond,
	}
	_, err := runner.Execute(
		context.Background(),
		directory,
		testWorkspaceContext("workspace-timeout", "start"),
		&bytes.Buffer{},
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout result = %v", err)
	}
	payload, err := os.ReadFile(childPIDPath)
	if err != nil {
		t.Fatalf("read child PID: %v", err)
	}
	childPID, err := strconv.Atoi(strings.TrimSpace(string(payload)))
	if err != nil {
		t.Fatalf("parse child PID: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for processExists(childPID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if processExists(childPID) {
		t.Fatalf("Terraform child process %d survived timeout", childPID)
	}
}

func TestRunnerHonorsCallerCancellation(t *testing.T) {
	directory := t.TempDir()
	readyPath := filepath.Join(directory, "ready")
	binaryPath := writeFakeTerraform(t, directory, `
if [ "$1" = plan ]; then
  touch "$READY_PATH"
  sleep 30
fi
`)
	runner := Runner{
		Binary:      binaryPath,
		Environment: []string{"READY_PATH=" + readyPath},
		Timeout:     time.Minute,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := runner.Execute(
			ctx,
			directory,
			testWorkspaceContext("workspace-cancelled", "start"),
			&bytes.Buffer{},
		)
		done <- err
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(readyPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Terraform plan did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel result = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Terraform did not stop after caller cancellation")
	}
}

func TestRunnerReturnsPlanFailure(t *testing.T) {
	directory := t.TempDir()
	binaryPath := writeFakeTerraform(t, directory, `
if [ "$1" = plan ]; then
  echo "invalid template" >&2
  exit 2
fi
`)
	var logs bytes.Buffer
	runner := Runner{Binary: binaryPath}
	_, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-failure", "start"),
		&logs,
	)
	if err == nil || !strings.Contains(err.Error(), "terraform plan") {
		t.Fatalf("plan failure = %v", err)
	}
	if !strings.Contains(logs.String(), "invalid template") {
		t.Fatalf("plan stderr was not streamed: %s", logs.String())
	}
}

func TestRunnerReportsPartialApplyAndRemovesPlan(t *testing.T) {
	directory := t.TempDir()
	markerPath := filepath.Join(directory, "partial-apply")
	binaryPath := writeFakeTerraform(t, directory, `
if [ "$1" = plan ]; then
  for argument in "$@"; do
    case "$argument" in
      -out=*) touch "${argument#-out=}" ;;
    esac
  done
fi
if [ "$1" = apply ]; then
  touch "$PARTIAL_APPLY_MARKER"
  exit 1
fi
`)
	runner := Runner{
		Binary:      binaryPath,
		Environment: []string{"PARTIAL_APPLY_MARKER=" + markerPath},
	}
	_, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-partial", "start"),
		&bytes.Buffer{},
	)
	if err == nil || !strings.Contains(err.Error(), "terraform apply") {
		t.Fatalf("partial apply result = %v", err)
	}
	if _, err := os.Stat(markerPath); err != nil {
		t.Fatalf("partial apply marker is unavailable: %v", err)
	}
	if _, err := os.Stat(filepath.Join(directory, planFileName)); !os.IsNotExist(err) {
		t.Fatalf("Terraform plan was not removed: %v", err)
	}
}

func TestRedactingWriterHandlesSplitSecrets(t *testing.T) {
	var destination bytes.Buffer
	writer := newRedactingWriter(&destination, []string{"split-secret"})
	_, _ = writer.Write([]byte("value=split-"))
	_, _ = writer.Write([]byte("secret\n"))
	if err := writer.Flush(); err != nil {
		t.Fatalf("flush redacting writer: %v", err)
	}
	if destination.String() != "value=[REDACTED]\n" {
		t.Fatalf("redacted output = %q", destination.String())
	}
}

func writeFakeTerraform(t *testing.T, directory string, body string) string {
	t.Helper()
	binaryPath := filepath.Join(directory, "terraform-fake")
	script := "#!/bin/sh\nset -eu\n" + body
	if err := os.WriteFile(binaryPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake Terraform: %v", err)
	}
	return binaryPath
}

func processExists(processID int) bool {
	err := syscall.Kill(processID, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func TestRunnerAppliesThePlanItPreviewed(t *testing.T) {
	directory := t.TempDir()
	tracePath := filepath.Join(directory, "terraform.trace")
	binaryPath := filepath.Join(directory, "terraform")
	script := "#!/bin/sh\n"
	script += "printf '%s\\n' \"$*\" >> \"$ZAW_TERRAFORM_TRACE\"\n"
	script += "if [ \"$1\" = output ]; then echo '{\"resource\":{\"value\":\"ok\"}}'; fi\n"
	if err := os.WriteFile(binaryPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake Terraform: %v", err)
	}
	runner := Runner{
		Binary:      binaryPath,
		Environment: []string{"ZAW_TERRAFORM_TRACE=" + tracePath},
	}
	resources, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-1", "start"),
		&bytes.Buffer{},
	)
	if err != nil {
		t.Fatalf("execute Terraform: %v", err)
	}
	if resources["resource"] != "ok" {
		t.Fatalf("Terraform output = %#v", resources)
	}
	trace, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("read Terraform trace: %v", err)
	}
	planPath := filepath.Join(directory, planFileName)
	wantPlan := "plan -input=false -out=" + planPath
	wantApply := "apply -auto-approve -input=false " + planPath
	if !strings.Contains(string(trace), wantPlan) {
		t.Fatalf("Terraform did not write a plan file: %s", trace)
	}
	if !strings.Contains(string(trace), wantApply) {
		t.Fatalf("Terraform did not apply its plan file: %s", trace)
	}
}

func TestRunnerAppliesSavedDestroyPlan(t *testing.T) {
	directory := t.TempDir()
	tracePath := filepath.Join(directory, "terraform.trace")
	binaryPath := writeFakeTerraform(t, directory, `
printf '%s\n' "$*" >> "$ZAW_TERRAFORM_TRACE"
`)
	runner := Runner{
		Binary:      binaryPath,
		Environment: []string{"ZAW_TERRAFORM_TRACE=" + tracePath},
	}
	if _, err := runner.Execute(
		t.Context(),
		directory,
		testWorkspaceContext("workspace-1", "delete"),
		&bytes.Buffer{},
	); err != nil {
		t.Fatalf("destroy Terraform resources: %v", err)
	}
	trace, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("read Terraform trace: %v", err)
	}
	planPath := filepath.Join(directory, planFileName)
	wantPlan := "plan -input=false -out=" + planPath + " -destroy"
	wantApply := "apply -auto-approve -input=false " + planPath
	if !strings.Contains(string(trace), wantPlan) {
		t.Fatalf("Terraform did not save a destroy plan: %s", trace)
	}
	if !strings.Contains(string(trace), wantApply) {
		t.Fatalf("Terraform did not apply its destroy plan: %s", trace)
	}
	if strings.Contains(string(trace), "destroy -auto-approve") {
		t.Fatalf("Terraform bypassed the saved destroy plan: %s", trace)
	}
}

func testWorkspaceContext(id string, transition string) WorkspaceContext {
	return WorkspaceContext{
		ID:         id,
		Name:       id,
		Transition: transition,
		ServerURL:  "https://zaw.example",
	}
}
