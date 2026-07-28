package httptransport

import (
	"encoding/json"
	"testing"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
)

func TestResponsesReasoningRoundTripPreservesThinkingAndToolCall(t *testing.T) {
	output := []domainllm.OutputPart{
		{Type: "reasoning", Text: "exact thinking", Signature: "provider-signature"},
		{Type: "tool_call", ToolCall: &domainllm.ToolCall{
			ID: "call-1", Name: "shell", Arguments: json.RawMessage(`{"command":"pwd"}`),
		}},
	}
	wireOutput := responsesOutput(output)
	encoded, err := json.Marshal(wireOutput)
	if err != nil {
		t.Fatal(err)
	}
	messages, err := responsesInputToNeutral(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("messages = %#v, want one assistant turn", messages)
	}
	message := messages[0]
	if len(message.Content) != 1 || message.Content[0].Text != "exact thinking" ||
		message.Content[0].Signature != "provider-signature" {
		t.Fatalf("reasoning was not preserved: %#v", message.Content)
	}
	if len(message.ToolCalls) != 1 || message.ToolCalls[0].ID != "call-1" {
		t.Fatalf("tool call was not merged into the reasoning turn: %#v", message.ToolCalls)
	}
}

func TestResponsesReasoningContentFallbackIsLossless(t *testing.T) {
	input := json.RawMessage(`[
		{"type":"reasoning","content":[
			{"type":"reasoning_text","text":"full thought"}
		],"summary":[{"type":"summary_text","text":"short"}]}
	]`)
	messages, err := responsesInputToNeutral(input)
	if err != nil {
		t.Fatal(err)
	}
	if got := messages[0].Content[0].Text; got != "full thought" {
		t.Fatalf("reasoning text = %q, want full thought", got)
	}
}
