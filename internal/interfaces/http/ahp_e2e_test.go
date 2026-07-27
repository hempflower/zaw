package httptransport_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
	"github.com/zaw-dev/zaw/internal/infra/agentidentity"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	httptransport "github.com/zaw-dev/zaw/internal/interfaces/http"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAgentHostSessionFlowsThroughAHPGateway(t *testing.T) {
	controlPlane := httptransport.New(nil, nil, nil)
	testServer := httptest.NewServer(controlPlane.Handler())
	defer testServer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	workspaceDir := t.TempDir()
	go func() {
		_ = agenthost.RunWithRuntime(ctx, agenthost.Config{
			ServerURL:    testServer.URL,
			WorkspaceID:  "workspace-1",
			WorkspaceDir: workspaceDir,
		}, newFakeAgentRuntime())
	}()

	endpoint := "ws" + strings.TrimPrefix(testServer.URL, "http")
	endpoint += "/api/v1/workspaces/workspace-1/ahp"
	client := dialAHPClient(t, endpoint)
	defer client.Close()

	writeRPCRequest(t, client, 1, "initialize", map[string]any{
		"channel":              "ahp-root://",
		"clientId":             "e2e-client",
		"protocolVersions":     ahptypes.SupportedProtocolVersions(),
		"initialSubscriptions": []string{"ahp-root://"},
	})
	response := readRPCFrame(t, client)
	if resultProtocolVersion(t, response) != ahptypes.ProtocolVersion {
		t.Fatalf("unexpected negotiated protocol: %s", response)
	}

	writeRPCRequest(t, client, 2, "createSession", map[string]any{
		"channel": "ahp-session:/session-1",
		"title":   "Persistent on Host",
	})
	createResponse := readRPCFrame(t, client)
	if !strings.Contains(string(createResponse), `"result":{}`) {
		t.Fatalf("missing createSession result: %s", createResponse)
	}
	notification := readRPCFrame(t, client)
	if !strings.Contains(string(notification), "root/sessionAdded") {
		t.Fatalf("missing session notification: %s", notification)
	}
	writeRPCRequest(t, client, 20, "subscribe", map[string]any{
		"channel": "ahp-session:/session-1",
	})
	assertRPCFrameResult(t, readRPCFrame(t, client))
	writeRPCRequest(t, client, 21, "subscribe", map[string]any{
		"channel": "ahp-chat:/session-1",
	})
	assertRPCFrameResult(t, readRPCFrame(t, client))

	writeRPCRequest(t, client, 3, "listSessions", map[string]any{
		"channel": "ahp-root://",
	})
	listResponse := readRPCFrame(t, client)
	if !strings.Contains(string(listResponse), "New Session") {
		t.Fatalf("session was not retained by Agent Host: %s", listResponse)
	}

	writeRPCRequest(t, client, 4, "promptSession", map[string]any{
		"channel": "ahp-session:/session-1",
		"text":    "hello agent",
	})
	deadline := time.Now().Add(time.Second)
	gotPromptResponse := false
	gotTextUpdate := false
	gotToolUpdate := false
	gotPermission := false
	for time.Now().Before(deadline) &&
		(!gotPromptResponse || !gotTextUpdate || !gotToolUpdate || !gotPermission) {
		frame := readRPCFrame(t, client)
		gotPromptResponse = gotPromptResponse || strings.Contains(string(frame), `"accepted":true`)
		gotTextUpdate = gotTextUpdate || strings.Contains(string(frame), "chat/delta")
		gotToolUpdate = gotToolUpdate || strings.Contains(string(frame), "chat/toolCallComplete")
		if strings.Contains(string(frame), "chat/toolCallReady") {
			gotPermission = true
			turnID, toolCallID := toolConfirmationIDs(t, frame)
			permissionResponse, _ := json.Marshal(map[string]any{
				"jsonrpc": "2.0",
				"method":  "dispatchAction",
				"params": map[string]any{
					"channel":   "ahp-chat:/session-1",
					"clientSeq": 1,
					"action": map[string]any{
						"type":       "chat/toolCallConfirmed",
						"turnId":     turnID,
						"toolCallId": toolCallID,
						"approved":   true,
						"confirmed":  "user-action",
					},
				},
			})
			if err := client.WriteMessage(websocket.TextMessage, permissionResponse); err != nil {
				t.Fatalf("respond to Agent SDK permission request: %v", err)
			}
		}
	}
	if !gotPromptResponse || !gotTextUpdate || !gotToolUpdate || !gotPermission {
		t.Fatal("Agent SDK text, tool, permission, or prompt response was not received")
	}
	writeRPCRequest(t, client, 5, "cancelSession", map[string]any{
		"channel": "ahp-session:/session-1",
	})
	for {
		frame := readRPCFrame(t, client)
		if strings.Contains(string(frame), `"id":5`) &&
			strings.Contains(string(frame), `"result"`) {
			break
		}
	}
	writeRPCRequest(t, client, 6, "promptSession", map[string]any{
		"channel": "ahp-session:/session-1",
		"text":    "fail prompt",
	})
	gotAccepted := false
	gotError := false
	for !gotAccepted || !gotError {
		frame := readRPCFrame(t, client)
		gotAccepted = gotAccepted || strings.Contains(string(frame), `"accepted":true`)
		gotError = gotError || strings.Contains(string(frame), "chat/error")
	}
}

func TestConnectedAgentHostStopsWhenItsContextIsCanceled(t *testing.T) {
	controlPlane := httptransport.New(nil, nil, nil)
	testServer := httptest.NewServer(controlPlane.Handler())
	defer testServer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- agenthost.RunWithRuntime(ctx, agenthost.Config{
			ServerURL:    testServer.URL,
			WorkspaceID:  "workspace-cancel",
			WorkspaceDir: t.TempDir(),
		}, newFakeAgentRuntime())
	}()
	endpoint := "ws" + strings.TrimPrefix(testServer.URL, "http")
	endpoint += "/api/v1/workspaces/workspace-cancel/ahp"
	client := dialAHPClient(t, endpoint)
	defer client.Close()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stop connected Agent Host: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("connected Agent Host did not stop after context cancellation")
	}
}

func TestServerCatalogUsesOfficialAHPClientAndReconcilesOnReconnect(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(filepath.Join(t.TempDir(), "session-catalog.db")),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatal(err)
	}
	workspaceID := "workspace-catalog"
	if err := database.Create(&storage.Workspace{
		ID:              workspaceID,
		OrganizationID:  "organization-catalog",
		Name:            "Catalog",
		OwnerID:         "owner-catalog",
		TemplateID:      "template-catalog",
		SourceSnapshot:  datatypes.JSON(`{}`),
		ParameterValues: datatypes.JSON(`{}`),
		DesiredState:    "running",
		ObservedState:   "running",
	}).Error; err != nil {
		t.Fatal(err)
	}
	controlPlane := httptransport.New(database, nil, nil)
	testServer := httptest.NewServer(controlPlane.Handler())
	defer testServer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = agenthost.RunWithRuntime(ctx, agenthost.Config{
			ServerURL:    testServer.URL,
			WorkspaceID:  workspaceID,
			WorkspaceDir: t.TempDir(),
		}, newFakeAgentRuntime())
	}()
	endpoint := "ws" + strings.TrimPrefix(testServer.URL, "http")
	endpoint += "/api/v1/workspaces/" + workspaceID + "/ahp"
	client := dialAHPClientWithDeadline(t, endpoint, 5*time.Second)
	writeRPCRequest(t, client, 1, "initialize", map[string]any{
		"channel":              ahptypes.RootResourceURI,
		"clientId":             "catalog-e2e-client",
		"protocolVersions":     ahptypes.SupportedProtocolVersions(),
		"initialSubscriptions": []string{ahptypes.RootResourceURI},
	})
	_ = readRPCFrame(t, client)
	writeRPCRequest(t, client, 2, "createSession", map[string]any{
		"channel": "ahp-session:/catalog-session",
	})
	_ = readRPCFrame(t, client)
	_ = readRPCFrame(t, client)
	initial := waitForCatalogState(t, testServer.URL, true, false, time.Time{})
	if initial.Resource != "ahp-session:/catalog-session" || initial.Title != "New Session" {
		t.Fatalf("unexpected persisted catalog item: %+v", initial)
	}
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	controlPlane.CloseAHP()
	stale := waitForCatalogState(t, testServer.URL, false, true, time.Time{})
	reconnected := waitForCatalogState(t, testServer.URL, true, false, stale.ObservedAt)
	if !reconnected.ObservedAt.After(stale.ObservedAt) {
		t.Fatalf("reconnect did not relist sessions: before=%s after=%s",
			stale.ObservedAt,
			reconnected.ObservedAt,
		)
	}
}

type catalogTestItem struct {
	Resource        string    `json:"resource"`
	Title           string    `json:"title"`
	ObservedAt      time.Time `json:"observedAt"`
	AgentHostOnline bool      `json:"agentHostOnline"`
	Stale           bool      `json:"stale"`
}

func waitForCatalogState(
	t *testing.T,
	serverURL string,
	online bool,
	stale bool,
	observedAfter time.Time,
) catalogTestItem {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		response, err := http.Get(serverURL + "/api/v1/sessions")
		if err == nil {
			var page struct {
				Items []catalogTestItem `json:"items"`
			}
			decodeErr := json.NewDecoder(response.Body).Decode(&page)
			_ = response.Body.Close()
			if decodeErr == nil && len(page.Items) == 1 {
				item := page.Items[0]
				if item.AgentHostOnline == online && item.Stale == stale &&
					(observedAfter.IsZero() || item.ObservedAt.After(observedAfter)) {
					return item
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("catalog did not reach online=%t stale=%t", online, stale)
	return catalogTestItem{}
}

func TestAgentHostReconnectsAfterControlPlaneRestartWithSessionsIntact(t *testing.T) {
	identity, err := agentidentity.New(strings.Repeat("r", 32))
	if err != nil {
		t.Fatal(err)
	}
	registrationCredential, err := identity.IssueRegistration("workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	credentialPath := filepath.Join(t.TempDir(), "registration.token")
	if err := os.WriteFile(credentialPath, []byte(registrationCredential+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	firstControlPlane := httptransport.NewWithAgentIdentity(nil, nil, nil, identity)
	first := httptest.NewServer(firstControlPlane.Handler())
	defer first.Close()
	proxy := newMutableAHPProxy(t, first.URL)
	defer proxy.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = agenthost.RunWithRuntime(ctx, agenthost.Config{
			ServerURL:             proxy.URL(),
			WorkspaceID:           "workspace-1",
			WorkspaceDir:          t.TempDir(),
			RegistrationTokenFile: credentialPath,
		}, newFakeAgentRuntime())
	}()
	endpoint := "ws" + strings.TrimPrefix(proxy.URL(), "http")
	endpoint += "/api/v1/workspaces/workspace-1/ahp"
	client := dialAHPClient(t, endpoint)
	writeRPCRequest(t, client, 1, "initialize", map[string]any{
		"channel":          "ahp-root://",
		"clientId":         "restart-client",
		"protocolVersions": ahptypes.SupportedProtocolVersions(),
	})
	_ = readRPCFrame(t, client)
	writeRPCRequest(t, client, 2, "createSession", map[string]any{
		"channel": "ahp-session:/session-restart",
		"title":   "Kept by Agent Host",
	})
	_ = readRPCFrame(t, client)
	_ = readRPCFrame(t, client)
	_ = client.Close()
	assertCredentialUnchanged(t, credentialPath, registrationCredential)

	secondControlPlane := httptransport.NewWithAgentIdentity(nil, nil, nil, identity)
	second := httptest.NewServer(secondControlPlane.Handler())
	defer second.Close()
	proxy.SetBackend(second.URL)
	firstControlPlane.CloseAHP()
	first.Close()

	reattached := dialAHPClientWithDeadline(t, endpoint, 5*time.Second)
	defer reattached.Close()
	writeRPCRequest(t, reattached, 3, "initialize", map[string]any{
		"channel":          "ahp-root://",
		"clientId":         "restart-client",
		"protocolVersions": ahptypes.SupportedProtocolVersions(),
	})
	_ = readRPCFrame(t, reattached)
	writeRPCRequest(t, reattached, 4, "listSessions", map[string]any{
		"channel": "ahp-root://",
	})
	if frame := readRPCFrame(t, reattached); !strings.Contains(string(frame), "New Session") {
		t.Fatalf("session did not survive control-plane restart: %s", frame)
	}
	assertCredentialUnchanged(t, credentialPath, registrationCredential)
}

func assertCredentialUnchanged(t *testing.T, path string, expected string) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(contents)) != expected {
		t.Fatal("Agent Host registration credential changed during reconnect")
	}
}

type mutableAHPProxy struct {
	mu      sync.RWMutex
	backend *url.URL
	server  *httptest.Server
}

func newMutableAHPProxy(t *testing.T, backend string) *mutableAHPProxy {
	t.Helper()
	proxy := &mutableAHPProxy{}
	proxy.SetBackend(backend)
	proxy.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy.mu.RLock()
		target := *proxy.backend
		proxy.mu.RUnlock()
		reverse := httputil.NewSingleHostReverseProxy(&target)
		reverse.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "control plane is restarting", http.StatusServiceUnavailable)
		}
		reverse.ServeHTTP(w, r)
	}))
	return proxy
}

func (p *mutableAHPProxy) Close() { p.server.Close() }

func (p *mutableAHPProxy) SetBackend(rawURL string) {
	target, err := url.Parse(rawURL)
	if err != nil {
		panic(err)
	}
	p.mu.Lock()
	p.backend = target
	p.mu.Unlock()
}

func (p *mutableAHPProxy) URL() string { return p.server.URL }

type fakeAgentRuntime struct {
	mu       sync.Mutex
	sequence int
}

func newFakeAgentRuntime() *fakeAgentRuntime { return &fakeAgentRuntime{} }

func (r *fakeAgentRuntime) CreateSession(
	_ context.Context,
	options agentsdk.SessionOptions,
) (agentsdk.Session, error) {
	r.mu.Lock()
	r.sequence++
	identifier := r.sequence
	r.mu.Unlock()
	return &fakeAgentSession{id: identifier, options: options}, nil
}

func (r *fakeAgentRuntime) Close() error { return nil }

type fakeAgentSession struct {
	id      int
	options agentsdk.SessionOptions
}

func (s *fakeAgentSession) ID() string { return "fake-agent-session" }

func (s *fakeAgentSession) Prompt(
	ctx context.Context,
	prompt agentsdk.PromptRequest,
) error {
	if strings.Contains(prompt.Text, "fail") {
		return fmt.Errorf("fake Agent SDK failure")
	}
	s.options.OnEvent(agentsdk.Event{
		Type: "agent_message_chunk",
		Data: map[string]string{"text": "hello from Agent SDK"},
	})
	decision := s.options.OnPermission(ctx, agentsdk.PermissionRequest{
		Kind: "shell", Data: json.RawMessage(`{"command":"true"}`),
	})
	if decision == agentsdk.PermissionAllowOnce {
		s.options.OnEvent(agentsdk.Event{
			Type: "tool_call",
			Data: map[string]string{"toolCallId": "tool-1", "status": "completed"},
		})
	}
	return nil
}

func (s *fakeAgentSession) Cancel(context.Context) error { return nil }
func (s *fakeAgentSession) Close() error                 { return nil }

func toolConfirmationIDs(t *testing.T, payload []byte) (string, string) {
	t.Helper()
	var envelope struct {
		Params struct {
			Action struct {
				TurnID     string `json:"turnId"`
				ToolCallID string `json:"toolCallId"`
			} `json:"action"`
		} `json:"params"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Params.Action.TurnID, envelope.Params.Action.ToolCallID
}

func dialAHPClient(t *testing.T, endpoint string) *websocket.Conn {
	return dialAHPClientWithDeadline(t, endpoint, 2*time.Second)
}

func dialAHPClientWithDeadline(
	t *testing.T,
	endpoint string,
	timeout time.Duration,
) *websocket.Conn {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		connection, response, err := websocket.DefaultDialer.Dial(endpoint, nil)
		if err == nil {
			return connection
		}
		if response != nil && response.StatusCode != 503 {
			t.Fatalf("connect AHP client: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Agent Host did not register before deadline")
	return nil
}

func writeRPCRequest(
	t *testing.T,
	connection *websocket.Conn,
	id int,
	method string,
	params map[string]any,
) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	})
	if err != nil {
		t.Fatalf("encode RPC request: %v", err)
	}
	if err := connection.WriteMessage(websocket.TextMessage, payload); err != nil {
		t.Fatalf("write RPC request: %v", err)
	}
}

func readRPCFrame(t *testing.T, connection *websocket.Conn) []byte {
	t.Helper()
	connection.SetReadDeadline(time.Now().Add(time.Second))
	_, payload, err := connection.ReadMessage()
	if err != nil {
		t.Fatalf("read RPC frame: %v", err)
	}
	return payload
}

func assertRPCFrameResult(t *testing.T, payload []byte) {
	t.Helper()
	if !strings.Contains(string(payload), `"result"`) {
		t.Fatalf("expected JSON-RPC result, got %s", payload)
	}
}

func resultProtocolVersion(t *testing.T, payload []byte) string {
	t.Helper()
	var response struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatalf("decode initialize result: %v", err)
	}
	return response.Result.ProtocolVersion
}
