package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fixedSourceResolver struct{}

func (fixedSourceResolver) ResolveGit(
	context.Context,
	string,
	string,
	string,
) (string, error) {
	return "0123456789012345678901234567890123456789", nil
}

func (fixedSourceResolver) ResolveTar(
	context.Context,
	string,
	string,
	string,
) (string, string, error) {
	return "0123456789012345678901234567890123456789012345678901234567890123", "tar.gz", nil
}

func TestControlPlaneCreatesPinnedWorkspaceAndClaimsBuild(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	server := New(
		database,
		fixedSourceResolver{},
		&memorySecretStore{values: map[string]map[string]string{}},
	)
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	createdTemplate := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/templates",
		map[string]any{
			"name": "Ubuntu 24.04",
			"source": map[string]any{
				"kind": "git",
				"url":  "https://example.test/ubuntu-template.git",
				"ref":  "main",
			},
		},
	)
	if createdTemplate.Code != http.StatusCreated {
		t.Fatalf("create template status = %d: %s", createdTemplate.Code, createdTemplate.Body.String())
	}
	var template templateView
	if err := json.NewDecoder(createdTemplate.Body).Decode(&template); err != nil {
		t.Fatalf("decode template: %v", err)
	}
	if template.Source.Commit != "0123456789012345678901234567890123456789" {
		t.Fatalf("template source was not pinned: %#v", template.Source)
	}

	createdWorkspace := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces",
		map[string]any{
			"name":       "development",
			"templateId": template.ID,
			"parameters": map[string]any{"cpu": 2},
		},
	)
	if createdWorkspace.Code != http.StatusCreated {
		t.Fatalf(
			"create workspace status = %d: %s",
			createdWorkspace.Code,
			createdWorkspace.Body.String(),
		)
	}
	var workspaceIDs map[string]string
	if err := json.NewDecoder(createdWorkspace.Body).Decode(&workspaceIDs); err != nil {
		t.Fatalf("decode workspace identifiers: %v", err)
	}
	invalidOperation := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces/"+workspaceIDs["id"]+"/builds",
		map[string]string{"operation": "explode"},
	)
	if invalidOperation.Code != http.StatusBadRequest {
		t.Fatalf("invalid operation status = %d", invalidOperation.Code)
	}
	illegalTransition := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces/"+workspaceIDs["id"]+"/builds",
		map[string]string{"operation": "start"},
	)
	if illegalTransition.Code != http.StatusConflict {
		t.Fatalf("illegal transition status = %d", illegalTransition.Code)
	}

	registered := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/provisioners/register",
		map[string]any{
			"name": "local-incus",
			"capabilities": map[string]any{
				"terraform": true,
			},
		},
	)
	if registered.Code != http.StatusCreated {
		t.Fatalf("register provisioner status = %d: %s", registered.Code, registered.Body.String())
	}
	var provisioner map[string]string
	if err := json.NewDecoder(registered.Body).Decode(&provisioner); err != nil {
		t.Fatalf("decode provisioner: %v", err)
	}
	heartbeat := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/provisioners/"+provisioner["id"]+"/heartbeat",
		nil,
	)
	if heartbeat.Code != http.StatusNoContent {
		t.Fatalf("heartbeat status = %d", heartbeat.Code)
	}
	claimed := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/provisioners/"+provisioner["id"]+"/claim",
		nil,
	)
	if claimed.Code != http.StatusOK {
		t.Fatalf("claim build status = %d: %s", claimed.Code, claimed.Body.String())
	}
	var claim struct {
		ID    string                 `json:"id"`
		Build storage.WorkspaceBuild `json:"build"`
	}
	if err := json.NewDecoder(claimed.Body).Decode(&claim); err != nil {
		t.Fatalf("decode claimed job: %v", err)
	}
	if claim.Build.Status != "claimed" || claim.Build.StartedAt == nil {
		t.Fatalf("claimed build lifecycle is incomplete: %#v", claim.Build)
	}
	invalidEvent := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/provisioners/"+provisioner["id"]+"/jobs/"+claim.ID+"/events",
		map[string]string{"status": "unknown"},
	)
	if invalidEvent.Code != http.StatusBadRequest {
		t.Fatalf("invalid build event status = %d", invalidEvent.Code)
	}
	completed := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/provisioners/"+provisioner["id"]+"/jobs/"+claim.ID+"/events",
		map[string]any{
			"type":      "completed",
			"message":   "terraform apply complete",
			"status":    "succeeded",
			"resources": map[string]any{"instance_id": "incus-workspace"},
		},
	)
	if completed.Code != http.StatusNoContent {
		t.Fatalf("complete build status = %d: %s", completed.Code, completed.Body.String())
	}
	for path, expected := range map[string]string{
		"/api/v1/builds":           claim.Build.ID,
		"/api/v1/provisioners":     provisioner["id"],
		"/api/v1/provisioner-jobs": claim.ID,
	} {
		listed := request(t, server.Handler(), http.MethodGet, path, nil)
		if listed.Code != http.StatusOK ||
			!strings.Contains(listed.Body.String(), expected) {
			t.Fatalf("runtime list %s = %d: %s", path, listed.Code, listed.Body.String())
		}
	}
	buildLogs := request(
		t,
		server.Handler(),
		http.MethodGet,
		"/api/v1/builds/"+claim.Build.ID+"/logs",
		nil,
	)
	if buildLogs.Code != http.StatusOK ||
		!strings.Contains(buildLogs.Body.String(), "terraform apply complete") {
		t.Fatalf("build logs = %d: %s", buildLogs.Code, buildLogs.Body.String())
	}

	telemetry := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/agent-hosts/"+workspaceIDs["id"]+"/telemetry",
		map[string]any{"health": "ok", "cpuPercent": 2.5, "memoryBytes": 4096},
	)
	if telemetry.Code != http.StatusNoContent {
		t.Fatalf("agent host telemetry status = %d", telemetry.Code)
	}

	workspace := request(
		t,
		server.Handler(),
		http.MethodGet,
		"/api/v1/workspaces/"+workspaceIDs["id"],
		nil,
	)
	if workspace.Code != http.StatusOK {
		t.Fatalf("get workspace status = %d: %s", workspace.Code, workspace.Body.String())
	}
	var view workspaceView
	if err := json.NewDecoder(workspace.Body).Decode(&view); err != nil {
		t.Fatalf("decode workspace: %v", err)
	}
	if string(view.SourceSnapshot) == "" || view.CurrentBuildID == "" {
		t.Fatalf("workspace did not retain source snapshot and build: %#v", view)
	}
	if view.ObservedState != "running" || view.AgentHostTelemetry == nil {
		t.Fatalf("workspace lifecycle or Agent Host metadata missing: %#v", view)
	}
	liveServer := httptest.NewServer(server.Handler())
	defer liveServer.Close()
	hostEndpoint := "ws" + strings.TrimPrefix(liveServer.URL, "http")
	hostEndpoint += "/api/v1/agent-hosts/" + workspaceIDs["id"] + "/ahp"
	host, _, err := websocket.DefaultDialer.Dial(hostEndpoint, nil)
	if err != nil {
		t.Fatalf("connect Agent Host before stop: %v", err)
	}
	defer host.Close()
	stopBuild := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces/"+workspaceIDs["id"]+"/builds",
		map[string]string{"operation": "stop"},
	)
	if stopBuild.Code != http.StatusAccepted {
		t.Fatalf("stop build status = %d: %s", stopBuild.Code, stopBuild.Body.String())
	}
	host.SetReadDeadline(time.Now().Add(time.Second))
	for {
		if _, _, err := host.ReadMessage(); err != nil {
			break
		}
	}
	if _, response, err := websocket.DefaultDialer.Dial(hostEndpoint, nil); err == nil ||
		response == nil || response.StatusCode != http.StatusConflict {
		t.Fatalf("stopped Workspace Agent Host response = %#v, error = %v", response, err)
	}
	repeatedStop := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces/"+workspaceIDs["id"]+"/builds",
		map[string]string{"operation": "stop"},
	)
	if repeatedStop.Code != http.StatusConflict {
		t.Fatalf("repeated stop status = %d", repeatedStop.Code)
	}
	startBuild := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces/"+workspaceIDs["id"]+"/builds",
		map[string]string{"operation": "start"},
	)
	if startBuild.Code != http.StatusAccepted {
		t.Fatalf("start build status = %d: %s", startBuild.Code, startBuild.Body.String())
	}
	deleteBuild := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/workspaces/"+workspaceIDs["id"]+"/builds",
		map[string]string{"operation": "delete"},
	)
	if deleteBuild.Code != http.StatusAccepted {
		t.Fatalf("delete build status = %d: %s", deleteBuild.Code, deleteBuild.Body.String())
	}
	listedWorkspaces := request(
		t,
		server.Handler(),
		http.MethodGet,
		"/api/v1/workspaces",
		nil,
	)
	if listedWorkspaces.Code != http.StatusOK ||
		strings.Contains(listedWorkspaces.Body.String(), workspaceIDs["id"]) {
		t.Fatalf(
			"deleted Workspace remained in active list: %d %s",
			listedWorkspaces.Code,
			listedWorkspaces.Body.String(),
		)
	}

	var auditActions []string
	if err := database.Model(&storage.AuditLog{}).
		Order("created_at").
		Pluck("action", &auditActions).Error; err != nil {
		t.Fatalf("read audit log: %v", err)
	}
	for _, expected := range []string{
		"template.created",
		"workspace.created",
		"provisioner.registered",
		"workspace.build_requested",
	} {
		if !contains(auditActions, expected) {
			t.Fatalf("audit action %q missing from %v", expected, auditActions)
		}
	}
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
