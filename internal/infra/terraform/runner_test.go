package terraform

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
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
		"workspace-real",
		"create",
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
		"workspace-real",
		"delete",
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
		"workspace-1",
		"start",
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
		"workspace-timeout",
		"start",
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
			"workspace-cancelled",
			"start",
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
		"workspace-failure",
		"start",
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
		"workspace-partial",
		"start",
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
		"workspace-1",
		"start",
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
