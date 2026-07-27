package llmproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

func TestOpenAIAdapterConvertsNeutralMultimodalToolAndReasoningRequest(t *testing.T) {
	parallelTools := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer openai-secret" {
			t.Fatal("OpenAI API key was not applied by the provider adapter")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["model"] != "gpt-upstream" {
			t.Fatalf("upstream model = %#v", payload["model"])
		}
		encoded, _ := json.Marshal(payload)
		for _, expected := range []string{
			`"input_image"`, `"tools"`, `"reasoning"`, `"json_schema"`,
			`"parallel_tool_calls":true`,
		} {
			if !strings.Contains(string(encoded), expected) {
				t.Fatalf("converted request is missing %s: %s", expected, encoded)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
          "id":"resp-openai","status":"completed",
          "output":[
            {"type":"reasoning","summary":[{"type":"summary_text","text":"checked"}]},
            {"type":"message","content":[{"type":"output_text","text":"answer"}]},
            {"type":"function_call","call_id":"call-1","name":"lookup","arguments":"{\"q\":1}"}
          ],
          "usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15,
            "input_tokens_details":{"cached_tokens":2},
            "output_tokens_details":{"reasoning_tokens":3}}
        }`))
	}))
	defer upstream.Close()

	generation, err := NewClient(nil).Generate(
		context.Background(),
		testSelection(domainllm.ProviderOpenAI, upstream.URL, "gpt-upstream"),
		"openai-secret",
		domainllm.GenerateRequest{
			Messages: []domainllm.Message{{
				Role: "user",
				Content: []domainllm.ContentPart{
					{Type: "text", Text: "inspect"},
					{Type: "image", Source: &domainllm.ContentSource{
						URL: "https://example.invalid/image.png", Detail: "high",
					}},
				},
			}},
			Tools: []domainllm.Tool{{
				Name: "lookup", InputSchema: json.RawMessage(`{"type":"object"}`),
			}},
			Reasoning: &domainllm.Reasoning{
				Effort: "high", Summary: "auto",
			},
			ParallelTools: &parallelTools,
			ResponseFormat: &domainllm.ResponseFormat{
				Type: "json_schema", Name: "answer",
				Schema: json.RawMessage(`{"type":"object"}`), Strict: true,
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	response := completedResponse(t, generation)
	if response.ID != "resp-openai" || len(response.Output) != 3 {
		t.Fatalf("unexpected neutral response: %#v", response)
	}
	if response.Usage.ReasoningTokens != 3 || response.Usage.CachedInputTokens != 2 {
		t.Fatalf("usage was not normalized: %#v", response.Usage)
	}
}

func TestEveryProviderConvertsNativeStreamToNeutralEvents(t *testing.T) {
	tests := []struct {
		name     string
		kind     domainllm.ProviderKind
		path     string
		stream   string
		wantType []string
	}{
		{
			name: "openai", kind: domainllm.ProviderOpenAI, path: "/v1/responses",
			stream: sse(
				`{"type":"response.created","response":{"id":"resp-1"}}`,
				`{"type":"response.reasoning_summary_text.delta","response_id":"resp-1","delta":"why"}`,
				`{"type":"response.output_text.delta","response_id":"resp-1","delta":"hello"}`,
				`{"type":"response.output_item.added","response_id":"resp-1",`+
					`"output_index":1,"item":{"type":"function_call",`+
					`"call_id":"call-1","name":"lookup"}}`,
				`{"type":"response.function_call_arguments.delta",`+
					`"response_id":"resp-1","output_index":1,"delta":"{\"q\":1}"}`,
				`{"type":"response.completed","response":{"id":"resp-1","status":"completed",`+
					`"output":[{"type":"message","content":[{"type":"output_text",`+
					`"text":"hello"}]},{"type":"function_call","call_id":"call-1",`+
					`"name":"lookup","arguments":"{\"q\":1}"}],`+
					`"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
			),
			wantType: []string{
				"response.created", "output.reasoning.delta",
				"output.text.delta", "output.added",
				"output.tool_call.arguments.delta", "response.completed",
			},
		},
		{
			name: "anthropic", kind: domainllm.ProviderAnthropic, path: "/v1/messages",
			stream: sse(
				`{"type":"message_start","message":{"id":"msg-1",`+
					`"usage":{"input_tokens":2}}}`,
				`{"type":"content_block_start","index":0,`+
					`"content_block":{"type":"thinking","thinking":"","signature":""}}`,
				`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"why"}}`,
				`{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
				`{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"hello"}}`,
				`{"type":"content_block_start","index":2,"content_block":`+
					`{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}`,
				`{"type":"content_block_delta","index":2,"delta":`+
					`{"type":"input_json_delta","partial_json":"{\"q\":1}"}}`,
				`{"type":"message_delta","delta":{"stop_reason":"tool_use"},`+
					`"usage":{"output_tokens":3}}`,
				`{"type":"message_stop"}`,
			),
			wantType: []string{
				"response.created", "output.added", "output.reasoning.delta",
				"output.added", "output.text.delta", "output.added",
				"output.tool_call.arguments.delta", "response.completed",
			},
		},
		{
			name: "deepseek", kind: domainllm.ProviderDeepSeek, path: "/v1/chat/completions",
			stream: sse(
				`{"id":"chat-1","choices":[{"delta":{"reasoning_content":"why"},"finish_reason":null}]}`,
				`{"id":"chat-1","choices":[{"delta":{"content":"hello"},`+
					`"finish_reason":null}]}`,
				`{"id":"chat-1","choices":[{"delta":{"tool_calls":[{"index":0,`+
					`"id":"call-1","function":{"name":"lookup",`+
					`"arguments":"{\"q\":1}"}}]},"finish_reason":"tool_calls"}]}`,
				`{"id":"chat-1","choices":[],"usage":{"prompt_tokens":2,`+
					`"completion_tokens":3,"total_tokens":5}}`,
				`[DONE]`,
			),
			wantType: []string{
				"response.created", "output.reasoning.delta",
				"output.text.delta", "output.added",
				"output.tool_call.arguments.delta", "response.completed",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != test.path {
						t.Fatalf("path = %q, want %q", r.URL.Path, test.path)
					}
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte(test.stream))
				},
			))
			defer upstream.Close()
			generation, err := NewClient(nil).Generate(
				context.Background(),
				testSelection(test.kind, upstream.URL, "upstream-model"),
				"secret",
				domainllm.GenerateRequest{
					Messages: []domainllm.Message{{
						Role:    "user",
						Content: []domainllm.ContentPart{{Type: "text", Text: "hi"}},
					}},
					Reasoning: &domainllm.Reasoning{Effort: "high", Summary: "summarized"},
					Stream:    true,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			var got []string
			gotTool := false
			for event := range generation.Events {
				if event.Error != nil {
					t.Fatalf("stream error: %#v", event.Error)
				}
				got = append(got, event.Type)
				if event.Response != nil {
					for _, part := range event.Response.Output {
						gotTool = gotTool || part.Type == "tool_call"
					}
				}
			}
			if fmt.Sprint(got) != fmt.Sprint(test.wantType) {
				t.Fatalf("events = %v, want %v", got, test.wantType)
			}
			if !gotTool {
				t.Fatal("completed neutral response did not contain the streamed tool call")
			}
		})
	}
}

func testSelection(
	kind domainllm.ProviderKind,
	apiBase string,
	upstreamModel string,
) domainllm.Selection {
	return domainllm.Selection{
		Provider: domainllm.Provider{Kind: kind, APIBase: apiBase},
		Model:    domainllm.Model{Name: "workspace-model", UpstreamModel: upstreamModel},
	}
}

func completedResponse(
	t *testing.T,
	generation domainllm.Generation,
) domainllm.GenerateResponse {
	t.Helper()
	for event := range generation.Events {
		if event.Error != nil {
			t.Fatalf("generation error: %#v", event.Error)
		}
		if event.Response != nil {
			return *event.Response
		}
	}
	t.Fatal("generation ended without a completed response")
	return domainllm.GenerateResponse{}
}

func sse(payloads ...string) string {
	var result strings.Builder
	for _, payload := range payloads {
		result.WriteString("data: ")
		result.WriteString(payload)
		result.WriteString("\n\n")
	}
	return result.String()
}
