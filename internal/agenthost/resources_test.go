package agenthost

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
)

func TestWorkspaceChangeDiffStageAndRestore(t *testing.T) {
	workspace := t.TempDir()
	runGit(t, workspace, "init")
	runGit(t, workspace, "config", "user.email", "zaw@example.test")
	runGit(t, workspace, "config", "user.name", "Zaw Test")
	file := filepath.Join(workspace, "README.md")
	if err := os.WriteFile(file, []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, workspace, "add", "README.md")
	runGit(t, workspace, "commit", "-m", "initial")
	if err := os.WriteFile(file, []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	host := New()
	host.workDir = workspace
	diff, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":1,"method":"workspaceDiff",
		"params":{"path":"README.md"}
	}`))
	if !strings.Contains(string(diff), "-before") ||
		!strings.Contains(string(diff), "+after") {
		t.Fatalf("unexpected diff: %s", diff)
	}
	stage, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":2,"method":"workspaceStage",
		"params":{"path":"README.md"}
	}`))
	if !strings.Contains(string(stage), `"result"`) {
		t.Fatalf("stage failed: %s", stage)
	}
	restore, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":3,"method":"workspaceRevert",
		"params":{"path":"README.md"}
	}`))
	if !strings.Contains(string(restore), `"result"`) {
		t.Fatalf("restore failed: %s", restore)
	}
	contents, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "before\n" {
		t.Fatalf("restored contents = %q", contents)
	}
}

func TestStandardChangesetSnapshotReviewAndOperation(t *testing.T) {
	workspace := t.TempDir()
	runGit(t, workspace, "init")
	runGit(t, workspace, "config", "user.email", "zaw@example.test")
	runGit(t, workspace, "config", "user.name", "Zaw Test")
	file := filepath.Join(workspace, "README.md")
	if err := os.WriteFile(file, []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, workspace, "add", "README.md")
	runGit(t, workspace, "commit", "-m", "initial")
	if err := os.WriteFile(file, []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	host := New()
	host.workDir = workspace
	snapshot, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":1,"method":"subscribe",
		"params":{"channel":"ahp-changeset:/working-tree"}
	}`))
	if !strings.Contains(string(snapshot), `"operationId"`) &&
		!strings.Contains(string(snapshot), `"id":"stage"`) {
		t.Fatalf("changeset operations are missing: %s", snapshot)
	}
	if !strings.Contains(string(snapshot), "-before") ||
		!strings.Contains(string(snapshot), "+after") {
		t.Fatalf("changeset diff is missing: %s", snapshot)
	}
	host.handle([]byte(`{
		"jsonrpc":"2.0","method":"dispatchAction",
		"params":{
			"channel":"ahp-changeset:/working-tree",
			"action":{
				"type":"changeset/filesReviewChanged",
				"files":["README.md"],"reviewed":true
			}
		}
	}`))
	host.mu.Lock()
	reviewed := host.changeset.Files[0].Reviewed
	host.mu.Unlock()
	if reviewed == nil || !*reviewed {
		t.Fatal("standard changeset review action was not applied")
	}
	params := ahptypes.InvokeChangesetOperationParams{
		Channel:     workingTreeChangesetResource,
		OperationId: "stage",
		Target: &ahptypes.ChangesetOperationTarget{
			Value: &ahptypes.ChangesetOperationResourceTarget{
				Kind:     "resource",
				Resource: ahptypes.URI("file://" + filepath.ToSlash(file)),
			},
		},
	}
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "invokeChangesetOperation",
		"params":  params,
	})
	if err != nil {
		t.Fatal(err)
	}
	response, _ := host.handle(payload)
	if !strings.Contains(string(response), `"result"`) {
		t.Fatalf("standard changeset operation failed: %s", response)
	}
	staged := exec.Command("git", "-C", workspace, "diff", "--cached", "--name-only")
	output, err := staged.Output()
	if err != nil || strings.TrimSpace(string(output)) != "README.md" {
		t.Fatalf("changeset stage did not update Git index: %v %s", err, output)
	}
}

func TestWorkspaceChangeRejectsPathEscape(t *testing.T) {
	host := New()
	response, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":1,"method":"workspaceDiff",
		"params":{"path":"../outside"}
	}`))
	if !strings.Contains(string(response), `"error"`) {
		t.Fatalf("path escape was accepted: %s", response)
	}
}

func TestWorkspaceChangeDiffAndRestoreUntrackedFile(t *testing.T) {
	workspace := t.TempDir()
	runGit(t, workspace, "init")
	file := filepath.Join(workspace, "created.txt")
	if err := os.WriteFile(file, []byte("created\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	host := New()
	host.workDir = workspace
	diff, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":1,"method":"workspaceDiff",
		"params":{"path":"created.txt"}
	}`))
	if !strings.Contains(string(diff), "+created") {
		t.Fatalf("unexpected untracked diff: %s", diff)
	}
	restore, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":2,"method":"workspaceRevert",
		"params":{"path":"created.txt"}
	}`))
	if !strings.Contains(string(restore), `"result"`) {
		t.Fatalf("restore failed: %s", restore)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("untracked file remains after restore: %v", err)
	}
}

func runGit(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", directory}, args...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}
