package agenthost

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

func TestHostCreatesSessionWithoutPersistentStorage(t *testing.T) {
	host := NewWithAgent(&testAgentRuntime{}, "")
	response, notification := host.handle([]byte(`{
      "jsonrpc":"2.0",
      "id":1,
      "method":"createSession",
      "params":{"channel":"ahp-session:/session-1","title":"First"}
    }`))
	if len(notification) == 0 {
		t.Fatal("expected root/sessionAdded notification")
	}
	assertRPCResult(t, response)

	listResponse, _ := host.handle([]byte(`{
      "jsonrpc":"2.0",
      "id":2,
      "method":"listSessions",
      "params":{"channel":"ahp-root://"}
    }`))
	var envelope struct {
		Result struct {
			Items []ahptypes.SessionSummary `json:"items"`
		} `json:"result"`
	}
	if err := json.Unmarshal(listResponse, &envelope); err != nil {
		t.Fatalf("decode session list: %v", err)
	}
	if len(envelope.Result.Items) != 1 {
		t.Fatalf("expected one in-memory session, got %d", len(envelope.Result.Items))
	}
}

type testAgentRuntime struct{}

func (r *testAgentRuntime) CreateSession(
	_ context.Context,
	options agentsdk.SessionOptions,
) (agentsdk.Session, error) {
	return &testAgentSession{id: options.ID}, nil
}

func (r *testAgentRuntime) Close() error { return nil }

type testAgentSession struct{ id string }

func (s *testAgentSession) ID() string { return s.id }
func (s *testAgentSession) Prompt(context.Context, agentsdk.PromptRequest) error {
	return nil
}
func (s *testAgentSession) Cancel(context.Context) error { return nil }
func (s *testAgentSession) Close() error                 { return nil }

func TestResourceCommandsStayWithinWorkspace(t *testing.T) {
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "README.md"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("write workspace file: %v", err)
	}
	if err := os.Mkdir(filepath.Join(workspace, "src"), 0o700); err != nil {
		t.Fatalf("make workspace directory: %v", err)
	}
	host := New()
	host.workDir = workspace
	list, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":1,"method":"resourceList",
		"params":{"channel":"ahp-root://","uri":"file://` + workspace + `"}
	}`))
	if !strings.Contains(string(list), "README.md") || !strings.Contains(string(list), "src") {
		t.Fatalf("unexpected resource list: %s", list)
	}
	read, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":2,"method":"resourceRead",
		"params":{"channel":"ahp-root://","uri":"file://` + workspace + `/README.md"}
	}`))
	if !strings.Contains(string(read), "hello") {
		t.Fatalf("unexpected resource read: %s", read)
	}
	escape, _ := host.handle([]byte(`{
		"jsonrpc":"2.0","id":3,"method":"resourceRead",
		"params":{"channel":"ahp-root://","uri":"file:///etc/passwd"}
	}`))
	if !strings.Contains(string(escape), `"error"`) {
		t.Fatalf("workspace escape was allowed: %s", escape)
	}
}

func TestTerminalForwardsPTYOutputThroughAHPAction(t *testing.T) {
	host := New()
	initialized, _ := host.handle([]byte(`{
		"jsonrpc":"2.0",
		"id":99,
		"method":"initialize",
		"params":{
			"channel":"ahp-root://",
			"clientId":"test",
			"protocolVersions":["0.6.0"]
		}
	}`))
	assertRPCResult(t, initialized)
	actions := make(chan []byte, 16)
	host.setEmitter(func(payload []byte) { actions <- payload })
	response, _ := host.handle([]byte(`{
		"jsonrpc":"2.0",
		"id":1,
		"method":"createTerminal",
		"params":{
			"channel":"ahp-terminal:/test-terminal",
			"claim":{"kind":"client","clientId":"test"}
		}
	}`))
	if !strings.Contains(string(response), `"result"`) {
		t.Fatalf("create terminal failed: %s", response)
	}
	var created struct {
		Result ahptypes.SubscribeResult `json:"result"`
	}
	if err := json.Unmarshal(response, &created); err != nil ||
		created.Result.Snapshot == nil || created.Result.Snapshot.State.Terminal == nil {
		t.Fatalf("create terminal did not return a standard snapshot: %s", response)
	}
	subscribe, _ := host.handle([]byte(`{
		"jsonrpc":"2.0",
		"id":3,
		"method":"subscribe",
		"params":{"channel":"ahp-terminal:/test-terminal"}
	}`))
	assertRPCResult(t, subscribe)
	defer host.handle([]byte(`{
		"jsonrpc":"2.0",
		"id":2,
		"method":"disposeTerminal",
		"params":{"channel":"ahp-terminal:/test-terminal"}
	}`))
	host.handle([]byte(`{
		"jsonrpc":"2.0",
		"method":"dispatchAction",
		"params":{
			"channel":"ahp-terminal:/test-terminal",
			"clientSeq":1,
			"action":{
				"type":"terminal/claimed",
				"claim":{"kind":"client","clientId":"test"}
			}
		}
	}`))
	host.mu.Lock()
	claim := host.terminals["ahp-terminal:/test-terminal"].state.Claim
	host.mu.Unlock()
	clientClaim, ok := claim.Value.(*ahptypes.TerminalClientClaim)
	if !ok || clientClaim.ClientId != "test" {
		t.Fatalf("terminal was not re-claimed by the connected client: %+v", claim)
	}

	host.handle([]byte(`{
		"jsonrpc":"2.0",
		"method":"dispatchAction",
		"params":{
			"channel":"ahp-terminal:/test-terminal",
			"action":{"type":"terminal/input","data":"printf 'zaw-terminal-test\\n'\\n"}
		}
	}`))
	deadline := time.After(2 * time.Second)
	var output strings.Builder
	for {
		select {
		case payload := <-actions:
			var notification ahptypes.JsonRpcNotification
			var typedEnvelope ahptypes.ActionEnvelope
			if json.Unmarshal(payload, &notification) == nil {
				_ = json.Unmarshal(notification.Params, &typedEnvelope)
			}
			var envelope struct {
				Params struct {
					Action struct {
						Type string `json:"type"`
						Data string `json:"data"`
					} `json:"action"`
				} `json:"params"`
			}
			if json.Unmarshal(payload, &envelope) == nil &&
				envelope.Params.Action.Type == "terminal/data" {
				if _, ok := typedEnvelope.Action.Value.(*ahptypes.TerminalDataAction); !ok {
					t.Fatalf("terminal output was not a standard action: %s", payload)
				}
				output.WriteString(envelope.Params.Action.Data)
			}
			if strings.Contains(output.String(), "zaw-terminal-test") {
				return
			}
		case <-deadline:
			t.Fatalf("terminal output was not emitted: %q", output.String())
		}
	}
}

func TestHostNegotiatesVendoredAHPVersion(t *testing.T) {
	host := New()
	response, _ := host.handle([]byte(`{
      "jsonrpc":"2.0",
      "id":1,
      "method":"initialize",
      "params":{"channel":"ahp-root://","clientId":"host-test",
        "protocolVersions":["0.6.0"]}
    }`))
	var envelope struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response, &envelope); err != nil {
		t.Fatalf("decode initialize result: %v", err)
	}
	if envelope.Result.ProtocolVersion != ahptypes.ProtocolVersion {
		t.Fatalf(
			"expected protocol %q, got %q",
			ahptypes.ProtocolVersion,
			envelope.Result.ProtocolVersion,
		)
	}
}

func TestHostRejectsUnsupportedAHPVersionWithOfficialErrorCode(t *testing.T) {
	host := New()
	response, _ := host.handle([]byte(`{
      "jsonrpc":"2.0",
      "id":7,
      "method":"initialize",
      "params":{"channel":"ahp-root://","clientId":"unsupported-test",
        "protocolVersions":["9.9.9"]}
    }`))
	var envelope ahptypes.JsonRpcErrorResponse
	if err := json.Unmarshal(response, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != ahptypes.ErrorCodeUnsupportedProtocolVersion {
		t.Fatalf(
			"error code = %d, want %d",
			envelope.Error.Code,
			ahptypes.ErrorCodeUnsupportedProtocolVersion,
		)
	}
}

func TestAgentHostTelemetryEndpoint(t *testing.T) {
	tests := []struct {
		serverURL string
		want      string
	}{
		{
			serverURL: "ws://control-plane.example/base",
			want: "http://control-plane.example/base/api/v1/agent-hosts/" +
				"workspace-1/telemetry",
		},
		{
			serverURL: "https://control-plane.example",
			want: "https://control-plane.example/api/v1/agent-hosts/" +
				"workspace-1/telemetry",
		},
	}
	for _, test := range tests {
		t.Run(test.serverURL, func(t *testing.T) {
			got, err := agentHostTelemetryEndpoint(test.serverURL, "workspace-1")
			if err != nil {
				t.Fatalf("build endpoint: %v", err)
			}
			if got != test.want {
				t.Fatalf("endpoint = %q, want %q", got, test.want)
			}
		})
	}
	if _, err := agentHostTelemetryEndpoint("ftp://control-plane.example", "workspace-1"); err == nil {
		t.Fatal("expected unsupported scheme error")
	}
}

func TestRegistrationCredentialRequiresProtectedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registration.token")
	config := Config{RegistrationTokenFile: path}
	if err := os.WriteFile(path, []byte("registration-token\n"), 0o600); err != nil {
		t.Fatalf("write credential: %v", err)
	}
	token, err := registrationToken(config)
	if err != nil {
		t.Fatalf("read credential: %v", err)
	}
	if token != "registration-token" {
		t.Fatalf("credential = %q", token)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat credential: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credential mode = %o, want 600", info.Mode().Perm())
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatalf("weaken credential mode: %v", err)
	}
	if _, err := registrationToken(config); err == nil {
		t.Fatal("Agent Host accepted a group/world-readable credential")
	}
}

func assertRPCResult(t *testing.T, payload []byte) {
	t.Helper()
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode RPC response: %v", err)
	}
	if len(envelope.Error) > 0 || len(envelope.Result) == 0 {
		t.Fatalf("expected RPC result, got %s", payload)
	}
}
