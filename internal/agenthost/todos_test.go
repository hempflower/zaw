package agenthost

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

func TestTodoToolUpdatesSessionMetaAndPreservesOtherKeys(t *testing.T) {
	host := New()
	resource := ahptypes.URI("ahp-session:/todo-test")
	host.sessions[string(resource)] = session{
		Resource: resource,
		State: ahptypes.SessionState{
			Meta: map[string]json.RawMessage{"other": json.RawMessage(`{"kept":true}`)},
		},
	}
	var notification []byte
	host.directPeer.subscriptions[string(resource)] = struct{}{}
	host.directPeer.emit = func(payload []byte) { notification = append([]byte(nil), payload...) }

	result, err := host.todoTool(resource).Handler(context.Background(), map[string]any{
		"todos": []any{
			map[string]any{"id": "one", "title": "First task", "status": "in_progress"},
			map[string]any{"id": "two", "title": "Second task", "status": "pending"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result != "Updated 2 todos." {
		t.Fatalf("unexpected tool result %q", result)
	}
	state := host.sessions[string(resource)].State
	if string(state.Meta["other"]) != `{"kept":true}` {
		t.Fatalf("other metadata was not preserved: %s", state.Meta["other"])
	}
	var todos todoState
	if err := json.Unmarshal(state.Meta[zawTodosMetaKey], &todos); err != nil {
		t.Fatal(err)
	}
	if todos.Version != 1 || len(todos.Items) != 2 || todos.Items[0].Status != "in_progress" {
		t.Fatalf("unexpected todo state: %#v", todos)
	}
	if len(notification) == 0 {
		t.Fatal("expected session/metaChanged notification")
	}
	var message struct {
		Method string `json:"method"`
		Params struct {
			Channel string `json:"channel"`
			Action  struct {
				Type string `json:"type"`
			} `json:"action"`
		} `json:"params"`
	}
	if err := json.Unmarshal(notification, &message); err != nil {
		t.Fatal(err)
	}
	if message.Method != "action" ||
		message.Params.Channel != string(resource) ||
		message.Params.Action.Type != "session/metaChanged" {
		t.Fatalf("unexpected notification: %s", notification)
	}
}

func TestTodoToolRejectsInvalidLists(t *testing.T) {
	tests := []struct {
		name  string
		todos []todoItem
	}{
		{
			name: "duplicate ids",
			todos: []todoItem{
				{ID: "one", Title: "A", Status: "pending"},
				{ID: "one", Title: "B", Status: "pending"},
			},
		},
		{
			name: "multiple active",
			todos: []todoItem{
				{ID: "one", Title: "A", Status: "in_progress"},
				{ID: "two", Title: "B", Status: "in_progress"},
			},
		},
		{name: "unknown status", todos: []todoItem{{ID: "one", Title: "A", Status: "blocked"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateTodos(test.todos); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestTodoToolLifecycleIsNotAddedToChat(t *testing.T) {
	host := New()
	chat := ahptypes.URI("ahp-chat:/todo-test")
	var notification []byte
	host.directPeer.subscriptions[string(chat)] = struct{}{}
	host.directPeer.emit = func(payload []byte) { notification = append([]byte(nil), payload...) }

	host.emitToolStarted(chat, "turn-one", agentsdk.Event{
		Type: "tool.execution_start",
		Data: map[string]any{
			"toolCallId": "todo-call",
			"toolName":   "zaw_update_todos",
		},
	})
	host.emitToolCompleted(chat, "turn-one", agentsdk.Event{
		Type: "tool.execution_complete",
		Data: map[string]any{
			"toolCallId": "todo-call",
			"toolName":   "zaw_update_todos",
		},
	})

	if len(notification) != 0 {
		t.Fatalf("todo tool lifecycle leaked into chat: %s", notification)
	}
}
