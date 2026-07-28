package agenthost

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/microsoft/agent-host-protocol/clients/go/ahp"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

const workingTreeChangesetResource ahptypes.URI = "ahp-changeset:/working-tree"

func uriPointer(value ahptypes.URI) *ahptypes.URI {
	return &value
}

func defaultChatResource(resource ahptypes.URI) ahptypes.URI {
	id := strings.TrimPrefix(string(resource), "ahp-session:/")
	return ahptypes.URI("ahp-chat:/" + id)
}

func workingTreeChangeset() ahptypes.Changeset {
	return ahptypes.Changeset{
		Label:       "Working Tree",
		UriTemplate: string(workingTreeChangesetResource),
		ChangeKind:  "uncommitted",
		Capabilities: &ahptypes.ChangesetCapabilities{
			Review: map[string]json.RawMessage{},
		},
	}
}

func stringOrMarkdownPointer(value string) *ahptypes.StringOrMarkdown {
	result := ahptypes.NewStringOrMarkdownPlain(value)
	return &result
}

func (s session) summary() ahptypes.SessionSummary {
	return ahptypes.SessionSummary{
		Provider:         s.State.Provider,
		Title:            s.State.Title,
		Status:           s.State.Status,
		Activity:         s.State.Activity,
		WorkingDirectory: s.State.WorkingDirectory,
		Resource:         s.Resource,
		CreatedAt:        s.CreatedAt,
		ModifiedAt:       s.ModifiedAt,
	}
}

func (h *Host) subscribe(peer *logicalPeer, request rpcRequest) []byte {
	var params ahptypes.SubscribeParams
	if err := json.Unmarshal(request.Params, &params); err != nil || params.Channel == "" {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, "invalid subscribe parameters")
	}
	if params.Channel == workingTreeChangesetResource {
		h.refreshWorkingTreeChangeset()
	}
	h.mu.Lock()
	snapshot, err := h.snapshotLocked(params.Channel)
	if err == nil {
		peer.subscriptions[string(params.Channel)] = struct{}{}
	}
	h.mu.Unlock()
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeNotFound, err.Error())
	}
	return rpcResult(request.ID, ahptypes.SubscribeResult{Snapshot: &snapshot})
}

func (h *Host) reconnect(peer *logicalPeer, request rpcRequest) []byte {
	var params ahptypes.ReconnectParams
	if err := json.Unmarshal(request.Params, &params); err != nil ||
		params.Channel != ahptypes.RootResourceURI || params.ClientId == "" {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, "invalid reconnect parameters")
	}
	h.mu.Lock()
	snapshots, err := h.snapshotsLocked(params.Subscriptions)
	if err == nil {
		peer.clientID = params.ClientId
		peer.subscriptions = make(map[string]struct{}, len(params.Subscriptions))
		for _, resource := range params.Subscriptions {
			peer.subscriptions[string(resource)] = struct{}{}
		}
	}
	h.mu.Unlock()
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeNotFound, err.Error())
	}
	return rpcResult(request.ID, map[string]any{
		"type":      "snapshot",
		"snapshots": snapshots,
	})
}

func (h *Host) unsubscribe(peer *logicalPeer, payload json.RawMessage) {
	var params ahptypes.UnsubscribeParams
	if json.Unmarshal(payload, &params) != nil {
		return
	}
	h.mu.Lock()
	delete(peer.subscriptions, string(params.Channel))
	h.mu.Unlock()
}

func (h *Host) snapshotsLocked(resources []ahptypes.URI) ([]ahptypes.Snapshot, error) {
	snapshots := make([]ahptypes.Snapshot, 0, len(resources))
	for _, resource := range resources {
		snapshot, err := h.snapshotLocked(resource)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func (h *Host) snapshotLocked(resource ahptypes.URI) (ahptypes.Snapshot, error) {
	snapshot := ahptypes.Snapshot{Resource: resource, FromSeq: h.sequence}
	switch resource {
	case ahptypes.RootResourceURI:
		activeSessions := int64(len(h.sessions))
		snapshot.State.Root = &ahptypes.RootState{
			Agents: []ahptypes.AgentInfo{{
				Provider:    "copilot",
				DisplayName: "GitHub Copilot",
				Description: "GitHub Copilot Agent SDK",
				Models:      []ahptypes.SessionModelInfo{},
			}},
			ActiveSessions: &activeSessions,
			Terminals:      h.terminalSummaries(),
		}
		return snapshot, nil
	case workingTreeChangesetResource:
		state := h.changeset
		snapshot.State.Changeset = &state
		return snapshot, nil
	}
	if entry, ok := h.sessions[string(resource)]; ok {
		state := entry.State
		snapshot.State.Session = &state
		return snapshot, nil
	}
	for _, entry := range h.sessions {
		if entry.Chat.Resource == resource {
			state := entry.Chat
			snapshot.State.Chat = &state
			return snapshot, nil
		}
	}
	if entry, ok := h.terminals[string(resource)]; ok {
		state := entry.state
		snapshot.State.Terminal = &state
		return snapshot, nil
	}
	return ahptypes.Snapshot{}, fmt.Errorf("channel %q was not found", resource)
}

func (h *Host) emitTypedAction(
	channel ahptypes.URI,
	action ahptypes.StateAction,
	origin *ahptypes.ActionOrigin,
) {
	h.mu.Lock()
	h.applyActionLocked(channel, action)
	h.sequence++
	envelope := ahptypes.ActionEnvelope{
		Channel:   channel,
		Action:    action,
		ServerSeq: h.sequence,
		Origin:    origin,
	}
	emitters := h.subscribedEmittersLocked(channel)
	h.mu.Unlock()
	payload, err := json.Marshal(ahptypes.JsonRpcNotification{
		JsonRpc: ahptypes.JsonRpcV2,
		Method:  "action",
		Params:  marshalRaw(envelope),
	})
	if err != nil {
		return
	}
	for _, emit := range emitters {
		emit(payload)
	}
}

func (h *Host) subscribedEmittersLocked(channel ahptypes.URI) []func([]byte) {
	emitters := make([]func([]byte), 0, len(h.peers))
	for _, peer := range h.peers {
		if peer.emit == nil {
			continue
		}
		if _, subscribed := peer.subscriptions[string(channel)]; subscribed {
			emitters = append(emitters, peer.emit)
		}
	}
	return emitters
}

func (h *Host) applyActionLocked(channel ahptypes.URI, action ahptypes.StateAction) {
	if channel == ahptypes.RootResourceURI {
		return
	}
	if channel == workingTreeChangesetResource {
		ahp.ApplyActionToChangeset(&h.changeset, action)
		return
	}
	if terminal := h.terminals[string(channel)]; terminal != nil {
		ahp.ApplyActionToTerminal(&terminal.state, action)
		return
	}
	for key, entry := range h.sessions {
		switch channel {
		case entry.Resource:
			ahp.ApplyActionToSession(&entry.State, action)
			entry.ModifiedAt = time.Now().UTC().Format(time.RFC3339Nano)
			h.sessions[key] = entry
			return
		case entry.Chat.Resource:
			ahp.ApplyActionToChat(&entry.Chat, action)
			entry.ModifiedAt = entry.Chat.ModifiedAt
			entry.State.Status = entry.Chat.Status
			entry.State.Chats[0] = chatSummary(entry.Chat)
			h.sessions[key] = entry
			return
		}
	}
}

func chatSummary(state ahptypes.ChatState) ahptypes.ChatSummary {
	return ahptypes.ChatSummary{
		Resource:         state.Resource,
		Title:            state.Title,
		Status:           state.Status,
		Activity:         state.Activity,
		ModifiedAt:       state.ModifiedAt,
		Origin:           state.Origin,
		Interactivity:    state.Interactivity,
		WorkingDirectory: state.WorkingDirectory,
	}
}

func (h *Host) startChatTurn(
	entry session,
	action ahptypes.ChatTurnStartedAction,
	origin *ahptypes.ActionOrigin,
) {
	h.emitChatAction(entry.Chat.Resource, ahptypes.StateAction{Value: &action}, origin)
	request := promptRequest(action.Message)
	h.mu.Lock()
	current := h.sessions[string(entry.Resource)]
	current.ApprovalMode = request.ApprovalMode
	h.sessions[string(entry.Resource)] = current
	h.mu.Unlock()
	go func() {
		if err := entry.AgentSession.Prompt(context.Background(), request); err != nil {
			h.emitChatAction(entry.Chat.Resource, ahptypes.StateAction{
				Value: &ahptypes.ChatErrorAction{
					Type:   ahptypes.ActionTypeChatError,
					TurnId: action.TurnId,
					Error:  ahptypes.ErrorInfo{Message: "Agent SDK prompt failed"},
				},
			}, nil)
		}
	}()
}

func promptRequest(message ahptypes.Message) agentsdk.PromptRequest {
	request := agentsdk.PromptRequest{Text: message.Text}
	if message.Model != nil {
		request.Model = message.Model.Id
	}
	if raw, ok := message.Meta["zaw/reasoningEffort"]; ok {
		_ = json.Unmarshal(raw, &request.ReasoningEffort)
	}
	if raw, ok := message.Meta["zaw/approvalMode"]; ok {
		_ = json.Unmarshal(raw, &request.ApprovalMode)
	}
	if raw, ok := message.Meta["zaw/agentMode"]; ok {
		_ = json.Unmarshal(raw, &request.AgentMode)
	}
	if request.AgentMode == "plan" {
		// Plan is an explicit SDK mode and takes precedence over approval policy.
	} else if request.ApprovalMode == "autopilot" {
		request.AgentMode = "autopilot"
	} else {
		request.AgentMode = "interactive"
	}
	for _, attachment := range message.Attachments {
		value, ok := attachment.Value.(*ahptypes.MessageEmbeddedResourceAttachment)
		if !ok {
			continue
		}
		request.Attachments = append(request.Attachments, agentsdk.Attachment{
			Label:       value.Label,
			Data:        value.Data,
			ContentType: value.ContentType,
		})
	}
	return request
}

func (h *Host) emitStandardAgentEvent(chat ahptypes.URI, event agentsdk.Event) {
	turnID, hasMarkdown := h.activeTurn(chat)
	if turnID == "" {
		return
	}
	switch event.Type {
	case "agent_message_chunk", "assistant.message_delta":
		content := agentEventText(event.Data)
		if content == "" {
			return
		}
		const partID = "assistant-text"
		if !hasMarkdown {
			h.emitChatAction(chat, ahptypes.StateAction{
				Value: &ahptypes.ChatResponsePartAction{
					Type:   ahptypes.ActionTypeChatResponsePart,
					TurnId: turnID,
					Part: ahptypes.ResponsePart{Value: &ahptypes.MarkdownResponsePart{
						Kind:    ahptypes.ResponsePartKindMarkdown,
						Id:      partID,
						Content: "",
					}},
				},
			}, nil)
		}
		h.emitChatAction(chat, ahptypes.StateAction{Value: &ahptypes.ChatDeltaAction{
			Type:    ahptypes.ActionTypeChatDelta,
			TurnId:  turnID,
			PartId:  partID,
			Content: content,
		}}, nil)
	case "session.idle":
		h.emitChatAction(chat, ahptypes.StateAction{Value: &ahptypes.ChatTurnCompleteAction{
			Type:     ahptypes.ActionTypeChatTurnComplete,
			TurnId:   turnID,
			Duration: 0,
		}}, nil)
	case "session.error":
		h.emitChatAction(chat, ahptypes.StateAction{Value: &ahptypes.ChatErrorAction{
			Type:     ahptypes.ActionTypeChatError,
			TurnId:   turnID,
			Duration: 0,
			Error:    ahptypes.ErrorInfo{Message: agentEventText(event.Data)},
		}}, nil)
	case "tool.execution_start", "tool_call":
		h.emitToolStarted(chat, turnID, event)
	case "tool.execution_complete":
		h.emitToolCompleted(chat, turnID, event)
	}
}

func (h *Host) emitPermissionRequest(
	pending pendingPermission,
	request agentsdk.PermissionRequest,
) {
	rawInput := strings.TrimSpace(string(request.Data))
	detail := permissionRequestDetail(request)
	title := strings.TrimSpace(request.Kind)
	if title == "" {
		title = "Agent tool"
	}
	invocation := ahptypes.NewStringOrMarkdownPlain(detail)
	confirmationTitle := ahptypes.NewStringOrMarkdownPlain("Allow " + title)
	permissionMeta := map[string]json.RawMessage{
		"zaw/permissionRequest": json.RawMessage("true"),
	}
	h.emitChatAction(pending.chat, ahptypes.StateAction{
		Value: &ahptypes.ChatToolCallStartAction{
			Type:        ahptypes.ActionTypeChatToolCallStart,
			TurnId:      pending.turnID,
			ToolCallId:  pending.toolCallID,
			ToolName:    title,
			DisplayName: title,
			Meta:        permissionMeta,
		},
	}, nil)
	h.emitChatAction(pending.chat, ahptypes.StateAction{
		Value: &ahptypes.ChatToolCallReadyAction{
			Type:              ahptypes.ActionTypeChatToolCallReady,
			TurnId:            pending.turnID,
			ToolCallId:        pending.toolCallID,
			InvocationMessage: invocation,
			ToolInput:         stringPointer(rawInput),
			ConfirmationTitle: &confirmationTitle,
			Meta:              permissionMeta,
		},
	}, nil)
	toolCall := ahptypes.ToolCallPendingConfirmationState{
		ToolCallId:        pending.toolCallID,
		ToolName:          title,
		DisplayName:       title,
		Meta:              permissionMeta,
		InvocationMessage: invocation,
		ToolInput:         stringPointer(rawInput),
		Status:            ahptypes.ToolCallStatusPendingConfirmation,
		ConfirmationTitle: &confirmationTitle,
	}
	h.emitTypedAction(pending.resource, ahptypes.StateAction{
		Value: &ahptypes.SessionInputNeededSetAction{
			Type: ahptypes.ActionTypeSessionInputNeededSet,
			Request: ahptypes.SessionInputRequest{
				Value: &ahptypes.SessionToolConfirmationRequest{
					Id:     pending.inputID,
					Chat:   pending.chat,
					Kind:   ahptypes.SessionInputRequestKindToolConfirmation,
					TurnId: pending.turnID,
					ToolCall: ahptypes.ToolCallConfirmationState{
						Value: &toolCall,
					},
				},
			},
		},
	}, nil)
	h.emitSessionSummaryChanged(pending.resource)
}

func permissionRequestDetail(request agentsdk.PermissionRequest) string {
	data := map[string]any{}
	if json.Unmarshal(request.Data, &data) == nil {
		command := agentEventString(data, "fullCommandText", "command")
		if command == "" {
			if commands, ok := data["commands"].([]any); ok {
				for _, candidate := range commands {
					command = agentEventString(agentEventMap(candidate), "identifier")
					if command != "" {
						break
					}
				}
			}
		}
		intention := agentEventString(data, "intention", "description")
		lines := make([]string, 0, 2)
		if command != "" {
			lines = append(lines, "$ "+command)
		}
		if intention != "" && intention != command {
			lines = append(lines, intention)
		}
		if len(lines) > 0 {
			return strings.Join(lines, "\n")
		}
	}
	kind := strings.TrimSpace(request.Kind)
	if kind == "" {
		kind = "This action"
	}
	return kind + " requires approval."
}

func (h *Host) emitToolStarted(
	chat ahptypes.URI,
	turnID string,
	event agentsdk.Event,
) {
	data := agentEventMap(event.Data)
	toolCallID := agentEventString(data, "toolCallId", "id")
	if toolCallID == "" || h.hasToolCall(chat, toolCallID) {
		return
	}
	toolName := agentEventString(data, "toolName", "name", "title")
	if toolName == "" {
		toolName = "Agent tool"
	}
	h.emitChatAction(chat, ahptypes.StateAction{
		Value: &ahptypes.ChatToolCallStartAction{
			Type:        ahptypes.ActionTypeChatToolCallStart,
			TurnId:      turnID,
			ToolCallId:  toolCallID,
			ToolName:    toolName,
			DisplayName: toolName,
		},
	}, nil)
	input := agentEventJSON(data["arguments"])
	if input == "" {
		input = agentEventString(data, "input")
	}
	confirmed := ahptypes.ToolCallConfirmationReasonNotNeeded
	h.emitChatAction(chat, ahptypes.StateAction{
		Value: &ahptypes.ChatToolCallReadyAction{
			Type:              ahptypes.ActionTypeChatToolCallReady,
			TurnId:            turnID,
			ToolCallId:        toolCallID,
			InvocationMessage: ahptypes.NewStringOrMarkdownPlain("Running " + toolName),
			ToolInput:         stringPointer(input),
			Confirmed:         &confirmed,
		},
	}, nil)
	if event.Type == "tool_call" && agentEventString(data, "status") == "completed" {
		h.completeToolCall(chat, turnID, toolCallID, toolName, data)
	}
}

func (h *Host) emitToolCompleted(
	chat ahptypes.URI,
	turnID string,
	event agentsdk.Event,
) {
	data := agentEventMap(event.Data)
	toolCallID := agentEventString(data, "toolCallId", "id")
	if toolCallID == "" {
		return
	}
	toolName := agentEventString(data, "toolName", "name", "title")
	if toolName == "" {
		toolName = "Agent tool"
	}
	if !h.hasToolCall(chat, toolCallID) {
		h.emitToolStarted(chat, turnID, agentsdk.Event{
			Type: "tool.execution_start",
			Data: map[string]any{
				"toolCallId": toolCallID,
				"toolName":   toolName,
			},
		})
	}
	h.completeToolCall(chat, turnID, toolCallID, toolName, data)
}

func (h *Host) completeToolCall(
	chat ahptypes.URI,
	turnID string,
	toolCallID string,
	toolName string,
	data map[string]any,
) {
	success := true
	if value, ok := data["success"].(bool); ok {
		success = value
	}
	message := "Completed " + toolName
	if !success {
		message = "Failed " + toolName
	}
	result := agentEventResult(data["result"])
	errorDetail := agentEventError(data["error"])
	if !success && errorDetail == "" {
		errorDetail = agentEventError(data["result"])
	}
	if result == "" && errorDetail != "" {
		result = errorDetail
	}
	content := []ahptypes.ToolResultContent{}
	if result != "" {
		content = append(content, ahptypes.ToolResultContent{
			Value: &ahptypes.ToolResultTextContent{
				Type: ahptypes.ToolResultContentTypeText,
				Text: result,
			},
		})
	}
	toolResult := ahptypes.ToolCallResult{
		Success:          success,
		PastTenseMessage: ahptypes.NewStringOrMarkdownPlain(message),
		Content:          content,
	}
	if !success && errorDetail != "" {
		errorJSON, _ := json.Marshal(map[string]string{"message": errorDetail})
		rawError := json.RawMessage(errorJSON)
		toolResult.Error = &rawError
	}
	h.emitChatAction(chat, ahptypes.StateAction{
		Value: &ahptypes.ChatToolCallCompleteAction{
			Type:       ahptypes.ActionTypeChatToolCallComplete,
			TurnId:     turnID,
			ToolCallId: toolCallID,
			Result:     toolResult,
		},
	}, nil)
}

func agentEventError(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	data := agentEventMap(value)
	if message := agentEventString(data, "message", "error", "stderr", "output"); message != "" {
		return message
	}
	if cause := data["cause"]; cause != nil {
		return agentEventError(cause)
	}
	if nested := data["error"]; nested != nil {
		return agentEventError(nested)
	}
	return ""
}

func agentEventResult(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	data := agentEventMap(value)
	if text := agentEventString(data, "detailedContent", "content", "output"); text != "" {
		return text
	}
	return agentEventJSON(value)
}

func (h *Host) hasToolCall(chat ahptypes.URI, toolCallID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, entry := range h.sessions {
		if entry.Chat.Resource != chat || entry.Chat.ActiveTurn == nil {
			continue
		}
		for _, part := range entry.Chat.ActiveTurn.ResponseParts {
			tool, ok := part.Value.(*ahptypes.ToolCallResponsePart)
			if ok && toolCallStateID(tool.ToolCall) == toolCallID {
				return true
			}
		}
	}
	return false
}

func toolCallStateID(state ahptypes.ToolCallState) string {
	payload, err := json.Marshal(state)
	if err != nil {
		return ""
	}
	var value struct {
		ToolCallID string `json:"toolCallId"`
	}
	_ = json.Unmarshal(payload, &value)
	return value.ToolCallID
}

func agentEventMap(data any) map[string]any {
	if value, ok := data.(map[string]any); ok {
		return value
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return map[string]any{}
	}
	value := map[string]any{}
	_ = json.Unmarshal(payload, &value)
	return value
}

func agentEventString(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func agentEventJSON(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	payload, err := json.Marshal(value)
	if err != nil || string(payload) == "null" {
		return ""
	}
	return string(payload)
}

func stringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (h *Host) emitChatAction(
	chat ahptypes.URI,
	action ahptypes.StateAction,
	origin *ahptypes.ActionOrigin,
) {
	h.emitTypedAction(chat, action, origin)
	h.mu.Lock()
	var sessionResource ahptypes.URI
	var summary ahptypes.ChatSummary
	for _, entry := range h.sessions {
		if entry.Chat.Resource == chat {
			sessionResource = entry.Resource
			summary = chatSummary(entry.Chat)
			break
		}
	}
	h.mu.Unlock()
	if sessionResource == "" {
		return
	}
	h.emitTypedAction(sessionResource, ahptypes.StateAction{
		Value: &ahptypes.SessionChatUpdatedAction{
			Type: ahptypes.ActionTypeSessionChatUpdated,
			Chat: chat,
			Changes: ahptypes.PartialChatSummary{
				Title:            &summary.Title,
				Status:           &summary.Status,
				Activity:         summary.Activity,
				ModifiedAt:       &summary.ModifiedAt,
				WorkingDirectory: summary.WorkingDirectory,
			},
		},
	}, nil)
	h.emitSessionSummaryChanged(sessionResource)
}

func (h *Host) emitSessionSummaryChanged(resource ahptypes.URI) {
	h.mu.Lock()
	entry, exists := h.sessions[string(resource)]
	if !exists {
		h.mu.Unlock()
		return
	}
	h.sequence++
	status := entry.State.Status
	modifiedAt := entry.ModifiedAt
	title := entry.State.Title
	summary := entry.summary()
	changes := ahptypes.PartialSessionSummary{
		Title:            &title,
		Status:           &status,
		Activity:         entry.State.Activity,
		WorkingDirectory: entry.State.WorkingDirectory,
		ModifiedAt:       &modifiedAt,
		Changes:          summary.Changes,
	}
	emitters := h.subscribedEmittersLocked(ahptypes.RootResourceURI)
	h.mu.Unlock()
	payload, err := json.Marshal(ahptypes.JsonRpcNotification{
		JsonRpc: ahptypes.JsonRpcV2,
		Method:  "root/sessionSummaryChanged",
		Params: marshalRaw(ahptypes.SessionSummaryChangedParams{
			Channel: ahptypes.RootResourceURI,
			Session: resource,
			Changes: changes,
		}),
	})
	if err != nil {
		return
	}
	for _, emit := range emitters {
		emit(payload)
	}
}

func (h *Host) activeTurn(chat ahptypes.URI) (string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, entry := range h.sessions {
		if entry.Chat.Resource != chat || entry.Chat.ActiveTurn == nil {
			continue
		}
		hasMarkdown := false
		for _, part := range entry.Chat.ActiveTurn.ResponseParts {
			_, hasMarkdown = part.Value.(*ahptypes.MarkdownResponsePart)
			if hasMarkdown {
				break
			}
		}
		return entry.Chat.ActiveTurn.Id, hasMarkdown
	}
	return "", false
}

func agentEventText(data any) string {
	switch value := data.(type) {
	case string:
		return value
	case map[string]string:
		for _, key := range []string{"text", "content", "message", "deltaContent"} {
			if value[key] != "" {
				return value[key]
			}
		}
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return ""
	}
	var value map[string]json.RawMessage
	if json.Unmarshal(payload, &value) != nil {
		return ""
	}
	for _, key := range []string{"text", "content", "message", "deltaContent"} {
		var text string
		if json.Unmarshal(value[key], &text) == nil && text != "" {
			return text
		}
	}
	return "Agent SDK error"
}

func newUserTurn(text string) ahptypes.ChatTurnStartedAction {
	return ahptypes.ChatTurnStartedAction{
		Type:      ahptypes.ActionTypeChatTurnStarted,
		TurnId:    fmt.Sprintf("turn-%d", time.Now().UnixNano()),
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Message: ahptypes.Message{
			Text:   text,
			Origin: ahptypes.MessageOrigin{Kind: ahptypes.MessageKindUser},
		},
	}
}

func marshalRaw(value any) json.RawMessage {
	payload, _ := json.Marshal(value)
	return payload
}
