package agenthost

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"runtime/metrics"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
	copilotagent "github.com/zaw-dev/zaw/internal/agenthost/copilot"
)

const (
	hostHeartbeatInterval = 20 * time.Second
	agentSDKErrorCode     = -32000
)

type Config struct {
	ServerURL             string
	WorkspaceID           string
	WorkspaceDir          string
	RegistrationTokenFile string
	AgentProvider         string
	CopilotCLIPath        string
	AutoUpdate            bool
	UpdateInterval        time.Duration
}

type modelProfile struct {
	Model        string                     `json:"model"`
	Models       []copilotagent.ModelConfig `json:"models"`
	Capabilities struct {
		ImageInput             bool     `json:"imageInput"`
		Reasoning              bool     `json:"reasoning"`
		ReasoningEfforts       []string `json:"reasoningEfforts"`
		DefaultReasoningEffort string   `json:"defaultReasoningEffort"`
		ContextWindow          int      `json:"contextWindow"`
	} `json:"capabilities"`
}

type Host struct {
	mu          sync.Mutex
	sessions    map[string]session
	terminals   map[string]*terminal
	changeset   ahptypes.ChangesetState
	permissions map[string]pendingPermission
	peers       map[string]*logicalPeer
	directPeer  *logicalPeer
	sequence    int64
	agent       agentsdk.Runtime
	workDir     string
}

type logicalPeer struct {
	id            string
	clientID      string
	subscriptions map[string]struct{}
	emit          func([]byte)
}

type session struct {
	Resource     ahptypes.URI
	CreatedAt    string
	ModifiedAt   string
	State        ahptypes.SessionState
	Chat         ahptypes.ChatState
	AgentSession agentsdk.Session
	ApprovalMode string
}

type terminal struct {
	resource string
	title    string
	pty      *os.File
	command  *exec.Cmd
	state    ahptypes.TerminalState
	mu       sync.Mutex
}

type pendingPermission struct {
	resource   ahptypes.URI
	chat       ahptypes.URI
	turnID     string
	toolCallID string
	inputID    string
	response   chan agentsdk.PermissionDecision
}

type rpcRequest = ahptypes.JsonRpcRequest

func New() *Host {
	direct := newLogicalPeer("direct")
	return &Host{
		sessions:  make(map[string]session),
		terminals: make(map[string]*terminal),
		changeset: ahptypes.ChangesetState{
			Status: ahptypes.ChangesetStatusReady,
			Files:  []ahptypes.ChangesetFile{},
			Operations: []ahptypes.ChangesetOperation{
				{
					Id:    "stage",
					Label: "Stage change",
					Scopes: []ahptypes.ChangesetOperationScope{
						ahptypes.ChangesetOperationScopeResource,
					},
					Status: ahptypes.ChangesetOperationStatusIdle,
				},
				{
					Id:    "revert",
					Label: "Revert change",
					Scopes: []ahptypes.ChangesetOperationScope{
						ahptypes.ChangesetOperationScopeResource,
					},
					Confirmation: stringOrMarkdownPointer(
						"Revert this file to its checked-in state?",
					),
					Status: ahptypes.ChangesetOperationStatusIdle,
				},
			},
		},
		permissions: make(map[string]pendingPermission),
		peers:       map[string]*logicalPeer{direct.id: direct},
		directPeer:  direct,
	}
}

func newLogicalPeer(id string) *logicalPeer {
	return &logicalPeer{id: id, subscriptions: make(map[string]struct{})}
}

func NewWithAgent(agent agentsdk.Runtime, workingDirectory string) *Host {
	host := New()
	host.agent = agent
	host.workDir = workingDirectory
	return host
}

func Run(ctx context.Context, config Config) error {
	config, err := resolveConfig(config)
	if err != nil {
		return err
	}
	var runtime agentsdk.Runtime
	switch config.AgentProvider {
	case "copilot":
		profile, profileErr := fetchModelProfile(ctx, config)
		if profileErr != nil {
			return profileErr
		}
		token, tokenErr := registrationToken(config)
		if tokenErr != nil {
			return tokenErr
		}
		if token == "" {
			return fmt.Errorf("Agent Host registration credential is required for model access")
		}
		gatewayURL, gatewayErr := modelGatewayURL(config.ServerURL)
		if gatewayErr != nil {
			return gatewayErr
		}
		runtime, err = copilotagent.New(ctx, copilotagent.Config{
			CLIPath:          config.CopilotCLIPath,
			WorkingDirectory: config.WorkspaceDir,
			Model:            profile.Model,
			Models:           profile.Models,
			LLMBaseURL:       gatewayURL,
			LLMToken:         token,
			Vision:           profile.Capabilities.ImageInput,
			Reasoning:        profile.Capabilities.Reasoning,
			ReasoningEfforts: profile.Capabilities.ReasoningEfforts,
			ReasoningEffort:  profile.Capabilities.DefaultReasoningEffort,
			ContextWindow:    profile.Capabilities.ContextWindow,
		})
	default:
		return fmt.Errorf("unsupported Agent SDK provider %q", config.AgentProvider)
	}
	if err != nil {
		return err
	}
	defer runtime.Close()
	return RunWithRuntime(ctx, config, runtime)
}

func resolveConfig(config Config) (Config, error) {
	if config.ServerURL == "" {
		config.ServerURL = os.Getenv("ZAW_SERVER_URL")
	}
	if config.ServerURL == "" {
		config.ServerURL = "ws://127.0.0.1:8080"
	}
	if config.WorkspaceID == "" {
		config.WorkspaceID = os.Getenv("ZAW_WORKSPACE_ID")
	}
	if config.WorkspaceID == "" {
		return config, fmt.Errorf("agent host requires --workspace-id or ZAW_WORKSPACE_ID")
	}
	if config.AgentProvider == "" {
		config.AgentProvider = os.Getenv("ZAW_AGENT_PROVIDER")
	}
	if config.AgentProvider == "" {
		config.AgentProvider = "copilot"
	}
	if config.WorkspaceDir == "" {
		config.WorkspaceDir = os.Getenv("ZAW_WORKSPACE_DIR")
	}
	if config.RegistrationTokenFile == "" {
		config.RegistrationTokenFile = os.Getenv("ZAW_AGENT_REGISTRATION_TOKEN_FILE")
	}
	if config.CopilotCLIPath == "" {
		config.CopilotCLIPath = os.Getenv("ZAW_COPILOT_CLI_PATH")
	}
	if !config.AutoUpdate {
		config.AutoUpdate, _ = strconv.ParseBool(os.Getenv("ZAW_AGENT_AUTO_UPDATE"))
	}
	if config.UpdateInterval <= 0 {
		if value := os.Getenv("ZAW_AGENT_UPDATE_INTERVAL"); value != "" {
			config.UpdateInterval, _ = time.ParseDuration(value)
		}
	}
	if config.WorkspaceDir == "" {
		config.WorkspaceDir, _ = os.Getwd()
	}
	return config, nil
}

func fetchModelProfile(ctx context.Context, config Config) (modelProfile, error) {
	var profile modelProfile
	endpoint, err := agentHostModelEndpoint(config.ServerURL, config.WorkspaceID)
	if err != nil {
		return profile, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return profile, err
	}
	token, err := registrationToken(config)
	if err != nil {
		return profile, err
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		return profile, fmt.Errorf("load Workspace model configuration: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return profile, fmt.Errorf(
			"load Workspace model configuration: Server returned HTTP %d",
			response.StatusCode,
		)
	}
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		return profile, fmt.Errorf("decode Workspace model configuration: %w", err)
	}
	if profile.Model == "" {
		return profile, fmt.Errorf("Workspace model configuration is empty")
	}
	return profile, nil
}

func RunWithRuntime(ctx context.Context, config Config, runtime agentsdk.Runtime) error {
	var err error
	config, err = resolveConfig(config)
	if err != nil {
		return err
	}
	host := NewWithAgent(runtime, config.WorkspaceDir)
	defer host.Close()
	runContext, cancel := context.WithCancel(ctx)
	defer cancel()
	updated := make(chan struct{})
	if config.AutoUpdate {
		go runAutoUpdater(runContext, config, func() {
			close(updated)
			cancel()
		})
	}
	go host.reportTelemetry(runContext, config)
	for {
		err := host.connectAndServe(runContext, config)
		select {
		case <-updated:
			return nil
		default:
		}
		if err != nil && runContext.Err() == nil {
			select {
			case <-runContext.Done():
				return nil
			case <-time.After(time.Second):
			}
			continue
		}
		return nil
	}
}

func (h *Host) reportTelemetry(ctx context.Context, config Config) {
	endpoint, err := agentHostTelemetryEndpoint(config.ServerURL, config.WorkspaceID)
	if err != nil {
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	lastCPUSeconds := 0.0
	lastMeasuredAt := time.Now()
	for {
		var memory runtime.MemStats
		runtime.ReadMemStats(&memory)
		now := time.Now()
		cpuSeconds := agentHostCPUSeconds()
		cpuPercent := 0.0
		if lastCPUSeconds > 0 {
			cpuPercent = (cpuSeconds - lastCPUSeconds) /
				now.Sub(lastMeasuredAt).Seconds() * 100
		}
		lastCPUSeconds = cpuSeconds
		lastMeasuredAt = now
		payload, _ := json.Marshal(map[string]any{
			"health":      "ok",
			"cpuPercent":  cpuPercent,
			"memoryBytes": memory.Alloc,
		})
		request, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			endpoint,
			bytes.NewReader(payload),
		)
		if err == nil {
			request.Header.Set("Content-Type", "application/json")
			if token, tokenErr := registrationToken(config); tokenErr == nil && token != "" {
				request.Header.Set("Authorization", "Bearer "+token)
			}
			response, err := client.Do(request)
			if err == nil {
				_ = response.Body.Close()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func agentHostCPUSeconds() float64 {
	samples := []metrics.Sample{{Name: "/cpu/classes/user:cpu-seconds"}}
	metrics.Read(samples)
	return samples[0].Value.Float64()
}

func (h *Host) Close() {
	h.mu.Lock()
	agentSessions := make([]agentsdk.Session, 0, len(h.sessions))
	for _, entry := range h.sessions {
		if entry.AgentSession != nil {
			agentSessions = append(agentSessions, entry.AgentSession)
		}
	}
	terminals := make([]*terminal, 0, len(h.terminals))
	for _, entry := range h.terminals {
		terminals = append(terminals, entry)
	}
	h.terminals = make(map[string]*terminal)
	permissions := make([]pendingPermission, 0, len(h.permissions))
	for _, permission := range h.permissions {
		permissions = append(permissions, permission)
	}
	h.permissions = make(map[string]pendingPermission)
	h.mu.Unlock()
	for _, agentSession := range agentSessions {
		_ = agentSession.Close()
	}
	for _, entry := range terminals {
		_ = entry.pty.Close()
		_ = entry.command.Process.Kill()
	}
	for _, permission := range permissions {
		h.emitTypedAction(permission.resource, ahptypes.StateAction{
			Value: &ahptypes.SessionInputNeededRemovedAction{
				Type: ahptypes.ActionTypeSessionInputNeededRemoved,
				Id:   permission.inputID,
			},
		}, nil)
		h.emitSessionSummaryChanged(permission.resource)
		permission.response <- agentsdk.PermissionCancel
	}
}

func (h *Host) connectAndServe(ctx context.Context, config Config) error {
	endpoint, err := agentHostEndpoint(config.ServerURL, config.WorkspaceID)
	if err != nil {
		return err
	}
	headers := http.Header{}
	if token, tokenErr := registrationToken(config); tokenErr != nil {
		return tokenErr
	} else if token != "" {
		headers.Set("Authorization", "Bearer "+token)
	}
	connection, _, err := websocket.DefaultDialer.DialContext(ctx, endpoint, headers)
	if err != nil {
		return err
	}
	stopContextClose := context.AfterFunc(ctx, func() {
		_ = connection.Close()
	})
	defer stopContextClose()
	outgoing := make(chan []byte, 128)
	var outgoingMu sync.Mutex
	outgoingClosed := false
	enqueue := func(payload []byte) {
		outgoingMu.Lock()
		defer outgoingMu.Unlock()
		if outgoingClosed {
			return
		}
		select {
		case outgoing <- payload:
		default:
		}
	}
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		heartbeat := time.NewTicker(hostHeartbeatInterval)
		defer heartbeat.Stop()
		for {
			select {
			case payload, ok := <-outgoing:
				if !ok {
					return
				}
				if err := connection.WriteMessage(websocket.TextMessage, payload); err != nil {
					return
				}
			case <-heartbeat.C:
				if err := connection.WriteControl(
					websocket.PingMessage,
					nil,
					time.Now().Add(5*time.Second),
				); err != nil {
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() {
		h.removeAllMuxPeers()
		outgoingMu.Lock()
		outgoingClosed = true
		close(outgoing)
		outgoingMu.Unlock()
		<-writerDone
		_ = connection.Close()
	}()
	for {
		_, payload, err := connection.ReadMessage()
		if err != nil {
			return err
		}
		if err := h.handleMuxFrame(payload, enqueue); err != nil {
			return err
		}
	}
}

func registrationToken(config Config) (string, error) {
	if config.RegistrationTokenFile == "" {
		return "", nil
	}
	contents, err := os.ReadFile(config.RegistrationTokenFile)
	if err != nil {
		return "", fmt.Errorf("read Agent Host registration credential: %w", err)
	}
	token := strings.TrimSpace(string(contents))
	if token == "" {
		return "", fmt.Errorf("Agent Host registration credential is empty")
	}
	info, err := os.Stat(config.RegistrationTokenFile)
	if err != nil {
		return "", fmt.Errorf("inspect Agent Host registration credential: %w", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", fmt.Errorf("Agent Host registration credential must use mode 0600")
	}
	return token, nil
}

func agentHostEndpoint(serverURL string, workspaceID string) (string, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("unsupported server URL scheme %q", parsed.Scheme)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/v1/agent-hosts/"
	parsed.Path += url.PathEscape(workspaceID) + "/ahp"
	return parsed.String(), nil
}

func agentHostTelemetryEndpoint(serverURL string, workspaceID string) (string, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "ws":
		parsed.Scheme = "http"
	case "wss":
		parsed.Scheme = "https"
	case "http", "https":
	default:
		return "", fmt.Errorf("unsupported server URL scheme %q", parsed.Scheme)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/v1/agent-hosts/"
	parsed.Path += url.PathEscape(workspaceID) + "/telemetry"
	return parsed.String(), nil
}

func agentHostModelEndpoint(serverURL string, workspaceID string) (string, error) {
	parsed, err := serverHTTPURL(serverURL)
	if err != nil {
		return "", err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/v1/agent-hosts/"
	parsed.Path += url.PathEscape(workspaceID) + "/model"
	return parsed.String(), nil
}

func modelGatewayURL(serverURL string) (string, error) {
	parsed, err := serverHTTPURL(serverURL)
	if err != nil {
		return "", err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/v1/llm/openai/v1"
	return parsed.String(), nil
}

func serverHTTPURL(serverURL string) (*url.URL, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return nil, err
	}
	switch parsed.Scheme {
	case "ws":
		parsed.Scheme = "http"
	case "wss":
		parsed.Scheme = "https"
	case "http", "https":
	default:
		return nil, fmt.Errorf("unsupported server URL scheme %q", parsed.Scheme)
	}
	return parsed, nil
}

func (h *Host) handle(payload []byte) ([]byte, []byte) {
	return h.handlePeer(h.directPeer, payload)
}

func (h *Host) handlePeer(peer *logicalPeer, payload []byte) ([]byte, []byte) {
	var message ahptypes.JsonRpcMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		return rpcError(nil, ahptypes.ErrorCodeParseError, "parse error"), nil
	}
	if message.Notification != nil {
		switch message.Notification.Method {
		case "dispatchAction":
			h.dispatchAction(peer, message.Notification.Params)
		case "unsubscribe":
			h.unsubscribe(peer, message.Notification.Params)
		}
		return nil, nil
	}
	if message.Request == nil {
		return rpcError(nil, ahptypes.ErrorCodeInvalidRequest, "invalid request"), nil
	}
	request := *message.Request
	switch request.Method {
	case "initialize":
		return h.initialize(peer, request), nil
	case "ping":
		return rpcResult(request.ID, map[string]any{}), nil
	case "reconnect":
		return h.reconnect(peer, request), nil
	case "subscribe":
		return h.subscribe(peer, request), nil
	case "listSessions":
		return h.listSessions(request), nil
	case "createSession":
		response, notification := h.createSession(request)
		h.emitToOtherSubscribers(peer, ahptypes.RootResourceURI, notification)
		return response, notification
	case "disposeSession":
		response, notification := h.disposeSession(request)
		h.emitToOtherSubscribers(peer, ahptypes.RootResourceURI, notification)
		return response, notification
	case "promptSession":
		return h.promptSession(request)
	case "cancelSession":
		return h.cancelSession(request), nil
	case "resourceList":
		return h.resourceList(request), nil
	case "resourceRead":
		return h.resourceRead(request), nil
	case "workspaceChanges":
		return h.workspaceChanges(request), nil
	case "workspaceDiff":
		return h.workspaceDiff(request), nil
	case "workspaceStage":
		return h.workspaceStage(request), nil
	case "workspaceRevert":
		return h.workspaceRevert(request), nil
	case "invokeChangesetOperation":
		return h.invokeChangesetOperation(request), nil
	case "createTerminal":
		return h.createTerminal(peer, request)
	case "disposeTerminal":
		return h.disposeTerminal(peer, request)
	default:
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeMethodNotFound,
			"method not found",
		), nil
	}
}

func (h *Host) emitToOtherSubscribers(
	requester *logicalPeer,
	channel ahptypes.URI,
	payload []byte,
) {
	if len(payload) == 0 {
		return
	}
	h.mu.Lock()
	emitters := make([]func([]byte), 0, len(h.peers))
	for _, peer := range h.peers {
		if peer == requester || peer.emit == nil {
			continue
		}
		if _, subscribed := peer.subscriptions[string(channel)]; subscribed {
			emitters = append(emitters, peer.emit)
		}
	}
	h.mu.Unlock()
	for _, emit := range emitters {
		emit(payload)
	}
}

func (h *Host) initialize(peer *logicalPeer, request rpcRequest) []byte {
	var params ahptypes.InitializeParams
	if err := json.Unmarshal(request.Params, &params); err != nil ||
		params.Channel != ahptypes.RootResourceURI || params.ClientId == "" {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"invalid initialize parameters",
		)
	}
	if !slices.Contains(params.ProtocolVersions, ahptypes.ProtocolVersion) {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeUnsupportedProtocolVersion,
			"unsupported protocol version",
		)
	}
	h.mu.Lock()
	snapshots, err := h.snapshotsLocked(params.InitialSubscriptions)
	if err == nil {
		peer.clientID = params.ClientId
		for _, resource := range params.InitialSubscriptions {
			peer.subscriptions[resource] = struct{}{}
		}
	}
	h.sequence++
	sequence := h.sequence
	h.mu.Unlock()
	if err != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeNotFound, err.Error())
	}
	result := ahptypes.InitializeResult{
		ProtocolVersion:  ahptypes.ProtocolVersion,
		ServerSeq:        sequence,
		ServerInfo:       &ahptypes.Implementation{Name: "zaw-agent-host"},
		DefaultDirectory: uriPointer(ahptypes.URI(h.workspaceURI())),
		Snapshots:        snapshots,
	}
	return rpcResult(request.ID, result)
}

func (h *Host) listSessions(request rpcRequest) []byte {
	var params ahptypes.ListSessionsParams
	if err := json.Unmarshal(request.Params, &params); err != nil ||
		params.Channel != ahptypes.RootResourceURI || params.Cursor != nil {
		return rpcError(request.ID, ahptypes.ErrorCodeInvalidParams, "invalid listSessions parameters")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	items := make([]ahptypes.SessionSummary, 0, len(h.sessions))
	for _, item := range h.sessions {
		items = append(items, item.summary())
	}
	slices.SortFunc(items, func(left ahptypes.SessionSummary, right ahptypes.SessionSummary) int {
		return strings.Compare(right.ModifiedAt, left.ModifiedAt)
	})
	if params.Limit != nil && *params.Limit >= 0 && int64(len(items)) > *params.Limit {
		items = items[:*params.Limit]
	}
	return rpcResult(request.ID, ahptypes.ListSessionsResult{Items: items})
}

func (h *Host) createSession(request rpcRequest) ([]byte, []byte) {
	var params ahptypes.CreateSessionParams
	if err := json.Unmarshal(request.Params, &params); err != nil ||
		!strings.HasPrefix(params.Channel, "ahp-session:/") {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"createSession requires an ahp-session channel",
		), nil
	}
	if h.agent == nil {
		return rpcError(request.ID, agentSDKErrorCode, "Agent SDK is not configured"), nil
	}
	chatResource := defaultChatResource(params.Channel)
	agentSession, err := h.agent.CreateSession(
		context.Background(),
		agentsdk.SessionOptions{
			ID:               strings.TrimPrefix(params.Channel, "ahp-session:/"),
			WorkingDirectory: h.workDir,
			Instructions:     todoInstructions,
			Tools:            []agentsdk.Tool{h.todoTool(params.Channel)},
			OnEvent: func(event agentsdk.Event) {
				h.handleAgentEvent(params.Channel, chatResource, event)
			},
			OnPermission: func(
				ctx context.Context,
				permission agentsdk.PermissionRequest,
			) agentsdk.PermissionDecision {
				return h.handleAgentPermission(ctx, string(params.Channel), permission)
			},
		},
	)
	if err != nil {
		return rpcError(
			request.ID,
			agentSDKErrorCode,
			"Agent SDK session could not be created",
		), nil
	}
	h.mu.Lock()
	if _, exists := h.sessions[params.Channel]; exists {
		h.mu.Unlock()
		_ = agentSession.Close()
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeSessionAlreadyExists,
			"session already exists",
		), nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	title := "New Session"
	provider := "copilot"
	if params.Provider != nil && *params.Provider != "" {
		provider = *params.Provider
	}
	workingDirectory := params.WorkingDirectory
	if workingDirectory == nil {
		workingDirectory = uriPointer(ahptypes.URI(h.workspaceURI()))
	}
	chatSummary := ahptypes.ChatSummary{
		Resource:         chatResource,
		Title:            title,
		Status:           ahptypes.SessionStatusIdle,
		ModifiedAt:       now,
		WorkingDirectory: workingDirectory,
	}
	entry := session{
		Resource:   params.Channel,
		CreatedAt:  now,
		ModifiedAt: now,
		State: ahptypes.SessionState{
			Provider:         provider,
			Title:            title,
			Status:           ahptypes.SessionStatusIdle,
			WorkingDirectory: workingDirectory,
			Lifecycle:        ahptypes.SessionLifecycleReady,
			ActiveClients:    []ahptypes.SessionActiveClient{},
			Chats:            []ahptypes.ChatSummary{chatSummary},
			DefaultChat:      uriPointer(chatResource),
			Changesets:       []ahptypes.Changeset{workingTreeChangeset()},
		},
		Chat: ahptypes.ChatState{
			Resource:         chatResource,
			Title:            title,
			Status:           ahptypes.SessionStatusIdle,
			ModifiedAt:       now,
			WorkingDirectory: workingDirectory,
			Turns:            []ahptypes.Turn{},
		},
		AgentSession: agentSession,
	}
	h.sessions[params.Channel] = entry
	h.sequence++
	h.mu.Unlock()
	result := rpcResult(request.ID, map[string]any{})
	notification, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "root/sessionAdded",
		"params": map[string]any{
			"channel": "ahp-root://",
			"summary": entry.summary(),
		},
	})
	return result, notification
}

func (h *Host) promptSession(request rpcRequest) ([]byte, []byte) {
	var params struct {
		Channel string `json:"channel"`
		Text    string `json:"text"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil ||
		params.Channel == "" || params.Text == "" {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"promptSession requires channel and text",
		), nil
	}
	if h.agent == nil {
		return rpcError(request.ID, agentSDKErrorCode, "Agent SDK is not configured"), nil
	}
	h.mu.Lock()
	entry, exists := h.sessions[params.Channel]
	h.mu.Unlock()
	if !exists || entry.AgentSession == nil {
		return rpcError(request.ID, ahptypes.ErrorCodeSessionNotFound, "session not found"), nil
	}
	turnID := fmt.Sprintf("turn-%d", time.Now().UnixNano())
	h.startChatTurn(entry, ahptypes.ChatTurnStartedAction{
		Type:      ahptypes.ActionTypeChatTurnStarted,
		TurnId:    turnID,
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Message: ahptypes.Message{
			Text:   params.Text,
			Origin: ahptypes.MessageOrigin{Kind: ahptypes.MessageKindUser},
		},
	}, nil)
	return rpcResult(request.ID, map[string]any{"accepted": true}), nil
}

func (h *Host) handleAgentEvent(
	_ ahptypes.URI,
	chat ahptypes.URI,
	event agentsdk.Event,
) {
	h.emitStandardAgentEvent(chat, event)
}

func (h *Host) handleAgentPermission(
	ctx context.Context,
	resource string,
	request agentsdk.PermissionRequest,
) agentsdk.PermissionDecision {
	h.mu.Lock()
	entry, exists := h.sessions[resource]
	if !exists || entry.Chat.ActiveTurn == nil {
		h.mu.Unlock()
		return agentsdk.PermissionCancel
	}
	if entry.ApprovalMode == "allow" || entry.ApprovalMode == "autopilot" {
		h.mu.Unlock()
		return agentsdk.PermissionAllowOnce
	}
	h.sequence++
	key := fmt.Sprintf("permission-%d", h.sequence)
	response := make(chan agentsdk.PermissionDecision, 1)
	pending := pendingPermission{
		resource:   entry.Resource,
		chat:       entry.Chat.Resource,
		turnID:     entry.Chat.ActiveTurn.Id,
		toolCallID: key,
		inputID:    key,
		response:   response,
	}
	h.permissions[key] = pending
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.permissions, key)
		h.mu.Unlock()
	}()
	h.emitPermissionRequest(pending, request)
	select {
	case decision := <-response:
		return decision
	case <-ctx.Done():
		return agentsdk.PermissionCancel
	}
}

func (h *Host) cancelSession(request rpcRequest) []byte {
	var params struct {
		Channel string `json:"channel"`
	}
	if json.Unmarshal(request.Params, &params) != nil || params.Channel == "" {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"cancelSession requires channel",
		)
	}
	h.mu.Lock()
	entry, exists := h.sessions[params.Channel]
	h.mu.Unlock()
	if !exists || entry.AgentSession == nil {
		return rpcError(request.ID, ahptypes.ErrorCodeSessionNotFound, "session not found")
	}
	if err := entry.AgentSession.Cancel(context.Background()); err != nil {
		return rpcError(request.ID, agentSDKErrorCode, "Agent SDK session could not be canceled")
	}
	h.cancelPermissions(entry.Resource)
	return rpcResult(request.ID, map[string]any{})
}

func (h *Host) cancelPermissions(resource string) {
	h.mu.Lock()
	permissions := make([]pendingPermission, 0)
	for key, permission := range h.permissions {
		if permission.resource == resource {
			permissions = append(permissions, permission)
			delete(h.permissions, key)
		}
	}
	h.mu.Unlock()
	for _, permission := range permissions {
		h.emitTypedAction(permission.resource, ahptypes.StateAction{
			Value: &ahptypes.SessionInputNeededRemovedAction{
				Type: ahptypes.ActionTypeSessionInputNeededRemoved,
				Id:   permission.inputID,
			},
		}, nil)
		h.emitSessionSummaryChanged(permission.resource)
		permission.response <- agentsdk.PermissionCancel
	}
}

func (h *Host) disposeSession(request rpcRequest) ([]byte, []byte) {
	var params struct {
		Channel string `json:"channel"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil || params.Channel == "" {
		return rpcError(
			request.ID,
			ahptypes.ErrorCodeInvalidParams,
			"disposeSession requires channel",
		), nil
	}
	h.mu.Lock()
	entry := h.sessions[params.Channel]
	delete(h.sessions, params.Channel)
	h.sequence++
	sequence := h.sequence
	h.mu.Unlock()
	if entry.AgentSession != nil {
		_ = entry.AgentSession.Cancel(context.Background())
		_ = entry.AgentSession.Close()
		h.cancelPermissions(entry.Resource)
	}
	notification, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "root/sessionRemoved",
		"params": map[string]any{
			"channel":   "ahp-root://",
			"session":   params.Channel,
			"serverSeq": sequence,
		},
	})
	return rpcResult(request.ID, map[string]any{}), notification
}

func rpcResult(id uint64, result any) []byte {
	resultPayload, _ := json.Marshal(result)
	payload, _ := json.Marshal(ahptypes.JsonRpcSuccessResponse{
		JsonRpc: ahptypes.JsonRpcV2,
		ID:      id,
		Result:  resultPayload,
	})
	return payload
}

func rpcError(id any, code int32, message string) []byte {
	if requestID, ok := id.(uint64); ok {
		payload, _ := json.Marshal(ahptypes.JsonRpcErrorResponse{
			JsonRpc: ahptypes.JsonRpcV2,
			ID:      requestID,
			Error: ahptypes.JsonRpcError{
				Code: code, Message: message,
			},
		})
		return payload
	}
	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": ahptypes.JsonRpcV2,
		"id":      nil,
		"error":   ahptypes.JsonRpcError{Code: code, Message: message},
	})
	return payload
}
