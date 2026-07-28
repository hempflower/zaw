package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
	copilotagent "github.com/zaw-dev/zaw/internal/agenthost/copilot"
	"github.com/zaw-dev/zaw/internal/infra/agentidentity"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCopilotSDKStreamsThroughServerModelGateway(t *testing.T) {
	cliPath := os.Getenv("ZAW_COPILOT_CLI_INTEGRATION")
	if cliPath == "" {
		t.Skip("set ZAW_COPILOT_CLI_INTEGRATION to the Copilot CLI path")
	}
	upstreamRequests := make(chan map[string]any, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer upstream-secret" {
			t.Errorf("upstream authorization = %q", r.Header.Get("Authorization"))
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		upstreamRequests <- request
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(copilotUpstreamStream()))
	}))
	defer upstream.Close()

	database, err := gorm.Open(
		sqlite.Open(t.TempDir()+"/copilot-integration.db"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	secrets := &memorySecretStore{values: map[string]map[string]string{}}
	identity, err := agentidentity.New(strings.Repeat("c", 32))
	if err != nil {
		t.Fatal(err)
	}
	server := NewWithAgentIdentity(database, nil, secrets, identity)
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatal(err)
	}
	provider := createCopilotTestProvider(t, server, upstream.URL)
	model := createCopilotTestModel(t, server, provider.ID)
	workspaceID := "workspace-copilot-sdk-test"
	createCopilotTestWorkspace(t, database, workspaceID, model.ID)
	token, err := identity.IssueRegistration(workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	controlPlane := httptest.NewServer(server.Handler())
	defer controlPlane.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	runtime, err := copilotagent.New(ctx, copilotagent.Config{
		CLIPath: cliPath, WorkingDirectory: t.TempDir(), Model: model.Name,
		LLMBaseURL: controlPlane.URL + "/api/v1/llm/openai",
		LLMToken:   token, Reasoning: true, ReasoningEfforts: []string{"high"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	events := make(chan agentsdk.Event, 64)
	session, err := runtime.CreateSession(ctx, agentsdk.SessionOptions{
		ID: "copilot-sdk-session", WorkingDirectory: t.TempDir(),
		OnEvent: func(event agentsdk.Event) { events <- event },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if err := session.Prompt(ctx, agentsdk.PromptRequest{
		Text: "Reply with the test response.",
	}); err != nil {
		t.Fatal(err)
	}
	waitForCopilotStream(t, ctx, events)
	request := <-upstreamRequests
	if request["model"] != "upstream-test-model" || request["stream"] != true {
		t.Fatalf("normalized upstream request = %#v", request)
	}
	if request["parallel_tool_calls"] != true {
		t.Fatalf("parallel tool control was not explicitly mapped: %#v", request)
	}
	for _, removed := range []string{"include", "store", "prompt_cache_key"} {
		if _, exists := request[removed]; exists {
			t.Fatalf("compatibility-only field %q reached upstream: %#v", removed, request)
		}
	}
}

func createCopilotTestProvider(
	t *testing.T,
	server *Server,
	upstreamURL string,
) modelProviderView {
	t.Helper()
	response := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/model-providers",
		map[string]any{
			"id":   "copilot-integration",
			"name": "Copilot Integration", "kind": "openai",
			"apiBase": upstreamURL, "apiKey": "upstream-secret",
		},
	)
	if response.Code != http.StatusCreated {
		t.Fatalf("create provider: %d %s", response.Code, response.Body.String())
	}
	var provider modelProviderView
	if err := json.Unmarshal(response.Body.Bytes(), &provider); err != nil {
		t.Fatal(err)
	}
	return provider
}

func createCopilotTestModel(t *testing.T, server *Server, providerID string) modelView {
	t.Helper()
	response := request(t, server.Handler(), http.MethodPost, "/api/v1/models", map[string]any{
		"providerId": providerID, "name": "copilot-test-model",
		"upstreamModel": "upstream-test-model", "isDefault": true,
		"capabilities": map[string]any{
			"textInput": true, "contextWindow": 128000,
			"reasoning": true, "tools": true,
			"structuredOutput": true, "streaming": true,
			"reasoningEfforts": []string{"high"},
		},
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create model: %d %s", response.Code, response.Body.String())
	}
	var model modelView
	if err := json.Unmarshal(response.Body.Bytes(), &model); err != nil {
		t.Fatal(err)
	}
	return model
}

func createCopilotTestWorkspace(
	t *testing.T,
	database *gorm.DB,
	workspaceID string,
	modelID string,
) {
	t.Helper()
	workspace := storage.Workspace{
		ID: workspaceID, OrganizationID: devOrganizationID,
		Name: "copilot-sdk-test", OwnerID: devUserID, TemplateID: "template-test",
		SourceSnapshot:  datatypes.JSON([]byte(`{}`)),
		ParameterValues: datatypes.JSON([]byte(`{}`)),
		DesiredState:    "running", ObservedState: "running", ModelID: modelID,
	}
	if err := database.Create(&workspace).Error; err != nil {
		t.Fatal(err)
	}
}

func waitForCopilotStream(
	t *testing.T,
	ctx context.Context,
	events <-chan agentsdk.Event,
) {
	t.Helper()
	streamed := false
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("waiting for Copilot stream: %v", ctx.Err())
		case event := <-events:
			switch event.Type {
			case "assistant.message_delta":
				streamed = true
			case "session.error":
				t.Fatalf("Copilot session error: %#v", event.Data)
			case "session.idle":
				if !streamed {
					t.Fatal("Copilot SDK did not publish a streaming assistant delta")
				}
				return
			}
		}
	}
}

func copilotUpstreamStream() string {
	completed := `{"id":"resp-copilot","status":"completed","model":"upstream-test-model",` +
		`"output":[{"id":"msg-0","type":"message","role":"assistant",` +
		`"status":"completed","content":[{"type":"output_text",` +
		`"text":"test response","annotations":[]}]}],` +
		`"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}`
	return responsesSSE(
		`{"type":"response.created","response":{"id":"resp-copilot"}}`,
		`{"type":"response.output_text.delta","response_id":"resp-copilot",`+
			`"output_index":0,"content_index":0,"delta":"test response"}`,
		`{"type":"response.completed","response":`+completed+`}`,
		`[DONE]`,
	)
}

func responsesSSE(payloads ...string) string {
	var result strings.Builder
	for _, payload := range payloads {
		result.WriteString("data: ")
		result.WriteString(payload)
		result.WriteString("\n\n")
	}
	return result.String()
}
