// Package llmproxy converts Zaw's neutral model protocol to provider APIs.
package llmproxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

type Client struct {
	httpClient *http.Client
}

func NewClient(httpClient *http.Client) domainllm.Upstream {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{httpClient: httpClient}
}

func (c *Client) Generate(
	ctx context.Context,
	selection domainllm.Selection,
	apiKey string,
	request domainllm.GenerateRequest,
) (domainllm.Generation, error) {
	switch selection.Provider.Kind {
	case domainllm.ProviderOpenAI:
		return c.generateOpenAI(ctx, selection, apiKey, request)
	case domainllm.ProviderAnthropic:
		return c.generateAnthropic(ctx, selection, apiKey, request)
	case domainllm.ProviderDeepSeek:
		return c.generateDeepSeek(ctx, selection, apiKey, request)
	default:
		return domainllm.Generation{}, fmt.Errorf("unsupported provider kind")
	}
}

func (c *Client) startRequest(
	ctx context.Context,
	method string,
	endpoint string,
	headers map[string]string,
	payload any,
	consume func(*http.Response, chan<- domainllm.Event),
) (domainllm.Generation, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return domainllm.Generation{}, fmt.Errorf("encode provider request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		method,
		endpoint,
		bytes.NewReader(encoded),
	)
	if err != nil {
		return domainllm.Generation{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		httpRequest.Header.Set(name, value)
	}
	events := make(chan domainllm.Event, 64)
	go func() {
		defer close(events)
		response, requestErr := c.httpClient.Do(httpRequest)
		if requestErr != nil {
			sendError(events, "provider_unavailable", requestErr.Error(), true)
			return
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
			sendError(
				events,
				"provider_http_error",
				providerHTTPError(response.StatusCode, body),
				response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500,
			)
			return
		}
		consume(response, events)
	}()
	return domainllm.Generation{Events: events}, nil
}

func providerHTTPError(status int, body []byte) string {
	message := ""
	var payload struct {
		Message string `json:"message"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &payload) == nil {
		message = strings.TrimSpace(payload.Error.Message)
		if message == "" {
			message = strings.TrimSpace(payload.Message)
		}
	}
	if message == "" {
		message = strings.TrimSpace(string(body))
	}
	if len(message) > 500 {
		message = message[:500]
	}
	if message == "" {
		return fmt.Sprintf("model provider returned HTTP %d", status)
	}
	return fmt.Sprintf("model provider returned HTTP %d: %s", status, message)
}

func sendError(
	events chan<- domainllm.Event,
	code string,
	message string,
	retryable bool,
) {
	events <- domainllm.Event{
		Type: "error",
		Error: &domainllm.GenerationError{
			Code: code, Message: message, Retryable: retryable,
		},
	}
}

func providerEndpoint(apiBase string, resource string) string {
	base := strings.TrimRight(apiBase, "/")
	if strings.HasSuffix(base, "/v1") {
		return base + "/" + resource
	}
	return base + "/v1/" + resource
}

func scanSSE(body io.Reader, consume func(string, []byte) bool) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	eventName := ""
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data := []byte(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			if !consume(eventName, data) {
				return nil
			}
			eventName = ""
		}
	}
	return scanner.Err()
}

func rawJSON(value any) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}

func finishReason(reason string) string {
	switch reason {
	case "tool_use", "tool_calls":
		return "tool_calls"
	case "max_tokens", "length", "incomplete":
		return "max_output_tokens"
	case "content_filter", "refusal":
		return "content_filter"
	case "insufficient_system_resource":
		return "provider_error"
	default:
		return "stop"
	}
}

func stringValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

func intValue(values map[string]any, key string) int {
	switch value := values[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case json.Number:
		result, _ := value.Int64()
		return int(result)
	default:
		return 0
	}
}

func textContent(parts []domainllm.ContentPart) string {
	var result strings.Builder
	for _, part := range parts {
		if part.Type == "text" {
			result.WriteString(part.Text)
		}
	}
	return result.String()
}

func dataURL(source domainllm.ContentSource) string {
	return "data:" + source.MediaType + ";base64," + source.Data
}

func mediaSubtype(mediaType string) string {
	_, subtype, found := strings.Cut(mediaType, "/")
	if found {
		return subtype
	}
	return mediaType
}

// Some compatible APIs initialize tool input with `{}` and then stream the
// actual JSON. Keep that empty object as a replaceable placeholder.
func appendToolArguments(call *domainllm.ToolCall, delta string) string {
	current := strings.TrimSpace(string(call.Arguments))
	if current == "{}" {
		if strings.TrimSpace(delta) == "{}" {
			return ""
		}
		call.Arguments = append(call.Arguments[:0], delta...)
		return delta
	}
	call.Arguments = append(call.Arguments, delta...)
	if current == "" && strings.TrimSpace(delta) == "{}" {
		return ""
	}
	return delta
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
