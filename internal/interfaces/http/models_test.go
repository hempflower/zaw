package httptransport

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zaw-dev/zaw/internal/infra/agentidentity"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestServerModelAPIKeepsKeySecretAndStreamsNeutralEvents(t *testing.T) {
	upstreamRequests := make(chan map[string]any, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer deepseek-secret" {
			t.Error("Server did not resolve the upstream key from Secret Store")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		upstreamRequests <- payload
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(
			"data: {\"id\":\"chat-1\",\"choices\":[{\"delta\":" +
				"{\"reasoning_content\":\"why\"},\"finish_reason\":null}]}\n\n" +
				"data: {\"id\":\"chat-1\",\"choices\":[{\"delta\":" +
				"{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}\n\n" +
				"data: [DONE]\n\n",
		))
	}))
	defer upstream.Close()

	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrate(database); err != nil {
		t.Fatal(err)
	}
	secrets := &memorySecretStore{values: map[string]map[string]string{}}
	identity, err := agentidentity.New(strings.Repeat("m", 32))
	if err != nil {
		t.Fatal(err)
	}
	server := NewWithAgentIdentity(database, nil, secrets, identity)
	if err := server.Bootstrap(context.Background()); err != nil {
		t.Fatal(err)
	}

	providerResponse := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/model-providers",
		map[string]any{
			"name": "User DeepSeek", "kind": "deepseek",
			"apiBase": upstream.URL, "apiKey": "deepseek-secret",
		},
	)
	if providerResponse.Code != http.StatusCreated {
		t.Fatalf("create provider: %d %s", providerResponse.Code, providerResponse.Body.String())
	}
	if strings.Contains(providerResponse.Body.String(), "deepseek-secret") {
		t.Fatal("provider API returned the upstream API key")
	}
	var provider modelProviderView
	if err := json.Unmarshal(providerResponse.Body.Bytes(), &provider); err != nil {
		t.Fatal(err)
	}
	if secrets.values["zaw/model-providers/"+provider.ID]["apiKey"] != "deepseek-secret" {
		t.Fatal("provider API key was not stored in Secret Store")
	}

	modelResponse := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/models",
		map[string]any{
			"providerId": provider.ID, "name": "zaw-default",
			"upstreamModel": "deepseek-v4-pro", "isDefault": true,
			"capabilities": map[string]any{
				"textInput": true, "reasoning": true, "tools": true,
				"structuredOutput": true, "streaming": true,
				"reasoningEfforts": []string{"high", "max"},
			},
		},
	)
	if modelResponse.Code != http.StatusCreated {
		t.Fatalf("create model: %d %s", modelResponse.Code, modelResponse.Body.String())
	}
	var model modelView
	if err := json.Unmarshal(modelResponse.Body.Bytes(), &model); err != nil {
		t.Fatal(err)
	}
	workspace := storage.Workspace{
		ID: "workspace-model-test", OrganizationID: devOrganizationID,
		Name: "model-test", OwnerID: devUserID, TemplateID: "template-test",
		SourceSnapshot:  datatypes.JSON([]byte(`{}`)),
		ParameterValues: datatypes.JSON([]byte(`{}`)),
		DesiredState:    "running", ObservedState: "running", ModelID: model.ID,
	}
	if err := database.Create(&workspace).Error; err != nil {
		t.Fatal(err)
	}
	token, err := identity.IssueRegistration(workspace.ID)
	if err != nil {
		t.Fatal(err)
	}

	modelProfile := authorizedRequest(
		t,
		server.Handler(),
		http.MethodGet,
		"/api/v1/agent-hosts/"+workspace.ID+"/model",
		token,
		nil,
	)
	if modelProfile.Code != http.StatusOK ||
		!strings.Contains(modelProfile.Body.String(), `"model":"zaw-default"`) {
		t.Fatalf("model profile: %d %s", modelProfile.Code, modelProfile.Body.String())
	}

	stream := authorizedRequest(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/llm/generate",
		token,
		map[string]any{
			"messages": []map[string]any{{
				"role":    "user",
				"content": []map[string]string{{"type": "text", "text": "question"}},
			}},
			"reasoning": map[string]string{"effort": "high"},
			"stream":    true,
		},
	)
	if stream.Code != http.StatusOK {
		t.Fatalf("stream model: %d %s", stream.Code, stream.Body.String())
	}
	for _, eventType := range []string{
		"response.created", "output.reasoning.delta",
		"output.text.delta", "response.completed",
	} {
		if !strings.Contains(stream.Body.String(), "event: "+eventType) {
			t.Fatalf("neutral stream is missing %s: %s", eventType, stream.Body.String())
		}
	}
	upstreamPayload := <-upstreamRequests
	if upstreamPayload["model"] != "deepseek-v4-pro" {
		t.Fatalf("Server did not select the configured upstream model: %#v", upstreamPayload)
	}
	if upstreamPayload["stream"] != true {
		t.Fatal("Server did not preserve neutral streaming semantics")
	}

	compatibilityStream := authorizedRequest(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/llm/openai/v1/responses",
		token,
		map[string]any{
			"model": "zaw-default", "input": "question", "stream": true,
			"reasoning": map[string]string{"effort": "high", "summary": "auto"},
		},
	)
	compatibilityBody := compatibilityStream.Body.String()
	if compatibilityStream.Code != http.StatusOK ||
		!strings.Contains(compatibilityBody, `"type":"response.output_item.added"`) ||
		!strings.Contains(compatibilityBody, `"type":"response.content_part.added"`) ||
		!strings.Contains(compatibilityBody, `"type":"response.output_text.delta"`) {
		t.Fatalf(
			"Copilot Responses adapter: %d %s",
			compatibilityStream.Code,
			compatibilityStream.Body.String(),
		)
	}
	<-upstreamRequests
	unsupportedEffort := authorizedRequest(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/llm/generate",
		token,
		map[string]any{
			"messages": []map[string]any{{
				"role":    "user",
				"content": []map[string]string{{"type": "text", "text": "question"}},
			}},
			"reasoning": map[string]string{"effort": "low"},
			"stream":    true,
		},
	)
	if unsupportedEffort.Code != http.StatusBadRequest ||
		!strings.Contains(unsupportedEffort.Body.String(), "reasoning effort") {
		t.Fatalf(
			"unsupported reasoning effort: %d %s",
			unsupportedEffort.Code,
			unsupportedEffort.Body.String(),
		)
	}
	unsupportedImage := authorizedRequest(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/llm/generate",
		token,
		map[string]any{
			"messages": []map[string]any{{
				"role": "user",
				"content": []map[string]any{{
					"type":   "image",
					"source": map[string]string{"url": "https://example.invalid/image.png"},
				}},
			}},
		},
	)
	if unsupportedImage.Code != http.StatusBadRequest ||
		!strings.Contains(unsupportedImage.Body.String(), "image input") {
		t.Fatalf(
			"unsupported image input: %d %s",
			unsupportedImage.Code,
			unsupportedImage.Body.String(),
		)
	}

	unauthorized := request(
		t,
		server.Handler(),
		http.MethodPost,
		"/api/v1/llm/generate",
		map[string]any{"messages": []any{}},
	)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized model request status = %d", unauthorized.Code)
	}
}

func authorizedRequest(
	t *testing.T,
	handler http.Handler,
	method string,
	path string,
	token string,
	body any,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	return response
}
