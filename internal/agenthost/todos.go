package agenthost

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

const zawTodosMetaKey = "zaw_todos"

const todoInstructions = "For multi-step work, maintain the user-visible session plan with the " +
	"zaw_update_todos tool. It is the authoritative todo state for this host: do not use private " +
	"or internal todo storage as a substitute. Send the complete current list on every update, " +
	"set at most one item to in_progress, and update an item's status as work progresses."

type todoItem struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type todoState struct {
	Version int        `json:"version"`
	Items   []todoItem `json:"items"`
}

type updateTodosInput struct {
	Todos []todoItem `json:"todos"`
}

func (h *Host) todoTool(resource ahptypes.URI) agentsdk.Tool {
	return agentsdk.Tool{
		Name: "zaw_update_todos",
		Description: "Update the complete todo list for the current session. Use it for multi-step " +
			"work. Include every existing and new item, keep at most one item in_progress, mark work " +
			"in_progress before starting, and completed immediately after finishing.",
		SkipPermission: true,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"todos": map[string]any{
					"type":        "array",
					"description": "Complete replacement todo list.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"id":    map[string]any{"type": "string"},
							"title": map[string]any{"type": "string"},
							"status": map[string]any{
								"type": "string",
								"enum": []string{"pending", "in_progress", "completed"},
							},
						},
						"required":             []string{"id", "title", "status"},
						"additionalProperties": false,
					},
				},
			},
			"required":             []string{"todos"},
			"additionalProperties": false,
		},
		Handler: func(_ context.Context, arguments any) (string, error) {
			input, err := decodeTodos(arguments)
			if err != nil {
				return "", err
			}
			if err := validateTodos(input.Todos); err != nil {
				return "", err
			}
			state, err := json.Marshal(todoState{Version: 1, Items: input.Todos})
			if err != nil {
				return "", err
			}
			if err := h.updateSessionMeta(resource, func(meta map[string]json.RawMessage) error {
				meta[zawTodosMetaKey] = state
				return nil
			}); err != nil {
				return "", err
			}
			return fmt.Sprintf("Updated %d todos.", len(input.Todos)), nil
		},
	}
}

func decodeTodos(arguments any) (updateTodosInput, error) {
	var input updateTodosInput
	payload, err := json.Marshal(arguments)
	if err != nil {
		return input, fmt.Errorf("encode todo input: %w", err)
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return input, fmt.Errorf("invalid todo input: %w", err)
	}
	return input, nil
}

func validateTodos(todos []todoItem) error {
	seen := make(map[string]struct{}, len(todos))
	inProgress := 0
	for _, todo := range todos {
		if strings.TrimSpace(todo.ID) == "" {
			return fmt.Errorf("todo id is required")
		}
		if _, exists := seen[todo.ID]; exists {
			return fmt.Errorf("duplicate todo id %q", todo.ID)
		}
		seen[todo.ID] = struct{}{}
		if strings.TrimSpace(todo.Title) == "" {
			return fmt.Errorf("todo %q title is required", todo.ID)
		}
		switch todo.Status {
		case "pending", "completed":
		case "in_progress":
			inProgress++
		default:
			return fmt.Errorf("todo %q has invalid status %q", todo.ID, todo.Status)
		}
	}
	if inProgress > 1 {
		return fmt.Errorf("only one todo can be in_progress")
	}
	return nil
}
