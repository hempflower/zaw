package llmproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

func (c *Client) generateOpenAI(
	ctx context.Context,
	selection domainllm.Selection,
	apiKey string,
	request domainllm.GenerateRequest,
) (domainllm.Generation, error) {
	payload, err := openAIRequest(request, selection.Model.UpstreamModel)
	if err != nil {
		return domainllm.Generation{}, err
	}
	return c.startRequest(
		ctx,
		http.MethodPost,
		providerEndpoint(selection.Provider.APIBase, "responses"),
		map[string]string{"Authorization": "Bearer " + apiKey},
		payload,
		func(response *http.Response, events chan<- domainllm.Event) {
			if request.Stream {
				consumeOpenAIStream(response, events, selection.Model.Name)
				return
			}
			consumeOpenAIResponse(response, events, selection.Model.Name)
		},
	)
}

func openAIRequest(request domainllm.GenerateRequest, model string) (map[string]any, error) {
	input, err := openAIInput(request.Messages)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"model": model, "input": input, "stream": request.Stream,
	}
	if request.MaxOutputTokens > 0 {
		payload["max_output_tokens"] = request.MaxOutputTokens
	}
	if request.Temperature != nil {
		payload["temperature"] = *request.Temperature
	}
	if request.TopP != nil {
		payload["top_p"] = *request.TopP
	}
	if request.ParallelTools != nil {
		payload["parallel_tool_calls"] = *request.ParallelTools
	}
	if len(request.Tools) != 0 {
		payload["tools"] = openAITools(request.Tools)
	}
	if request.ToolChoice != nil {
		payload["tool_choice"] = openAIToolChoice(*request.ToolChoice)
	}
	if request.Reasoning != nil {
		payload["reasoning"] = map[string]any{
			"effort":  request.Reasoning.Effort,
			"summary": request.Reasoning.Summary,
		}
	}
	if request.ResponseFormat != nil {
		format, formatErr := openAIResponseFormat(*request.ResponseFormat)
		if formatErr != nil {
			return nil, formatErr
		}
		payload["text"] = map[string]any{"format": format}
	}
	return payload, nil
}

func openAIInput(messages []domainllm.Message) ([]map[string]any, error) {
	items := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		if len(message.Content) == 1 && message.Content[0].Type == "reasoning" &&
			len(message.Content[0].Metadata) != 0 {
			var reasoning map[string]any
			if json.Unmarshal(message.Content[0].Metadata, &reasoning) == nil &&
				reasoning["type"] == "reasoning" {
				items = append(items, reasoning)
				continue
			}
		}
		if message.Role == "tool" {
			items = append(items, map[string]any{
				"type": "function_call_output", "call_id": message.ToolCallID,
				"output": textContent(message.Content),
			})
			continue
		}
		content := make([]map[string]any, 0, len(message.Content))
		for _, part := range message.Content {
			converted, err := openAIContentPart(part, message.Role)
			if err != nil {
				return nil, err
			}
			content = append(content, converted)
		}
		items = append(items, map[string]any{
			"type": "message", "role": message.Role, "content": content,
		})
		for _, call := range message.ToolCalls {
			items = append(items, map[string]any{
				"type": "function_call", "call_id": call.ID,
				"name": call.Name, "arguments": string(call.Arguments),
			})
		}
	}
	return items, nil
}

func openAIContentPart(part domainllm.ContentPart, role string) (map[string]any, error) {
	switch part.Type {
	case "text":
		contentType := "input_text"
		if role == "assistant" {
			contentType = "output_text"
		}
		return map[string]any{"type": contentType, "text": part.Text}, nil
	case "image":
		if part.Source == nil {
			return nil, fmt.Errorf("image source is required")
		}
		imageURL := part.Source.URL
		if imageURL == "" {
			imageURL = dataURL(*part.Source)
		}
		return map[string]any{
			"type": "input_image", "image_url": imageURL,
			"detail": defaultString(part.Source.Detail, "auto"),
		}, nil
	case "audio":
		if part.Source == nil || part.Source.Data == "" {
			return nil, fmt.Errorf("audio data is required")
		}
		return map[string]any{
			"type": "input_audio",
			"input_audio": map[string]any{
				"data": part.Source.Data, "format": mediaSubtype(part.Source.MediaType),
			},
		}, nil
	case "file":
		if part.Source == nil {
			return nil, fmt.Errorf("file source is required")
		}
		file := map[string]any{"type": "input_file", "filename": part.Source.FileName}
		if part.Source.URL != "" {
			file["file_url"] = part.Source.URL
		} else {
			file["file_data"] = dataURL(*part.Source)
		}
		return file, nil
	case "reasoning":
		return map[string]any{"type": "input_text", "text": part.Text}, nil
	default:
		return nil, fmt.Errorf("unsupported OpenAI content type %q", part.Type)
	}
}

func openAITools(tools []domainllm.Tool) []map[string]any {
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		result = append(result, map[string]any{
			"type": "function", "name": tool.Name,
			"description": tool.Description, "parameters": tool.InputSchema,
			"strict": tool.Strict,
		})
	}
	return result
}

func openAIToolChoice(choice domainllm.ToolChoice) any {
	if choice.Mode == "tool" {
		return map[string]string{"type": "function", "name": choice.Name}
	}
	return choice.Mode
}

func openAIResponseFormat(format domainllm.ResponseFormat) (map[string]any, error) {
	switch format.Type {
	case "text":
		return map[string]any{"type": "text"}, nil
	case "json_object":
		return map[string]any{"type": "json_object"}, nil
	case "json_schema":
		return map[string]any{
			"type": "json_schema", "name": format.Name,
			"description": format.Description, "schema": format.Schema,
			"strict": format.Strict,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported response format %q", format.Type)
	}
}

func consumeOpenAIResponse(
	response *http.Response,
	events chan<- domainllm.Event,
	model string,
) {
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		sendError(events, "invalid_provider_response", err.Error(), false)
		return
	}
	completed := openAICompleted(payload, model)
	events <- domainllm.Event{
		Type: "response.completed", ResponseID: completed.ID, Response: &completed,
	}
}

func consumeOpenAIStream(
	response *http.Response,
	events chan<- domainllm.Event,
	model string,
) {
	err := scanSSE(response.Body, func(_ string, data []byte) bool {
		if string(data) == "[DONE]" {
			return false
		}
		var payload map[string]any
		if json.Unmarshal(data, &payload) != nil {
			return true
		}
		typeName, _ := payload["type"].(string)
		responseID := stringValue(payload, "response_id")
		switch typeName {
		case "response.created":
			responseObject, _ := payload["response"].(map[string]any)
			responseID = stringValue(responseObject, "id")
			events <- domainllm.Event{Type: "response.created", ResponseID: responseID}
		case "response.output_text.delta":
			events <- deltaEvent("output.text.delta", responseID, payload, "delta")
		case "response.reasoning_summary_text.delta", "response.reasoning_text.delta":
			events <- deltaEvent("output.reasoning.delta", responseID, payload, "delta")
		case "response.function_call_arguments.delta":
			events <- deltaEvent("output.tool_call.arguments.delta", responseID, payload, "delta")
		case "response.output_item.added":
			item, _ := payload["item"].(map[string]any)
			if item["type"] == "function_call" {
				part := domainllm.OutputPart{
					Type: "tool_call",
					ToolCall: &domainllm.ToolCall{
						ID: stringValue(item, "call_id"), Name: stringValue(item, "name"),
					},
				}
				events <- domainllm.Event{
					Type: "output.added", ResponseID: responseID,
					OutputIndex: intValue(payload, "output_index"), Output: &part,
				}
			}
		case "response.completed":
			object, _ := payload["response"].(map[string]any)
			completed := openAICompleted(object, model)
			events <- domainllm.Event{
				Type: "response.completed", ResponseID: completed.ID,
				Response: &completed,
			}
			return false
		case "response.failed", "error":
			sendError(events, "provider_stream_error", "OpenAI stream failed", false)
			return false
		}
		return true
	})
	if err != nil {
		sendError(events, "provider_stream_error", err.Error(), true)
	}
}

func openAICompleted(payload map[string]any, model string) domainllm.GenerateResponse {
	result := domainllm.GenerateResponse{
		ID: stringValue(payload, "id"), Model: model,
		FinishReason: finishReason(stringValue(payload, "status")),
	}
	output, _ := payload["output"].([]any)
	for _, value := range output {
		item, _ := value.(map[string]any)
		switch item["type"] {
		case "message":
			content, _ := item["content"].([]any)
			for _, rawPart := range content {
				part, _ := rawPart.(map[string]any)
				partType := stringValue(part, "type")
				if partType == "output_text" {
					result.Output = append(result.Output, domainllm.OutputPart{
						Type: "text", Text: stringValue(part, "text"),
					})
				} else if partType == "refusal" {
					result.Output = append(result.Output, domainllm.OutputPart{
						Type: "refusal", Text: stringValue(part, "refusal"),
					})
				}
			}
		case "reasoning":
			summary, _ := item["summary"].([]any)
			for _, rawPart := range summary {
				part, _ := rawPart.(map[string]any)
				result.Output = append(result.Output, domainllm.OutputPart{
					Type: "reasoning", Text: stringValue(part, "text"),
					Metadata: rawJSON(item),
				})
			}
		case "function_call":
			result.Output = append(result.Output, domainllm.OutputPart{
				Type: "tool_call",
				ToolCall: &domainllm.ToolCall{
					ID: stringValue(item, "call_id"), Name: stringValue(item, "name"),
					Arguments: json.RawMessage(stringValue(item, "arguments")),
				},
			})
		}
	}
	usage, _ := payload["usage"].(map[string]any)
	inputDetails, _ := usage["input_tokens_details"].(map[string]any)
	outputDetails, _ := usage["output_tokens_details"].(map[string]any)
	result.Usage = domainllm.Usage{
		InputTokens:       intValue(usage, "input_tokens"),
		CachedInputTokens: intValue(inputDetails, "cached_tokens"),
		OutputTokens:      intValue(usage, "output_tokens"),
		ReasoningTokens:   intValue(outputDetails, "reasoning_tokens"),
		TotalTokens:       intValue(usage, "total_tokens"),
	}
	return result
}

func deltaEvent(
	typeName string,
	responseID string,
	payload map[string]any,
	deltaKey string,
) domainllm.Event {
	return domainllm.Event{
		Type: typeName, ResponseID: responseID,
		OutputIndex: intValue(payload, "output_index"),
		Delta:       stringValue(payload, deltaKey),
	}
}
