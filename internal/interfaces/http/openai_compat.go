package httptransport

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

const reasoningEnvelopePrefix = "zaw-reasoning-v1."

type reasoningEnvelope struct {
	Text      string `json:"text"`
	Signature string `json:"signature,omitempty"`
}

type openAIResponsesRequest struct {
	Model        string          `json:"model"`
	Instructions json.RawMessage `json:"instructions"`
	Input        json.RawMessage `json:"input"`
	Tools        []struct {
		Type        string          `json:"type"`
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Parameters  json.RawMessage `json:"parameters"`
		Strict      bool            `json:"strict"`
	} `json:"tools"`
	ToolChoice json.RawMessage `json:"tool_choice"`
	Reasoning  *struct {
		Effort  string `json:"effort"`
		Summary string `json:"summary"`
	} `json:"reasoning"`
	Text *struct {
		Format *struct {
			Type        string          `json:"type"`
			Name        string          `json:"name"`
			Description string          `json:"description"`
			Schema      json.RawMessage `json:"schema"`
			Strict      bool            `json:"strict"`
		} `json:"format"`
	} `json:"text"`
	MaxOutputTokens int      `json:"max_output_tokens"`
	Temperature     *float64 `json:"temperature"`
	TopP            *float64 `json:"top_p"`
	ParallelTools   *bool    `json:"parallel_tool_calls"`
	Stream          bool     `json:"stream"`
}

func (s *Server) openAIResponses(w http.ResponseWriter, r *http.Request) {
	credential, err := s.authenticateAgentHostRequest(r)
	if err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	var wireRequest openAIResponsesRequest
	if err := decodeOpenAIResponsesRequest(r, &wireRequest); err != nil {
		s.logger.Warn("decode Copilot Responses request", "error", err)
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	request, err := responsesRequestToNeutral(wireRequest)
	if err != nil {
		s.logger.Warn("convert Copilot Responses request", "error", err)
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	generation, err := s.models.Generate(
		r.Context(),
		devOrganizationID,
		credential.WorkspaceID,
		request,
	)
	if err != nil {
		s.logger.Warn("route Copilot Responses request", "error", err)
		handleModelError(w, err)
		return
	}
	writeOpenAIResponses(w, request, generation)
}

func decodeOpenAIResponsesRequest(
	r *http.Request,
	request *openAIResponsesRequest,
) error {
	var fields map[string]json.RawMessage
	if err := decodeLimit(r, &fields, 64<<20); err != nil {
		return err
	}
	for _, ignored := range []string{"include", "store", "prompt_cache_key"} {
		delete(fields, ignored)
	}
	payload, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, request)
}

func responsesRequestToNeutral(
	request openAIResponsesRequest,
) (domainllm.GenerateRequest, error) {
	result := domainllm.GenerateRequest{
		Model: request.Model, MaxOutputTokens: request.MaxOutputTokens,
		Temperature: request.Temperature, TopP: request.TopP, Stream: request.Stream,
		ParallelTools: request.ParallelTools,
	}
	if len(request.Instructions) != 0 && string(request.Instructions) != "null" {
		var instructions string
		if err := json.Unmarshal(request.Instructions, &instructions); err != nil {
			return result, fmt.Errorf("instructions must be text")
		}
		result.Messages = append(result.Messages, domainllm.Message{
			Role:    "developer",
			Content: []domainllm.ContentPart{{Type: "text", Text: instructions}},
		})
	}
	input, err := responsesInputToNeutral(request.Input)
	if err != nil {
		return result, err
	}
	result.Messages = append(result.Messages, input...)
	for _, tool := range request.Tools {
		if tool.Type != "function" {
			return result, fmt.Errorf("only function tools are supported")
		}
		result.Tools = append(result.Tools, domainllm.Tool{
			Name: tool.Name, Description: tool.Description,
			InputSchema: tool.Parameters, Strict: tool.Strict,
		})
	}
	result.ToolChoice = responsesToolChoice(request.ToolChoice)
	if request.Reasoning != nil {
		result.Reasoning = &domainllm.Reasoning{
			Effort: request.Reasoning.Effort, Summary: request.Reasoning.Summary,
		}
	}
	if request.Text != nil && request.Text.Format != nil {
		format := request.Text.Format
		result.ResponseFormat = &domainllm.ResponseFormat{
			Type: format.Type, Name: format.Name, Description: format.Description,
			Schema: format.Schema, Strict: format.Strict,
		}
	}
	return result, nil
}

func responsesInputToNeutral(input json.RawMessage) ([]domainllm.Message, error) {
	if len(input) == 0 || string(input) == "null" {
		return nil, fmt.Errorf("input is required")
	}
	var text string
	if json.Unmarshal(input, &text) == nil {
		return []domainllm.Message{{
			Role: "user", Content: []domainllm.ContentPart{{Type: "text", Text: text}},
		}}, nil
	}
	var items []map[string]any
	if err := json.Unmarshal(input, &items); err != nil {
		return nil, fmt.Errorf("input must be text or an item array")
	}
	messages := make([]domainllm.Message, 0, len(items))
	for _, item := range items {
		switch stringValue(item, "type") {
		case "message", "":
			message, err := responsesMessageToNeutral(item)
			if err != nil {
				return nil, err
			}
			messages = appendResponsesMessage(messages, message)
		case "function_call":
			arguments := json.RawMessage(stringValue(item, "arguments"))
			messages = appendResponsesMessage(messages, domainllm.Message{
				Role: "assistant",
				ToolCalls: []domainllm.ToolCall{{
					ID: stringValue(item, "call_id"), Name: stringValue(item, "name"),
					Arguments: arguments,
				}},
			})
		case "function_call_output":
			messages = append(messages, domainllm.Message{
				Role: "tool", ToolCallID: stringValue(item, "call_id"),
				Content: []domainllm.ContentPart{{
					Type: "text", Text: valueText(item["output"]),
				}},
			})
		case "reasoning":
			messages = appendResponsesMessage(messages, reasoningMessage(item))
		default:
			return nil, fmt.Errorf("unsupported Responses input item")
		}
	}
	return messages, nil
}

func appendResponsesMessage(
	messages []domainllm.Message,
	message domainllm.Message,
) []domainllm.Message {
	if message.Role != "assistant" || len(messages) == 0 ||
		messages[len(messages)-1].Role != "assistant" {
		return append(messages, message)
	}
	last := &messages[len(messages)-1]
	last.Content = append(last.Content, message.Content...)
	last.ToolCalls = append(last.ToolCalls, message.ToolCalls...)
	return messages
}

func responsesMessageToNeutral(item map[string]any) (domainllm.Message, error) {
	message := domainllm.Message{Role: stringValue(item, "role")}
	switch content := item["content"].(type) {
	case string:
		message.Content = []domainllm.ContentPart{{Type: "text", Text: content}}
	case []any:
		for _, rawPart := range content {
			part, _ := rawPart.(map[string]any)
			converted, err := responsesContentToNeutral(part)
			if err != nil {
				return message, err
			}
			message.Content = append(message.Content, converted)
		}
	default:
		return message, fmt.Errorf("message content must be text or content parts")
	}
	return message, nil
}

func responsesContentToNeutral(part map[string]any) (domainllm.ContentPart, error) {
	switch stringValue(part, "type") {
	case "input_text", "output_text":
		return domainllm.ContentPart{Type: "text", Text: stringValue(part, "text")}, nil
	case "input_image":
		source := sourceFromWireURL(stringValue(part, "image_url"))
		source.Detail = stringValue(part, "detail")
		return domainllm.ContentPart{
			Type: "image", Source: &source,
		}, nil
	case "input_file":
		source := sourceFromWireURL(stringValue(part, "file_data"))
		if source.Data == "" {
			source.URL = stringValue(part, "file_url")
		}
		source.FileName = stringValue(part, "filename")
		return domainllm.ContentPart{
			Type: "file", Source: &source,
		}, nil
	case "input_audio":
		audio, _ := part["input_audio"].(map[string]any)
		return domainllm.ContentPart{
			Type: "audio",
			Source: &domainllm.ContentSource{
				Data:      stringValue(audio, "data"),
				MediaType: "audio/" + stringValue(audio, "format"),
			},
		}, nil
	default:
		return domainllm.ContentPart{}, fmt.Errorf("unsupported Responses content part")
	}
}

func sourceFromWireURL(value string) domainllm.ContentSource {
	if !strings.HasPrefix(value, "data:") {
		return domainllm.ContentSource{URL: value}
	}
	header, data, found := strings.Cut(strings.TrimPrefix(value, "data:"), ",")
	if !found {
		return domainllm.ContentSource{URL: value}
	}
	mediaType := strings.TrimSuffix(header, ";base64")
	if _, err := base64.StdEncoding.DecodeString(data); err != nil {
		return domainllm.ContentSource{URL: value}
	}
	return domainllm.ContentSource{Data: data, MediaType: mediaType}
}

func reasoningMessage(item map[string]any) domainllm.Message {
	message := domainllm.Message{Role: "assistant"}
	if envelope, ok := decodeReasoningEnvelope(stringValue(item, "encrypted_content")); ok {
		message.Content = []domainllm.ContentPart{{
			Type: "reasoning", Text: envelope.Text, Signature: envelope.Signature,
			Metadata: rawJSON(item),
		}}
		return message
	}
	content, _ := item["content"].([]any)
	for _, rawPart := range content {
		part, _ := rawPart.(map[string]any)
		if stringValue(part, "type") == "reasoning_text" {
			message.Content = append(message.Content, domainllm.ContentPart{
				Type: "reasoning", Text: stringValue(part, "text"), Metadata: rawJSON(item),
			})
		}
	}
	if len(message.Content) != 0 {
		return message
	}
	summary, _ := item["summary"].([]any)
	for _, rawPart := range summary {
		part, _ := rawPart.(map[string]any)
		message.Content = append(message.Content, domainllm.ContentPart{
			Type: "reasoning", Text: stringValue(part, "text"), Metadata: rawJSON(item),
		})
	}
	return message
}

func encodeReasoningEnvelope(part domainllm.OutputPart) string {
	payload, _ := json.Marshal(reasoningEnvelope{Text: part.Text, Signature: part.Signature})
	return reasoningEnvelopePrefix + base64.RawURLEncoding.EncodeToString(payload)
}

func decodeReasoningEnvelope(value string) (reasoningEnvelope, bool) {
	if !strings.HasPrefix(value, reasoningEnvelopePrefix) {
		return reasoningEnvelope{}, false
	}
	encoded := strings.TrimPrefix(value, reasoningEnvelopePrefix)
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return reasoningEnvelope{}, false
	}
	var envelope reasoningEnvelope
	if json.Unmarshal(payload, &envelope) != nil {
		return reasoningEnvelope{}, false
	}
	return envelope, true
}

func responsesToolChoice(raw json.RawMessage) *domainllm.ToolChoice {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var mode string
	if json.Unmarshal(raw, &mode) == nil {
		return &domainllm.ToolChoice{Mode: mode}
	}
	var choice map[string]any
	if json.Unmarshal(raw, &choice) != nil {
		return nil
	}
	if stringValue(choice, "type") == "function" {
		return &domainllm.ToolChoice{Mode: "tool", Name: stringValue(choice, "name")}
	}
	return nil
}

func writeOpenAIResponses(
	w http.ResponseWriter,
	request domainllm.GenerateRequest,
	generation domainllm.Generation,
) {
	if !request.Stream {
		for event := range generation.Events {
			if event.Error != nil {
				fail(w, http.StatusBadGateway, event.Error.Message)
				return
			}
			if event.Response != nil {
				respond(w, http.StatusOK, neutralToResponses(*event.Response))
				return
			}
		}
		fail(w, http.StatusBadGateway, "model provider ended without a response")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	adapter := newResponsesStreamAdapter(request.Model)
	for event := range generation.Events {
		wireEvents := adapter.convert(event)
		for _, wireEvent := range wireEvents {
			payload, _ := json.Marshal(wireEvent)
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", wireEvent["type"], payload)
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

type responsesStreamAdapter struct {
	model    string
	sequence int
	started  map[int]string
}

func newResponsesStreamAdapter(model string) *responsesStreamAdapter {
	return &responsesStreamAdapter{model: model, started: make(map[int]string)}
}

func (a *responsesStreamAdapter) convert(event domainllm.Event) []map[string]any {
	result := make([]map[string]any, 0, 3)
	if itemType := responsesItemType(event); itemType != "" {
		if a.started[event.OutputIndex] == "" {
			result = append(result, a.startItem(event, itemType)...)
			a.started[event.OutputIndex] = itemType
		}
	}
	converted := neutralToResponsesEvent(event)
	if converted != nil {
		if event.Type == "response.created" {
			response, _ := converted["response"].(map[string]any)
			response["model"] = a.model
		}
		result = append(result, converted)
	}
	for _, wireEvent := range result {
		a.sequence++
		wireEvent["sequence_number"] = a.sequence
	}
	return result
}

func responsesItemType(event domainllm.Event) string {
	switch event.Type {
	case "output.text.delta":
		return "text"
	case "output.reasoning.delta":
		return "reasoning"
	case "output.tool_call.arguments.delta":
		return "tool_call"
	case "output.added":
		if event.Output != nil {
			return event.Output.Type
		}
	}
	return ""
}

func (a *responsesStreamAdapter) startItem(
	event domainllm.Event,
	itemType string,
) []map[string]any {
	itemID := responsesItemID(itemType, event.OutputIndex)
	base := map[string]any{
		"type":         "response.output_item.added",
		"response_id":  event.ResponseID,
		"output_index": event.OutputIndex,
	}
	switch itemType {
	case "text", "refusal":
		base["item"] = map[string]any{
			"id": itemID, "type": "message", "status": "in_progress",
			"role": "assistant", "content": []any{},
		}
		contentType := "output_text"
		part := map[string]any{"type": contentType, "text": "", "annotations": []any{}}
		if itemType == "refusal" {
			part = map[string]any{"type": "refusal", "refusal": ""}
		}
		return []map[string]any{base, {
			"type": "response.content_part.added", "response_id": event.ResponseID,
			"item_id": itemID, "output_index": event.OutputIndex,
			"content_index": 0, "part": part,
		}}
	case "reasoning":
		base["item"] = map[string]any{
			"id": itemID, "type": "reasoning", "status": "in_progress",
			"summary": []any{},
		}
		return []map[string]any{base, {
			"type":        "response.reasoning_summary_part.added",
			"response_id": event.ResponseID, "item_id": itemID,
			"output_index": event.OutputIndex, "summary_index": 0,
			"part": map[string]any{"type": "summary_text", "text": ""},
		}}
	case "tool_call":
		call := &domainllm.ToolCall{}
		if event.Output != nil && event.Output.ToolCall != nil {
			call = event.Output.ToolCall
		}
		base["item"] = map[string]any{
			"id": itemID, "type": "function_call", "status": "in_progress",
			"call_id": call.ID, "name": call.Name, "arguments": "",
		}
		return []map[string]any{base}
	default:
		return nil
	}
}

func responsesItemID(itemType string, outputIndex int) string {
	prefix := "msg"
	if itemType == "reasoning" {
		prefix = "rs"
	} else if itemType == "tool_call" {
		prefix = "fc"
	}
	return fmt.Sprintf("%s_%d", prefix, outputIndex)
}

func neutralToResponses(response domainllm.GenerateResponse) map[string]any {
	return map[string]any{
		"id": response.ID, "object": "response", "status": "completed",
		"model": response.Model, "output": responsesOutput(response.Output),
		"usage": responsesUsage(response.Usage),
	}
}

func responsesOutput(parts []domainllm.OutputPart) []map[string]any {
	result := make([]map[string]any, 0, len(parts))
	for index, part := range parts {
		switch part.Type {
		case "text", "refusal":
			contentType := "output_text"
			content := map[string]any{"type": contentType, "text": part.Text}
			if part.Type == "refusal" {
				content = map[string]any{"type": "refusal", "refusal": part.Text}
			}
			result = append(result, map[string]any{
				"id": fmt.Sprintf("msg_%d", index), "type": "message",
				"role": "assistant", "status": "completed",
				"content": []map[string]any{content},
			})
		case "reasoning":
			result = append(result, map[string]any{
				"id": fmt.Sprintf("rs_%d", index), "type": "reasoning",
				"summary":           []map[string]any{{"type": "summary_text", "text": part.Text}},
				"content":           []map[string]any{{"type": "reasoning_text", "text": part.Text}},
				"encrypted_content": encodeReasoningEnvelope(part), "status": "completed",
			})
		case "tool_call":
			result = append(result, map[string]any{
				"id": fmt.Sprintf("fc_%d", index), "type": "function_call",
				"call_id": part.ToolCall.ID, "name": part.ToolCall.Name,
				"arguments": string(part.ToolCall.Arguments), "status": "completed",
			})
		}
	}
	return result
}

func responsesUsage(usage domainllm.Usage) map[string]any {
	return map[string]any{
		"input_tokens": usage.InputTokens, "output_tokens": usage.OutputTokens,
		"total_tokens": usage.TotalTokens,
		"input_tokens_details": map[string]int{
			"cached_tokens": usage.CachedInputTokens,
		},
		"output_tokens_details": map[string]int{
			"reasoning_tokens": usage.ReasoningTokens,
		},
	}
}

func neutralToResponsesEvent(event domainllm.Event) map[string]any {
	base := map[string]any{
		"type": event.Type,
	}
	switch event.Type {
	case "response.created":
		base["response"] = map[string]any{
			"id": event.ResponseID, "object": "response", "status": "in_progress",
			"output": []any{},
		}
		return base
	case "output.text.delta":
		base["type"] = "response.output_text.delta"
		base["response_id"] = event.ResponseID
		base["output_index"] = event.OutputIndex
		base["content_index"] = 0
		base["item_id"] = responsesItemID("text", event.OutputIndex)
		base["delta"] = event.Delta
		base["logprobs"] = []any{}
		return base
	case "output.reasoning.delta":
		base["type"] = "response.reasoning_summary_text.delta"
		base["response_id"] = event.ResponseID
		base["output_index"] = event.OutputIndex
		base["summary_index"] = 0
		base["item_id"] = responsesItemID("reasoning", event.OutputIndex)
		base["delta"] = event.Delta
		return base
	case "output.tool_call.arguments.delta":
		base["type"] = "response.function_call_arguments.delta"
		base["response_id"] = event.ResponseID
		base["output_index"] = event.OutputIndex
		base["item_id"] = responsesItemID("tool_call", event.OutputIndex)
		base["delta"] = event.Delta
		return base
	case "output.added":
		return nil
	case "response.completed":
		base["response"] = neutralToResponses(*event.Response)
		return base
	case "error":
		base["error"] = event.Error
		return base
	default:
		return nil
	}
}

func valueText(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func stringValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

func rawJSON(value any) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}
