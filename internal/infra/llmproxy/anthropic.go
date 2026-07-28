package llmproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

func (c *Client) generateAnthropic(
	ctx context.Context,
	selection domainllm.Selection,
	apiKey string,
	request domainllm.GenerateRequest,
) (domainllm.Generation, error) {
	payload, err := anthropicRequest(request, selection.Model.UpstreamModel)
	if err != nil {
		return domainllm.Generation{}, err
	}
	return c.startRequest(
		ctx,
		http.MethodPost,
		providerEndpoint(selection.Provider.APIBase, "messages"),
		map[string]string{
			"x-api-key": apiKey, "anthropic-version": "2023-06-01",
		},
		payload,
		func(response *http.Response, events chan<- domainllm.Event) {
			if request.Stream {
				consumeAnthropicStream(response, events, selection.Model.Name)
				return
			}
			consumeAnthropicResponse(response, events, selection.Model.Name)
		},
	)
}

func anthropicRequest(
	request domainllm.GenerateRequest,
	model string,
) (map[string]any, error) {
	messages := make([]map[string]any, 0, len(request.Messages))
	system := make([]map[string]any, 0)
	for _, message := range request.Messages {
		content, err := anthropicContent(message)
		if err != nil {
			return nil, err
		}
		if message.Role == "system" || message.Role == "developer" {
			system = append(system, content...)
			continue
		}
		role := message.Role
		if role == "tool" {
			role = "user"
		}
		if len(messages) != 0 && stringValue(messages[len(messages)-1], "role") == role {
			previous, _ := messages[len(messages)-1]["content"].([]map[string]any)
			messages[len(messages)-1]["content"] = append(previous, content...)
			continue
		}
		messages = append(messages, map[string]any{"role": role, "content": content})
	}
	maxTokens := request.MaxOutputTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	payload := map[string]any{
		"model": model, "messages": messages,
		"max_tokens": maxTokens, "stream": request.Stream,
	}
	if len(system) != 0 {
		payload["system"] = system
	}
	if request.Temperature != nil {
		payload["temperature"] = *request.Temperature
	}
	if request.TopP != nil {
		payload["top_p"] = *request.TopP
	}
	if len(request.Stop) != 0 {
		payload["stop_sequences"] = request.Stop
	}
	if len(request.Tools) != 0 {
		payload["tools"] = anthropicTools(request.Tools)
	}
	if request.ToolChoice != nil {
		choice := anthropicToolChoice(*request.ToolChoice)
		if request.ParallelTools != nil && !*request.ParallelTools {
			choice["disable_parallel_tool_use"] = true
		}
		payload["tool_choice"] = choice
	}
	outputConfig := make(map[string]any)
	if request.Reasoning != nil {
		display := defaultString(request.Reasoning.Summary, "summarized")
		payload["thinking"] = map[string]string{"type": "adaptive", "display": display}
		if request.Reasoning.Effort != "" {
			outputConfig["effort"] = request.Reasoning.Effort
		}
	}
	if request.ResponseFormat != nil {
		if request.ResponseFormat.Type != "json_schema" {
			return nil, fmt.Errorf("Anthropic structured output requires json_schema")
		}
		outputConfig["format"] = map[string]any{
			"type": "json_schema", "schema": request.ResponseFormat.Schema,
		}
	}
	if len(outputConfig) != 0 {
		payload["output_config"] = outputConfig
	}
	return payload, nil
}

func anthropicContent(message domainllm.Message) ([]map[string]any, error) {
	if message.Role == "tool" {
		return []map[string]any{{
			"type": "tool_result", "tool_use_id": message.ToolCallID,
			"content": anthropicTextContent(message.Content),
		}}, nil
	}
	content := make([]map[string]any, 0, len(message.Content)+len(message.ToolCalls))
	for _, part := range message.Content {
		switch part.Type {
		case "text":
			content = append(content, map[string]any{"type": "text", "text": part.Text})
		case "reasoning":
			content = append(content, map[string]any{
				"type": "thinking", "thinking": part.Text, "signature": part.Signature,
			})
		case "image":
			source, err := anthropicSource(part, "image")
			if err != nil {
				return nil, err
			}
			content = append(content, map[string]any{"type": "image", "source": source})
		case "file":
			source, err := anthropicSource(part, "document")
			if err != nil {
				return nil, err
			}
			content = append(content, map[string]any{
				"type": "document", "source": source,
			})
		default:
			return nil, fmt.Errorf("unsupported Anthropic content type %q", part.Type)
		}
	}
	for _, call := range message.ToolCalls {
		var input any = map[string]any{}
		if len(call.Arguments) != 0 {
			if err := json.Unmarshal(call.Arguments, &input); err != nil {
				return nil, fmt.Errorf("tool call arguments are not valid JSON: %w", err)
			}
		}
		content = append(content, map[string]any{
			"type": "tool_use", "id": call.ID, "name": call.Name, "input": input,
		})
	}
	return content, nil
}

func anthropicSource(part domainllm.ContentPart, kind string) (map[string]any, error) {
	if part.Source == nil {
		return nil, fmt.Errorf("%s source is required", kind)
	}
	if part.Source.URL != "" {
		return map[string]any{"type": "url", "url": part.Source.URL}, nil
	}
	if part.Source.Data == "" || part.Source.MediaType == "" {
		return nil, fmt.Errorf("%s data and mediaType are required", kind)
	}
	return map[string]any{
		"type": "base64", "media_type": part.Source.MediaType,
		"data": part.Source.Data,
	}, nil
}

func anthropicTextContent(parts []domainllm.ContentPart) []map[string]any {
	result := make([]map[string]any, 0, len(parts))
	for _, part := range parts {
		if part.Type == "text" {
			result = append(result, map[string]any{"type": "text", "text": part.Text})
		}
	}
	return result
}

func anthropicTools(tools []domainllm.Tool) []map[string]any {
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		result = append(result, map[string]any{
			"name": tool.Name, "description": tool.Description,
			"input_schema": tool.InputSchema,
			"strict":       tool.Strict,
		})
	}
	return result
}

func anthropicToolChoice(choice domainllm.ToolChoice) map[string]any {
	switch choice.Mode {
	case "required":
		return map[string]any{"type": "any"}
	case "tool":
		return map[string]any{"type": "tool", "name": choice.Name}
	default:
		return map[string]any{"type": choice.Mode}
	}
}

func consumeAnthropicResponse(
	response *http.Response,
	events chan<- domainllm.Event,
	model string,
) {
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		sendError(events, "invalid_provider_response", err.Error(), false)
		return
	}
	completed := anthropicCompleted(payload, model)
	events <- domainllm.Event{
		Type: "response.completed", ResponseID: completed.ID, Response: &completed,
	}
}

type anthropicStreamState struct {
	id           string
	model        string
	parts        map[int]*domainllm.OutputPart
	finishReason string
	usage        domainllm.Usage
}

func consumeAnthropicStream(
	response *http.Response,
	events chan<- domainllm.Event,
	model string,
) {
	state := &anthropicStreamState{model: model, parts: make(map[int]*domainllm.OutputPart)}
	err := scanSSE(response.Body, func(_ string, data []byte) bool {
		var payload map[string]any
		if json.Unmarshal(data, &payload) != nil {
			return true
		}
		typeName := stringValue(payload, "type")
		switch typeName {
		case "message_start":
			message, _ := payload["message"].(map[string]any)
			state.id = stringValue(message, "id")
			readAnthropicUsage(message, &state.usage)
			events <- domainllm.Event{Type: "response.created", ResponseID: state.id}
		case "content_block_start":
			index := intValue(payload, "index")
			block, _ := payload["content_block"].(map[string]any)
			part := anthropicOutputPart(block)
			state.parts[index] = &part
			snapshot := part
			events <- domainllm.Event{
				Type: "output.added", ResponseID: state.id,
				OutputIndex: index, Output: &snapshot,
			}
		case "content_block_delta":
			consumeAnthropicDelta(payload, state, events)
		case "message_delta":
			delta, _ := payload["delta"].(map[string]any)
			state.finishReason = stringValue(delta, "stop_reason")
			readAnthropicUsage(payload, &state.usage)
		case "message_stop":
			emitAnthropicCompleted(events, state)
			return false
		case "error":
			sendError(events, "provider_stream_error", "Anthropic stream failed", false)
			return false
		}
		return true
	})
	if err != nil {
		sendError(events, "provider_stream_error", err.Error(), true)
	}
}

func consumeAnthropicDelta(
	payload map[string]any,
	state *anthropicStreamState,
	events chan<- domainllm.Event,
) {
	index := intValue(payload, "index")
	part := state.parts[index]
	if part == nil {
		return
	}
	delta, _ := payload["delta"].(map[string]any)
	switch stringValue(delta, "type") {
	case "text_delta":
		text := stringValue(delta, "text")
		part.Text += text
		events <- domainllm.Event{
			Type: "output.text.delta", ResponseID: state.id,
			OutputIndex: index, Delta: text,
		}
	case "thinking_delta":
		text := stringValue(delta, "thinking")
		part.Text += text
		events <- domainllm.Event{
			Type: "output.reasoning.delta", ResponseID: state.id,
			OutputIndex: index, Delta: text,
		}
	case "signature_delta":
		part.Signature += stringValue(delta, "signature")
	case "input_json_delta":
		arguments := stringValue(delta, "partial_json")
		if part.ToolCall == nil {
			return
		}
		arguments = appendToolArguments(part.ToolCall, arguments)
		if arguments == "" {
			return
		}
		events <- domainllm.Event{
			Type: "output.tool_call.arguments.delta", ResponseID: state.id,
			OutputIndex: index, Delta: arguments,
		}
	}
}

func emitAnthropicCompleted(
	events chan<- domainllm.Event,
	state *anthropicStreamState,
) {
	completed := domainllm.GenerateResponse{
		ID: state.id, Model: state.model,
		FinishReason: finishReason(state.finishReason), Usage: state.usage,
	}
	for index := 0; index < len(state.parts); index++ {
		if part := state.parts[index]; part != nil {
			completed.Output = append(completed.Output, *part)
		}
	}
	events <- domainllm.Event{
		Type: "response.completed", ResponseID: state.id, Response: &completed,
	}
}

func anthropicCompleted(payload map[string]any, model string) domainllm.GenerateResponse {
	result := domainllm.GenerateResponse{
		ID: stringValue(payload, "id"), Model: model,
		FinishReason: finishReason(stringValue(payload, "stop_reason")),
	}
	content, _ := payload["content"].([]any)
	for _, rawPart := range content {
		part, _ := rawPart.(map[string]any)
		result.Output = append(result.Output, anthropicOutputPart(part))
	}
	readAnthropicUsage(payload, &result.Usage)
	return result
}

func anthropicOutputPart(block map[string]any) domainllm.OutputPart {
	switch stringValue(block, "type") {
	case "text":
		return domainllm.OutputPart{Type: "text", Text: stringValue(block, "text")}
	case "thinking", "redacted_thinking":
		return domainllm.OutputPart{
			Type: "reasoning", Text: stringValue(block, "thinking"),
			Signature: stringValue(block, "signature"), Metadata: rawJSON(block),
		}
	case "tool_use":
		return domainllm.OutputPart{
			Type: "tool_call",
			ToolCall: &domainllm.ToolCall{
				ID: stringValue(block, "id"), Name: stringValue(block, "name"),
				Arguments: rawJSON(block["input"]),
			},
		}
	default:
		return domainllm.OutputPart{Type: "metadata", Metadata: rawJSON(block)}
	}
}

func readAnthropicUsage(payload map[string]any, usage *domainllm.Usage) {
	values, _ := payload["usage"].(map[string]any)
	if values == nil {
		return
	}
	if input := intValue(values, "input_tokens"); input != 0 {
		usage.InputTokens = input
	}
	usage.CachedInputTokens = intValue(values, "cache_read_input_tokens")
	if output := intValue(values, "output_tokens"); output != 0 {
		usage.OutputTokens = output
	}
	outputDetails, _ := values["output_tokens_details"].(map[string]any)
	usage.ReasoningTokens = intValue(outputDetails, "thinking_tokens")
	usage.TotalTokens = usage.InputTokens + usage.OutputTokens
}
