package llmproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

func (c *Client) generateDeepSeek(
	ctx context.Context,
	selection domainllm.Selection,
	apiKey string,
	request domainllm.GenerateRequest,
) (domainllm.Generation, error) {
	payload, err := deepSeekRequest(request, selection.Model.UpstreamModel)
	if err != nil {
		return domainllm.Generation{}, err
	}
	return c.startRequest(
		ctx,
		http.MethodPost,
		providerEndpoint(selection.Provider.APIBase, "chat/completions"),
		map[string]string{"Authorization": "Bearer " + apiKey},
		payload,
		func(response *http.Response, events chan<- domainllm.Event) {
			if request.Stream {
				consumeDeepSeekStream(response, events, selection.Model.Name)
				return
			}
			consumeDeepSeekResponse(response, events, selection.Model.Name)
		},
	)
}

func deepSeekRequest(
	request domainllm.GenerateRequest,
	model string,
) (map[string]any, error) {
	messages := make([]map[string]any, 0, len(request.Messages))
	for _, message := range request.Messages {
		converted := map[string]any{
			"role": message.Role, "content": textContent(message.Content),
		}
		if message.ToolCallID != "" {
			converted["tool_call_id"] = message.ToolCallID
		}
		for _, part := range message.Content {
			if part.Type == "reasoning" {
				converted["reasoning_content"] = part.Text
			}
		}
		if len(message.ToolCalls) != 0 {
			converted["tool_calls"] = chatToolCalls(message.ToolCalls)
		}
		messages = append(messages, converted)
	}
	payload := map[string]any{
		"model": model, "messages": messages, "stream": request.Stream,
	}
	if request.Stream {
		payload["stream_options"] = map[string]bool{"include_usage": true}
	}
	if request.MaxOutputTokens > 0 {
		payload["max_tokens"] = request.MaxOutputTokens
	}
	if request.Temperature != nil {
		payload["temperature"] = *request.Temperature
	}
	if request.TopP != nil {
		payload["top_p"] = *request.TopP
	}
	if len(request.Stop) != 0 {
		payload["stop"] = request.Stop
	}
	if len(request.Tools) != 0 {
		payload["tools"] = chatTools(request.Tools)
	}
	if request.ToolChoice != nil {
		payload["tool_choice"] = chatToolChoice(*request.ToolChoice)
	}
	if request.ParallelTools != nil {
		payload["parallel_tool_calls"] = *request.ParallelTools
	}
	if request.Reasoning != nil {
		payload["thinking"] = map[string]string{"type": "enabled"}
		if request.Reasoning.Effort != "" {
			payload["reasoning_effort"] = deepSeekEffort(request.Reasoning.Effort)
		}
	}
	if request.ResponseFormat != nil {
		switch request.ResponseFormat.Type {
		case "text", "json_object":
			payload["response_format"] = map[string]string{
				"type": request.ResponseFormat.Type,
			}
		default:
			return nil, fmt.Errorf("DeepSeek does not support this response format")
		}
	}
	return payload, nil
}

func chatTools(tools []domainllm.Tool) []map[string]any {
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		result = append(result, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name": tool.Name, "description": tool.Description,
				"parameters": tool.InputSchema, "strict": tool.Strict,
			},
		})
	}
	return result
}

func chatToolCalls(calls []domainllm.ToolCall) []map[string]any {
	result := make([]map[string]any, 0, len(calls))
	for _, call := range calls {
		result = append(result, map[string]any{
			"id": call.ID, "type": "function",
			"function": map[string]any{
				"name": call.Name, "arguments": string(call.Arguments),
			},
		})
	}
	return result
}

func chatToolChoice(choice domainllm.ToolChoice) any {
	if choice.Mode == "tool" {
		return map[string]any{
			"type": "function", "function": map[string]string{"name": choice.Name},
		}
	}
	return choice.Mode
}

func deepSeekEffort(effort string) string {
	if effort == "max" || effort == "xhigh" {
		return "max"
	}
	return "high"
}

func consumeDeepSeekResponse(
	response *http.Response,
	events chan<- domainllm.Event,
	model string,
) {
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		sendError(events, "invalid_provider_response", err.Error(), false)
		return
	}
	completed := deepSeekCompleted(payload, model)
	events <- domainllm.Event{
		Type: "response.completed", ResponseID: completed.ID, Response: &completed,
	}
}

type deepSeekStreamState struct {
	id           string
	model        string
	text         strings.Builder
	reasoning    strings.Builder
	toolCalls    map[int]*domainllm.ToolCall
	toolIndexes  map[int]int
	textIndex    int
	reasonIndex  int
	nextIndex    int
	finishReason string
	usage        domainllm.Usage
	started      bool
}

func consumeDeepSeekStream(
	response *http.Response,
	events chan<- domainllm.Event,
	model string,
) {
	state := &deepSeekStreamState{
		model: model, toolCalls: make(map[int]*domainllm.ToolCall),
		toolIndexes: make(map[int]int), textIndex: -1, reasonIndex: -1,
	}
	err := scanSSE(response.Body, func(_ string, data []byte) bool {
		if string(data) == "[DONE]" {
			emitDeepSeekCompleted(events, state)
			return false
		}
		var payload map[string]any
		if json.Unmarshal(data, &payload) != nil {
			return true
		}
		if !state.started {
			state.id = stringValue(payload, "id")
			state.started = true
			events <- domainllm.Event{Type: "response.created", ResponseID: state.id}
		}
		readDeepSeekUsage(payload, &state.usage)
		choices, _ := payload["choices"].([]any)
		for _, rawChoice := range choices {
			choice, _ := rawChoice.(map[string]any)
			if reason := stringValue(choice, "finish_reason"); reason != "" {
				state.finishReason = reason
			}
			delta, _ := choice["delta"].(map[string]any)
			if text := stringValue(delta, "content"); text != "" {
				if state.textIndex < 0 {
					state.textIndex = state.allocateIndex()
				}
				state.text.WriteString(text)
				events <- domainllm.Event{
					Type: "output.text.delta", ResponseID: state.id,
					OutputIndex: state.textIndex, Delta: text,
				}
			}
			if reasoning := stringValue(delta, "reasoning_content"); reasoning != "" {
				if state.reasonIndex < 0 {
					state.reasonIndex = state.allocateIndex()
				}
				state.reasoning.WriteString(reasoning)
				events <- domainllm.Event{
					Type: "output.reasoning.delta", ResponseID: state.id,
					OutputIndex: state.reasonIndex, Delta: reasoning,
				}
			}
			consumeChatToolDeltas(delta, state, events)
		}
		return true
	})
	if err != nil {
		sendError(events, "provider_stream_error", err.Error(), true)
	}
}

func (s *deepSeekStreamState) allocateIndex() int {
	index := s.nextIndex
	s.nextIndex++
	return index
}

func consumeChatToolDeltas(
	delta map[string]any,
	state *deepSeekStreamState,
	events chan<- domainllm.Event,
) {
	rawCalls, _ := delta["tool_calls"].([]any)
	for _, rawCall := range rawCalls {
		callDelta, _ := rawCall.(map[string]any)
		index := intValue(callDelta, "index")
		call := state.toolCalls[index]
		if call == nil {
			call = &domainllm.ToolCall{}
			state.toolCalls[index] = call
			state.toolIndexes[index] = state.allocateIndex()
		}
		outputIndex := state.toolIndexes[index]
		if identifier := stringValue(callDelta, "id"); identifier != "" {
			call.ID = identifier
		}
		function, _ := callDelta["function"].(map[string]any)
		if name := stringValue(function, "name"); name != "" {
			call.Name = name
			callSnapshot := *call
			part := domainllm.OutputPart{Type: "tool_call", ToolCall: &callSnapshot}
			events <- domainllm.Event{
				Type: "output.added", ResponseID: state.id,
				OutputIndex: outputIndex, Output: &part,
			}
		}
		if arguments := stringValue(function, "arguments"); arguments != "" {
			arguments = appendToolArguments(call, arguments)
			if arguments == "" {
				continue
			}
			events <- domainllm.Event{
				Type: "output.tool_call.arguments.delta", ResponseID: state.id,
				OutputIndex: outputIndex, Delta: arguments,
			}
		}
	}
}

func emitDeepSeekCompleted(events chan<- domainllm.Event, state *deepSeekStreamState) {
	completed := domainllm.GenerateResponse{
		ID: state.id, Model: state.model,
		FinishReason: finishReason(state.finishReason), Usage: state.usage,
	}
	parts := make(map[int]domainllm.OutputPart, state.nextIndex)
	if state.reasoning.Len() != 0 {
		parts[state.reasonIndex] = domainllm.OutputPart{
			Type: "reasoning", Text: state.reasoning.String(),
		}
	}
	if state.text.Len() != 0 {
		parts[state.textIndex] = domainllm.OutputPart{
			Type: "text", Text: state.text.String(),
		}
	}
	for index := 0; index < len(state.toolCalls); index++ {
		if call := state.toolCalls[index]; call != nil {
			parts[state.toolIndexes[index]] = domainllm.OutputPart{
				Type: "tool_call", ToolCall: call,
			}
		}
	}
	for index := 0; index < state.nextIndex; index++ {
		if part, ok := parts[index]; ok {
			completed.Output = append(completed.Output, part)
		}
	}
	events <- domainllm.Event{
		Type: "response.completed", ResponseID: state.id, Response: &completed,
	}
}

func deepSeekCompleted(payload map[string]any, model string) domainllm.GenerateResponse {
	result := domainllm.GenerateResponse{ID: stringValue(payload, "id"), Model: model}
	choices, _ := payload["choices"].([]any)
	if len(choices) != 0 {
		choice, _ := choices[0].(map[string]any)
		result.FinishReason = finishReason(stringValue(choice, "finish_reason"))
		message, _ := choice["message"].(map[string]any)
		if reasoning := stringValue(message, "reasoning_content"); reasoning != "" {
			result.Output = append(result.Output, domainllm.OutputPart{
				Type: "reasoning", Text: reasoning,
			})
		}
		if text := stringValue(message, "content"); text != "" {
			result.Output = append(result.Output, domainllm.OutputPart{Type: "text", Text: text})
		}
		result.Output = append(result.Output, parseChatToolCalls(message)...)
	}
	usage, _ := payload["usage"].(map[string]any)
	readDeepSeekUsage(payload, &result.Usage)
	if result.Usage.TotalTokens == 0 {
		readUsage(usage, &result.Usage)
	}
	return result
}

func parseChatToolCalls(message map[string]any) []domainllm.OutputPart {
	rawCalls, _ := message["tool_calls"].([]any)
	result := make([]domainllm.OutputPart, 0, len(rawCalls))
	for _, rawCall := range rawCalls {
		call, _ := rawCall.(map[string]any)
		function, _ := call["function"].(map[string]any)
		result = append(result, domainllm.OutputPart{
			Type: "tool_call",
			ToolCall: &domainllm.ToolCall{
				ID: stringValue(call, "id"), Name: stringValue(function, "name"),
				Arguments: json.RawMessage(stringValue(function, "arguments")),
			},
		})
	}
	return result
}

func readDeepSeekUsage(payload map[string]any, usage *domainllm.Usage) {
	values, _ := payload["usage"].(map[string]any)
	if values == nil {
		return
	}
	readUsage(values, usage)
	usage.CachedInputTokens = intValue(values, "prompt_cache_hit_tokens")
	details, _ := values["completion_tokens_details"].(map[string]any)
	usage.ReasoningTokens = intValue(details, "reasoning_tokens")
}

func readUsage(values map[string]any, usage *domainllm.Usage) {
	usage.InputTokens = intValue(values, "prompt_tokens")
	usage.OutputTokens = intValue(values, "completion_tokens")
	usage.TotalTokens = intValue(values, "total_tokens")
}
