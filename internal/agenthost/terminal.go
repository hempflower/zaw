package agenthost

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"

	"github.com/creack/pty"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

func (h *Host) createTerminal(
	peer *logicalPeer,
	request rpcRequest,
) ([]byte, []byte) {
	var params struct {
		Channel string                 `json:"channel"`
		Name    string                 `json:"name"`
		CWD     string                 `json:"cwd"`
		Cols    uint16                 `json:"cols"`
		Rows    uint16                 `json:"rows"`
		Claim   ahptypes.TerminalClaim `json:"claim"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil || params.Channel == "" {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"createTerminal requires channel",
		), nil
	}
	if params.Claim.Value == nil {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"createTerminal requires claim",
		), nil
	}
	if !validTerminalClaim(peer, params.Claim) {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodePermissionDenied,
			"terminal claim does not belong to this logical peer",
		), nil
	}
	if !strings.HasPrefix(params.Channel, "ahp-terminal:/") {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, "invalid terminal channel"), nil
	}
	if params.Name == "" {
		params.Name = "shell"
	}
	if params.Cols == 0 {
		params.Cols = 80
	}
	if params.Rows == 0 {
		params.Rows = 24
	}
	directory := terminalDirectory(params.CWD)
	command := exec.Command(terminalShell())
	command.Dir = directory
	file, err := pty.StartWithSize(command, &pty.Winsize{
		Cols: params.Cols,
		Rows: params.Rows,
	})
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInternalError, "could not start terminal"), nil
	}
	entry := &terminal{
		resource: params.Channel,
		title:    params.Name,
		pty:      file,
		command:  command,
		state: ahptypes.TerminalState{
			Title:   params.Name,
			Cwd:     terminalCWD(params.CWD),
			Cols:    int64Pointer(int64(params.Cols)),
			Rows:    int64Pointer(int64(params.Rows)),
			Content: []ahptypes.TerminalContentPart{},
			Claim:   params.Claim,
		},
	}
	h.mu.Lock()
	if _, exists := h.terminals[entry.resource]; exists {
		h.mu.Unlock()
		_ = file.Close()
		_ = command.Process.Kill()
		return rpcError(request.ID, ahptypes.ErrorCodeAlreadyExists, "terminal already exists"), nil
	}
	h.terminals[entry.resource] = entry
	h.mu.Unlock()
	go h.readTerminal(entry)
	go h.waitForTerminal(entry)
	h.emitRootTerminalsChanged()
	h.mu.Lock()
	snapshot, _ := h.snapshotLocked(ahptypes.URI(entry.resource))
	h.mu.Unlock()
	return rpcResult(request.ID, ahptypes.SubscribeResult{Snapshot: &snapshot}), nil
}

func (h *Host) disposeTerminal(
	peer *logicalPeer,
	request rpcRequest,
) ([]byte, []byte) {
	var params struct {
		Channel string `json:"channel"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil || params.Channel == "" {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"disposeTerminal requires channel",
		), nil
	}
	entry := h.terminalForChannel(params.Channel)
	if entry == nil {
		return rpcError(request.ID, ahptypes.ErrorCodeNotFound, "terminal not found"), nil
	}
	if !h.peerOwnsTerminal(peer, entry) {
		return rpcError(request.ID, ahptypes.ErrorCodePermissionDenied, "terminal is claimed"), nil
	}
	entry = h.removeTerminal(params.Channel)
	_ = entry.pty.Close()
	_ = entry.command.Process.Kill()
	h.emitRootTerminalsChanged()
	return rpcResult(request.ID, map[string]any{}), nil
}

func (h *Host) dispatchAction(peer *logicalPeer, payload json.RawMessage) {
	var official ahptypes.DispatchActionParams
	if json.Unmarshal(payload, &official) == nil && official.Action.Value != nil {
		if h.dispatchTypedAction(peer, official) {
			return
		}
	}
	var params struct {
		Channel string `json:"channel"`
		Action  struct {
			Type      string `json:"type"`
			Data      string `json:"data"`
			Cols      uint16 `json:"cols"`
			Rows      uint16 `json:"rows"`
			RequestID string `json:"requestId"`
			Decision  string `json:"decision"`
			OptionID  string `json:"optionId"`
			Canceled  bool   `json:"canceled"`
		} `json:"action"`
	}
	if json.Unmarshal(payload, &params) != nil {
		return
	}
	h.mu.Lock()
	entry := h.terminals[params.Channel]
	h.mu.Unlock()
	if entry == nil || !h.peerOwnsTerminal(peer, entry) {
		return
	}
	switch params.Action.Type {
	case "terminal/input":
		entry.mu.Lock()
		_, _ = entry.pty.Write([]byte(params.Action.Data))
		entry.mu.Unlock()
	case "terminal/resized":
		if params.Action.Cols == 0 || params.Action.Rows == 0 {
			return
		}
		entry.mu.Lock()
		_ = pty.Setsize(entry.pty, &pty.Winsize{
			Cols: params.Action.Cols,
			Rows: params.Action.Rows,
		})
		entry.mu.Unlock()
	}
}

func (h *Host) dispatchTypedAction(
	peer *logicalPeer,
	params ahptypes.DispatchActionParams,
) bool {
	switch action := params.Action.Value.(type) {
	case *ahptypes.SessionTitleChangedAction:
		if h.hasSession(params.Channel) {
			h.emitTypedAction(params.Channel, params.Action, nil)
			h.emitSessionSummaryChanged(params.Channel)
		}
		return true
	case *ahptypes.ChatTurnStartedAction:
		if action.Message.Origin.Kind != ahptypes.MessageKindUser {
			return true
		}
		entry, ok := h.sessionForChat(params.Channel)
		if !ok || entry.AgentSession == nil {
			return true
		}
		h.startChatTurn(entry, *action, &ahptypes.ActionOrigin{
			ClientId:  peer.clientID,
			ClientSeq: params.ClientSeq,
		})
		return true
	case *ahptypes.ChatTurnCancelledAction:
		entry, ok := h.sessionForChat(params.Channel)
		if ok && entry.AgentSession != nil {
			_ = entry.AgentSession.Cancel(context.Background())
			h.cancelPermissions(entry.Resource)
			h.emitChatAction(params.Channel, params.Action, nil)
		}
		return true
	case *ahptypes.ChatDraftChangedAction:
		if _, ok := h.sessionForChat(params.Channel); ok {
			h.emitChatAction(params.Channel, params.Action, &ahptypes.ActionOrigin{
				ClientId:  peer.clientID,
				ClientSeq: params.ClientSeq,
			})
		}
		return true
	case *ahptypes.ChatToolCallConfirmedAction:
		h.resolveToolPermission(peer, params.Channel, *action, params.ClientSeq)
		return true
	case *ahptypes.ChangesetFilesReviewChangedAction:
		if params.Channel == workingTreeChangesetResource {
			h.emitTypedAction(params.Channel, params.Action, &ahptypes.ActionOrigin{
				ClientId:  peer.clientID,
				ClientSeq: params.ClientSeq,
			})
		}
		return true
	case *ahptypes.TerminalInputAction:
		if entry := h.terminalForChannel(params.Channel); h.peerOwnsTerminal(peer, entry) {
			entry.mu.Lock()
			_, _ = entry.pty.Write([]byte(action.Data))
			entry.mu.Unlock()
		}
		return true
	case *ahptypes.TerminalResizedAction:
		if action.Cols <= 0 || action.Rows <= 0 {
			return true
		}
		if entry := h.terminalForChannel(params.Channel); h.peerOwnsTerminal(peer, entry) {
			entry.mu.Lock()
			_ = pty.Setsize(entry.pty, &pty.Winsize{
				Cols: uint16(action.Cols),
				Rows: uint16(action.Rows),
			})
			entry.mu.Unlock()
			h.emitTypedAction(params.Channel, params.Action, nil)
		}
		return true
	case *ahptypes.TerminalClaimedAction:
		entry := h.terminalForChannel(params.Channel)
		if !h.peerOwnsTerminal(peer, entry) ||
			!validTerminalClaim(peer, action.Claim) {
			return true
		}
		h.emitTypedAction(params.Channel, params.Action, &ahptypes.ActionOrigin{
			ClientId:  peer.clientID,
			ClientSeq: params.ClientSeq,
		})
		h.emitRootTerminalsChanged()
		return true
	}
	return false
}

func (h *Host) hasSession(resource ahptypes.URI) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.sessions[string(resource)]
	return ok
}

func (h *Host) sessionForChat(resource ahptypes.URI) (session, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, entry := range h.sessions {
		if entry.Chat.Resource == resource {
			return entry, true
		}
	}
	return session{}, false
}

func (h *Host) terminalForChannel(resource ahptypes.URI) *terminal {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.terminals[string(resource)]
}

func validTerminalClaim(peer *logicalPeer, claim ahptypes.TerminalClaim) bool {
	switch value := claim.Value.(type) {
	case *ahptypes.TerminalClientClaim:
		return peer.clientID != "" && value.ClientId == peer.clientID
	case *ahptypes.TerminalSessionClaim:
		return value.Session != ""
	default:
		return false
	}
}

func (h *Host) peerOwnsTerminal(peer *logicalPeer, entry *terminal) bool {
	if entry == nil {
		return false
	}
	switch value := entry.state.Claim.Value.(type) {
	case *ahptypes.TerminalClientClaim:
		return value.ClientId == peer.clientID
	case *ahptypes.TerminalSessionClaim:
		h.mu.Lock()
		defer h.mu.Unlock()
		_, subscribed := peer.subscriptions[string(value.Session)]
		return subscribed
	default:
		return false
	}
}

func (h *Host) resolveToolPermission(
	peer *logicalPeer,
	chat ahptypes.URI,
	action ahptypes.ChatToolCallConfirmedAction,
	clientSeq int64,
) {
	h.mu.Lock()
	var permission pendingPermission
	permissionID := ""
	for key, candidate := range h.permissions {
		if candidate.chat == chat && candidate.turnID == action.TurnId &&
			candidate.toolCallID == action.ToolCallId {
			permission = candidate
			permissionID = key
			break
		}
	}
	_, subscribed := peer.subscriptions[string(chat)]
	if permissionID != "" && subscribed {
		delete(h.permissions, permissionID)
	}
	h.mu.Unlock()
	if permissionID == "" || !subscribed {
		return
	}
	h.emitChatAction(chat, ahptypes.StateAction{Value: &action}, &ahptypes.ActionOrigin{
		ClientId:  peer.clientID,
		ClientSeq: clientSeq,
	})
	h.emitTypedAction(permission.resource, ahptypes.StateAction{
		Value: &ahptypes.SessionInputNeededRemovedAction{
			Type: ahptypes.ActionTypeSessionInputNeededRemoved,
			Id:   permission.inputID,
		},
	}, nil)
	h.emitSessionSummaryChanged(permission.resource)
	decision := agentsdk.PermissionDeny
	if action.Approved {
		decision = agentsdk.PermissionAllowOnce
	}
	permission.response <- decision
}

func (h *Host) readTerminal(entry *terminal) {
	buffer := make([]byte, 4096)
	for {
		count, err := entry.pty.Read(buffer)
		if count > 0 {
			h.emitTypedAction(ahptypes.URI(entry.resource), ahptypes.StateAction{
				Value: &ahptypes.TerminalDataAction{
					Type: ahptypes.ActionTypeTerminalData,
					Data: string(buffer[:count]),
				},
			}, nil)
		}
		if err != nil {
			return
		}
	}
}

func (h *Host) waitForTerminal(entry *terminal) {
	err := entry.command.Wait()
	exitCode := 0
	if err != nil {
		if processError, ok := err.(*exec.ExitError); ok {
			exitCode = processError.ExitCode()
		} else {
			exitCode = -1
		}
	}
	h.emitTypedAction(ahptypes.URI(entry.resource), ahptypes.StateAction{
		Value: &ahptypes.TerminalExitedAction{
			Type:     ahptypes.ActionTypeTerminalExited,
			ExitCode: int64Pointer(int64(exitCode)),
		},
	}, nil)
}

func (h *Host) removeTerminal(resource string) *terminal {
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.terminals[resource]
	delete(h.terminals, resource)
	return entry
}

func (h *Host) terminalSummaries() []ahptypes.TerminalInfo {
	items := make([]ahptypes.TerminalInfo, 0, len(h.terminals))
	for _, entry := range h.terminals {
		items = append(items, ahptypes.TerminalInfo{
			Resource: ahptypes.URI(entry.resource),
			Title:    entry.title,
			Claim:    entry.state.Claim,
			ExitCode: entry.state.ExitCode,
		})
	}
	return items
}

func (h *Host) emitRootTerminalsChanged() {
	h.mu.Lock()
	items := h.terminalSummaries()
	h.mu.Unlock()
	h.emitTypedAction(ahptypes.RootResourceURI, ahptypes.StateAction{
		Value: &ahptypes.RootTerminalsChangedAction{
			Type:      ahptypes.ActionTypeRootTerminalsChanged,
			Terminals: items,
		},
	}, nil)
}

func (h *Host) emitAction(channel string, action any) {
	h.mu.Lock()
	h.sequence++
	sequence := h.sequence
	emitters := h.subscribedEmittersLocked(ahptypes.URI(channel))
	h.mu.Unlock()
	if len(emitters) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "action",
		"params": map[string]any{
			"channel":   channel,
			"action":    action,
			"serverSeq": sequence,
		},
	})
	for _, emit := range emitters {
		emit(payload)
	}
}

func (h *Host) setEmitter(emit func([]byte)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.directPeer.emit = emit
}

func terminalShell() string {
	if shell := os.Getenv("ZAW_TERMINAL_SHELL"); shell != "" {
		return shell
	}
	return "/bin/sh"
}

func terminalDirectory(cwd string) string {
	if cwd == "" {
		return "."
	}
	if strings.HasPrefix(cwd, "file://") {
		return strings.TrimPrefix(cwd, "file://")
	}
	return cwd
}

func terminalCWD(cwd string) *ahptypes.URI {
	if cwd == "" {
		return nil
	}
	return uriPointer(ahptypes.URI(cwd))
}

func int64Pointer(value int64) *int64 {
	return &value
}
