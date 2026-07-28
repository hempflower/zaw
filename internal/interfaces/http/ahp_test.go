package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zaw-dev/zaw/internal/ahpmux"
	"github.com/zaw-dev/zaw/internal/infra/agentidentity"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAHPGatewayRejectsCrossOriginBrowserConnections(t *testing.T) {
	request := httptest.NewRequest("GET", "http://zaw.example/ahp", nil)
	request.Host = "zaw.example"
	request.Header.Set("Origin", "https://untrusted.example")
	if ahpUpgrader.CheckOrigin(request) {
		t.Fatal("cross-origin Browser AHP connection was accepted")
	}
	request.Header.Set("Origin", "https://zaw.example")
	if !ahpUpgrader.CheckOrigin(request) {
		t.Fatal("same-origin Browser AHP connection was rejected")
	}
}

func TestAgentHostAHPRequiresScopedRegistrationCredential(t *testing.T) {
	identity, err := agentidentity.New(strings.Repeat("s", 32))
	if err != nil {
		t.Fatal(err)
	}
	server := NewWithAgentIdentity(nil, nil, nil, identity)
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	endpoint := "ws" + strings.TrimPrefix(testServer.URL, "http")
	endpoint += "/api/v1/agent-hosts/workspace-1/ahp"
	if _, response, err := websocket.DefaultDialer.Dial(endpoint, nil); err == nil ||
		response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated Agent Host response = %#v, error = %v", response, err)
	}

	token, err := identity.IssueRegistration("workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{"Authorization": []string{"Bearer " + token}}
	wrongEndpoint := "ws" + strings.TrimPrefix(testServer.URL, "http")
	wrongEndpoint += "/api/v1/agent-hosts/workspace-2/ahp"
	if _, response, err := websocket.DefaultDialer.Dial(wrongEndpoint, headers); err == nil ||
		response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cross-Workspace credential response = %#v, error = %v", response, err)
	}
	host, _, err := websocket.DefaultDialer.Dial(endpoint, headers)
	if err != nil {
		t.Fatalf("connect authenticated Agent Host: %v", err)
	}
	defer host.Close()
}

func TestAgentHostTelemetryUsesRegistrationCredential(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatal(err)
	}
	identity, err := agentidentity.New(strings.Repeat("t", 32))
	if err != nil {
		t.Fatal(err)
	}
	token, err := identity.IssueRegistration("workspace-telemetry")
	if err != nil {
		t.Fatal(err)
	}
	server := NewWithAgentIdentity(database, nil, nil, identity)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/agent-hosts/workspace-telemetry/telemetry",
		strings.NewReader(`{"health":"ok","cpuPercent":1.5,"memoryBytes":2048}`),
	)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("telemetry response = %d: %s", recorder.Code, recorder.Body.String())
	}
	request = httptest.NewRequest(
		http.MethodPost,
		"/api/v1/agent-hosts/workspace-telemetry/telemetry",
		strings.NewReader(`{"health":"ok","cpuPercent":2.5,"memoryBytes":4096}`),
	)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("second telemetry response = %d: %s", recorder.Code, recorder.Body.String())
	}
	var host storage.AgentHost
	err = database.
		Where("workspace_id = ?", "workspace-telemetry").
		First(&host).Error
	if err != nil {
		t.Fatalf("read Agent Host registry row: %v", err)
	}
	if host.Status != "online" || !strings.Contains(string(host.LastTelemetry), `"memoryBytes":4096`) {
		t.Fatalf("unexpected Agent Host telemetry: %#v", host)
	}
	var rows int64
	if err := database.Model(&storage.AgentHost{}).
		Where("workspace_id = ?", "workspace-telemetry").Count(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("Agent Host telemetry rows = %d, want 1", rows)
	}
}

func TestAHPGatewayForwardsFramesWithoutMutation(t *testing.T) {
	server := &Server{ahp: newAHPGateway()}
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	baseURL := "ws" + strings.TrimPrefix(testServer.URL, "http")

	host, _, err := websocket.DefaultDialer.Dial(
		baseURL+"/api/v1/agent-hosts/workspace-1/ahp",
		nil,
	)
	if err != nil {
		t.Fatalf("connect agent host: %v", err)
	}
	defer host.Close()

	client, _, err := websocket.DefaultDialer.Dial(
		baseURL+"/api/v1/workspaces/workspace-1/ahp",
		nil,
	)
	if err != nil {
		t.Fatalf("connect workbench: %v", err)
	}
	defer client.Close()
	host.SetReadDeadline(time.Now().Add(time.Second))
	_, openPayload, err := host.ReadMessage()
	if err != nil {
		t.Fatalf("read Mux open frame: %v", err)
	}
	var open ahpmux.Frame
	if json.Unmarshal(openPayload, &open) != nil || open.Type != ahpmux.FrameOpen {
		t.Fatalf("unexpected Mux open frame: %s", openPayload)
	}
	if err := host.WriteMessage(websocket.TextMessage, ahpmux.Marshal(ahpmux.Frame{
		Type:     ahpmux.FrameOpened,
		StreamID: open.StreamID,
	})); err != nil {
		t.Fatalf("acknowledge Mux stream: %v", err)
	}

	hostPayload := []byte(`{"jsonrpc":"2.0","method":"action","params":{"serverSeq":7}}`)
	if err := host.WriteMessage(websocket.TextMessage, ahpmux.Marshal(ahpmux.Frame{
		Type:     ahpmux.FrameData,
		StreamID: open.StreamID,
		Payload:  hostPayload,
	})); err != nil {
		t.Fatalf("write host frame: %v", err)
	}
	client.SetReadDeadline(time.Now().Add(time.Second))
	_, clientPayload, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("read forwarded host frame: %v", err)
	}
	if string(clientPayload) != string(hostPayload) {
		t.Fatalf("gateway mutated host frame: %s", clientPayload)
	}

	workbenchPayload := []byte(`{"jsonrpc":"2.0","id":9,"method":"subscribe"}`)
	if err := client.WriteMessage(websocket.TextMessage, workbenchPayload); err != nil {
		t.Fatalf("write workbench frame: %v", err)
	}
	host.SetReadDeadline(time.Now().Add(time.Second))
	_, forwardedPayload, err := host.ReadMessage()
	if err != nil {
		t.Fatalf("read forwarded workbench frame: %v", err)
	}
	var forwarded ahpmux.Frame
	if json.Unmarshal(forwardedPayload, &forwarded) != nil ||
		forwarded.StreamID != open.StreamID ||
		string(forwarded.Payload) != string(workbenchPayload) {
		t.Fatalf("gateway routed an invalid workbench frame: %s", forwardedPayload)
	}
}

func TestAHPGatewayRejectsOfflineWorkspace(t *testing.T) {
	server := &Server{ahp: newAHPGateway()}
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	baseURL := "ws" + strings.TrimPrefix(testServer.URL, "http")
	_, response, err := websocket.DefaultDialer.Dial(
		baseURL+"/api/v1/workspaces/offline/ahp",
		nil,
	)
	if err == nil {
		t.Fatal("expected offline workspace connection to be rejected")
	}
	if response == nil || response.StatusCode != 503 {
		t.Fatalf("expected HTTP 503, got %#v", response)
	}
}

func TestAHPGatewayLetsNewestDuplicateHostTakeOver(t *testing.T) {
	server := &Server{ahp: newAHPGateway()}
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	endpoint := "ws" + strings.TrimPrefix(testServer.URL, "http")
	endpoint += "/api/v1/agent-hosts/workspace-1/ahp"
	first, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatalf("connect first host: %v", err)
	}
	defer first.Close()
	second, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatalf("connect replacement host: %v", err)
	}
	defer second.Close()
	first.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := first.ReadMessage(); err == nil {
		t.Fatal("older duplicate Agent Host connection remained active")
	}
	if !server.ahp.isOnline("workspace-1") {
		t.Fatal("replacement Agent Host was not registered online")
	}
}

func TestAgentHostStatusTracksLiveAHPConnection(t *testing.T) {
	server := &Server{ahp: newAHPGateway()}
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	workspaceID := "workspace-1"
	if got := server.agentHostState(workspaceID); got != "offline" {
		t.Fatalf("initial status = %q, want offline", got)
	}
	baseURL := "ws" + strings.TrimPrefix(testServer.URL, "http")
	host, _, err := websocket.DefaultDialer.Dial(
		baseURL+"/api/v1/agent-hosts/"+workspaceID+"/ahp",
		nil,
	)
	if err != nil {
		t.Fatalf("connect agent host: %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for server.agentHostState(workspaceID) != "online" && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := server.agentHostState(workspaceID); got != "online" {
		_ = host.Close()
		t.Fatalf("connected status = %q, want online", got)
	}
	_ = host.Close()
	deadline = time.Now().Add(time.Second)
	for server.agentHostState(workspaceID) != "offline" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := server.agentHostState(workspaceID); got != "offline" {
		t.Fatalf("disconnected status = %q, want offline", got)
	}
}
